import { randomUUID } from "node:crypto";
import { marketBars } from "./adapters.mjs";
import { inspectMarketBars } from "./market-quality.mjs";
import { saveBars } from "./storage.mjs";
import { audit, setting, setSetting } from "./db.mjs";

// The read-only poller is independent of the order executor and LLM.
// It ingests a short rolling window, not a complete historical backfill.
export async function pollMarketData(db, readCred, { dataFor = marketBars, maxSymbols = 5 } = {}) {
  const broker = [setting(db, "selected_broker"), "alpaca-trading-paper", "alpaca-broker-sandbox"]
    .find(type => ["alpaca-trading-paper", "alpaca-broker-sandbox"].includes(type) && readCred(type));
  if (!broker) return { status: "NO_DATA_CONNECTION", retrieved: 0 };
  const credentials = readCred(broker);
  const symbols = [...new Set(JSON.parse(setting(db, "watchlist", '["AAPL","MSFT","SPY"]')))]
    .filter(s => /^[A-Z][A-Z0-9.]{0,12}$/.test(s)).slice(0, Math.min(30, Math.max(1, maxSymbols)));
  let stored = 0, failures = 0;
  const started = new Date().toISOString();
  for (const symbol of symbols) {
    try {
      const data = await dataFor(credentials, symbol, { broker, timeframe: "1Min", feed: "iex", adjustment: "raw", limit: 80 });
      const quality = inspectMarketBars(data.bars, "1Min");
      saveBars(db, data.source, symbol, "1Min", data.bars);
      db.prepare(`INSERT INTO market_imports(id,created_at,broker,source,symbol,timeframe,feed,adjustment,start_at,end_at,pages,candles,complete,quality)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), new Date().toISOString(), broker, data.source,
        symbol, "1Min", "iex", "raw", null, null, 1, data.bars.length, 0, JSON.stringify(quality));
      stored += data.bars.length;
    } catch (error) {
      failures++;
      audit(db, "market_poll_failed", { symbol, broker, code: error.code || "DATA_ERROR" });
    }
  }
  setSetting(db, "market_last_poll", new Date().toISOString());
  const summary = { status: failures ? "PARTIAL" : "OK", broker, symbols: symbols.length,
    bars: stored, failures, started };
  setSetting(db, "market_last_poll_result", JSON.stringify(summary));
  return summary;
}
