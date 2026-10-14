#!/usr/bin/env node
// Read-only historical importer. Uses existing encrypted connection stored in
// the PRAXIS DB. No credentials accepted on the command line or exported.
import { randomUUID } from "node:crypto";
import { openDb, audit } from "../src/db.mjs";
import { unseal, getVaultKey } from "../src/security.mjs";
import { marketHistory } from "../src/adapters.mjs";
import { inspectMarketBars } from "../src/market-quality.mjs";
import { saveBars } from "../src/storage.mjs";

export async function backfill(db, credentials, {
  broker, symbol, timeframe, start, end, adjustment = "raw", feed = "iex",
  fetchImpl = fetch, chunkDays,
}) {
  if (!/^[A-Z][A-Z0-9.]{0,12}$/.test(symbol)) throw Error("Símbolo inválido.");
  const begin = Date.parse(start), finish = Date.parse(end);
  if (!Number.isFinite(begin) || !Number.isFinite(finish) || begin >= finish)
    throw Error("Intervalo temporal inválido.");
  const maxChunkDays = Number.isInteger(chunkDays) && chunkDays >= 1 && chunkDays <= 180
    ? chunkDays : timeframe === "1Day" || timeframe === "1Week" ? 180 : 7;
  let imported = 0, chunks = 0, pages = 0;
  for (let cursor = begin; cursor < finish;) {
    const until = Math.min(finish, cursor + maxChunkDays * 86400000);
    const options = { broker, timeframe, feed, adjustment, start: new Date(cursor).toISOString(),
      end: new Date(until).toISOString(), pageSize: 1000, maxBars: 50000, fetchImpl };
    const result = await marketHistory(credentials, symbol, options);
    if (!result.complete) throw Error(`Importação incompleta; interrompido no intervalo ${options.start}—${options.end}.`);
    const quality = inspectMarketBars(result.bars, timeframe);
    saveBars(db, result.source, symbol, timeframe, result.bars);
    db.prepare(`INSERT INTO market_imports(id,created_at,broker,source,symbol,timeframe,feed,adjustment,start_at,end_at,pages,candles,complete,quality)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), new Date().toISOString(), broker, result.source,
      symbol, timeframe, feed, adjustment, options.start, options.end, result.pages, result.bars.length, 1, JSON.stringify(quality));
    imported += result.bars.length;
    pages += result.pages;
    chunks++;
    cursor = until;
  }
  audit(db, "market_backfill_completed", { broker, symbol, timeframe, adjustment, chunks, pages, imported });
  return { broker, symbol, timeframe, chunks, pages, imported };
}

if (process.argv[1]?.endsWith("backfill-market.mjs")) {
  const [symbol, timeframe, start, end, broker = "alpaca-trading-paper", adjustment = "raw"] = process.argv.slice(2);
  if (!symbol || !timeframe || !start || !end || !["alpaca-trading-paper", "alpaca-broker-sandbox"].includes(broker)) {
    console.error("Uso: node scripts/backfill-market.mjs SYMBOL 1Day|1Min START_ISO END_ISO [alpaca-trading-paper|alpaca-broker-sandbox] [raw|split|dividend|all]");
    process.exit(2);
  }
  const db = openDb();
  try {
    const row = db.prepare("SELECT encrypted FROM connections WHERE type=? AND enabled=1").get(broker);
    if (!row) throw Error("Ligação Paper/Sandbox não configurada e ativa na dashboard.");
    const credentials = unseal(JSON.parse(row.encrypted), getVaultKey());
    const summary = await backfill(db, credentials, { symbol, timeframe, start, end, broker, adjustment });
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error("Backfill não concluído:", error.code || error.message);
    process.exitCode = 1;
  } finally { db.close(); }
}
