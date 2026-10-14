import test from "node:test";
import assert from "node:assert/strict";
import { marketHistory, marketBars, marketAuthHeaders, marketRequest, makeAdapter, marketSource, BrokerError } from "../src/adapters.mjs";
import { inspectMarketBars } from "../src/market-quality.mjs";
import { pollMarketData } from "../src/market-poller.mjs";
import { openDb, setSetting, setting } from "../src/db.mjs";

const cred = { key: "PHASE_A_PUBLIC_TEST", secret: "NOT_A_REAL_SECRET" };
const row = (t, c = 100) => ({ t, o: c, h: c+1, l: c-1, c, v: 100 });
const response = (value, status = 200) => ({ ok: status === 200, status, headers: new Headers(), json: async () => value });

test("Phase A: historico percorre todas as paginas, ordena e preserva metadados", async () => {
  const calls = [];
  const data = await marketHistory(cred, "AAPL", {
    start: "2026-10-14T13:30:00Z", end: "2026-10-14T13:32:00Z", pageSize: 2,
    adjustment: "split", fetchImpl: async (u, opts) => {
      calls.push(String(u));
      assert.equal(u.origin, "https://data.alpaca.markets");
      assert.equal(u.searchParams.get("sort"), "asc");
      assert.equal(u.searchParams.get("adjustment"), "split");
      assert.equal(opts.headers["APCA-API-KEY-ID"], cred.key);
      return u.searchParams.has("page_token")
        ? response({ bars: [row("2026-10-14T13:32:00Z", 102)], next_page_token: null })
        : response({ bars: [row("2026-10-14T13:30:00Z"), row("2026-10-14T13:31:00Z", 101)], next_page_token: "NEXT" });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(data.bars.length, 3);
  assert.equal(data.complete, true);
  assert.equal(data.pages, 2);
  assert.equal(data.source, "alpaca-trading-paper-iex-split");
});

test("Phase A: historico marcado parcial quando ha limite, sem descartes silenciosos", async () => {
  let calls=0;
  const r = await marketHistory(cred, "SPY", { start: "2026-10-14", end: "2026-10-17", maxBars: 1,
    fetchImpl: async () => { calls++; return response({ bars: [row("2026-10-14T13:30:00Z")], next_page_token: "MORE" }); },
  });
  assert.equal(calls, 1);
  assert.equal(r.complete, false);
  assert.equal(r.nextPageToken, "MORE");
});

test("Phase A: cursores repetidos e candles contraditorios recusados", async () => {
  await assert.rejects(
    marketHistory(cred, "AAPL", { start: "2026-10-14", end: "2026-10-15", pageSize: 1,
      fetchImpl: async () => response({ bars: [row("2026-10-14T13:30:00Z")], next_page_token: "C1" }) }),
    e => e.code === "PAGINATION_LOOP",
  );
  await assert.rejects(
    marketHistory(cred, "AAPL", { start: "2026-10-14", end: "2026-10-15", pageSize: 1,
      fetchImpl: async u => response(u.searchParams.has("page_token")
        ? { bars: [row("2026-10-14T13:30:00Z", 200)], next_page_token: null }
        : { bars: [row("2026-10-14T13:30:00Z")], next_page_token: "C1" }) }),
    e => e.code === "DATA_CONFLICT",
  );
});

test("Phase A: separacao de hosts e auth Basic para Market Data Broker Sandbox", async () => {
  const r = await marketBars(cred, "MSFT", { broker: "alpaca-broker-sandbox", fetchImpl: async (u, opts) => {
    assert.equal(u.host, "data.sandbox.alpaca.markets");
    assert.match(opts.headers.Authorization, /^Basic /);
    assert.equal(opts.headers["APCA-API-KEY-ID"], undefined);
    return response({ bars: [row("2026-10-14T13:30:00Z")] });
  } });
  assert.equal(r.source, "alpaca-broker-sandbox-iex-raw");
  await assert.rejects(marketRequest(cred, new URL("https://evil.example/v2/stocks/AAPL/bars"), async () => response({})), /não autorizado/);
});

test("Phase A: OAuth Broker Sandbox client credentials guarda token so em memoria", async () => {
  const oauthCred = { key: "PUBLIC_OAUTH_PHASE_A", secret: "FAKE_OAUTH_PHASE_A", authMode: "oauth" };
  let tokenCalls = 0;
  const fetchImpl = async (u, opts) => {
    if (String(u).includes("authx.sandbox.alpaca.markets")) {
      tokenCalls++;
      assert.equal(opts.method, "POST");
      assert.match(opts.body, /grant_type=client_credentials/);
      return response({ access_token: "TEMPORARY_FAKE_TOKEN", expires_in: 899 });
    }
    assert.equal(opts.headers.Authorization, "Bearer TEMPORARY_FAKE_TOKEN");
    return response({ bars: [row("2026-10-14T13:30:00Z")] });
  };
  await marketBars(oauthCred, "AAPL", { broker: "alpaca-broker-sandbox", fetchImpl });
  await marketBars(oauthCred, "MSFT", { broker: "alpaca-broker-sandbox", fetchImpl });
  assert.equal(tokenCalls, 1);
});

test("Phase A: FILL Broker usa rota com account_id e filtro activity_types", async () => {
  let req = null;
  const adapter = makeAdapter("alpaca-broker-sandbox", cred, async u => {
    req = new URL(u);
    return response([]);
  });
  await adapter.fills("11111111-2222-3333-4444-555555555555");
  assert.equal(req.pathname, "/v1/accounts/activities");
  assert.equal(req.searchParams.get("account_id"), "11111111-2222-3333-4444-555555555555");
  assert.equal(req.searchParams.get("activity_types"), "FILL");
  assert.equal(req.searchParams.get("page_size"), "100");
});

test("Phase A: identifica lacunas apenas como candidatas intrassessao e recusa futuros", () => {
  const bars = [row("2026-10-14T13:30:00Z"), row("2026-10-14T13:33:00Z")];
  const q = inspectMarketBars(bars, "1Min", { now: Date.parse("2026-10-14T13:35:00Z") });
  assert.equal(q.suspectedGapCount, 1);
  assert.equal(q.calendarVerified, false);
  assert.equal(q.futureBarCount, 0);
  assert.equal(inspectMarketBars([row("2026-10-13T19:59:00Z"), row("2026-10-14T13:30:00Z")], "1Min").suspectedGapCount, 0);
  assert.equal(inspectMarketBars([row("2026-10-14T13:30:00Z")], "1Min", { now: 1 }).futureBarCount, 1);
});

test("Phase A: poller recolhe dados sem armar motor ou criar ordens", async () => {
  const db = openDb(":memory:");
  try {
    setSetting(db, "watchlist", JSON.stringify(["AAPL", "MSFT", "SPY"]));
    const r = await pollMarketData(db, type => type === "alpaca-trading-paper" ? cred : null, {
      maxSymbols: 2,
      dataFor: async (_, s, opts) => {
        assert.equal(opts.broker, "alpaca-trading-paper");
        return { source: marketSource("alpaca-trading-paper"), bars: [row("2026-10-14T13:30:00Z")], complete: false };
      },
    });
    assert.equal(r.status, "OK");
    assert.equal(r.symbols, 2);
    assert.equal(db.prepare("SELECT count(*) AS n FROM market_bars").get().n, 2);
    assert.equal(db.prepare("SELECT count(*) AS n FROM market_imports").get().n, 2);
    assert.equal(db.prepare("SELECT count(*) AS n FROM order_intents").get().n, 0);
    assert.equal(setting(db, "run_mode"), "DISARMED");
  } finally { db.close(); }
});

test("Phase A: batch backfill percorre intervalos com persistencia e nenhuma ordem", async () => {
  const { backfill } = await import("../scripts/backfill-market.mjs");
  const db = openDb(":memory:");
  try {
    const calls = [];
    const summary = await backfill(db, cred, { broker: "alpaca-trading-paper", symbol: "SPY", timeframe: "1Day",
      start: "2026-10-01", end: "2026-10-04", chunkDays: 1,
      fetchImpl: async u => { calls.push(u); return response({ bars: [row(u.searchParams.get("start"))], next_page_token: null }); },
    });
    assert.equal(summary.chunks, 3);
    assert.equal(summary.imported, 3);
    assert.equal(db.prepare("SELECT count(*) AS n FROM market_imports WHERE complete=1").get().n, 3);
    assert.equal(db.prepare("SELECT count(*) AS n FROM market_bars").get().n, 3);
    assert.equal(db.prepare("SELECT count(*) AS n FROM order_intents").get().n, 0);
  } finally { db.close(); }
});
