import test from "node:test";
import assert from "node:assert/strict";
import { openDb, setSetting, setting } from "../src/db.mjs";
import { autoCycle, disarm } from "../src/engine.mjs";
function setup() {
  const db = openDb(":memory:");
  for (const [k, v] of Object.entries({
    run_mode: "AUTO_PAPER",
    kill_switch: "0",
    auto_enabled: "1",
    selected_broker: "alpaca-trading-paper",
    selected_account: "paper123",
  }))
    setSetting(db, k, v);
  return db;
}
const bars = () =>
  Array.from({ length: 40 }, (_, i) => {
    const c = i === 39 ? 110 : 100;
    return {
      t: new Date(Date.now() - (41 - i) * 60000).toISOString(),
      o: c,
      h: c + 1,
      l: c - 1,
      c,
      v: 1000,
    };
  });
function adapter(positions = [], onPost = () => {}) {
  return {
    account: async () => ({ status: "ACTIVE" }),
    positions: async () => positions,
    clock: async () => ({ is_open: true }),
    orders: async () => [],
    fills: async () => [],
    byClientId: async () => null,
    submit: async () => {
      onPost();
      return { id: "engine-test-order", status: "accepted" };
    },
  };
}
test("forward engine records version/features/bars and sends only one repeated signal", async () => {
  const db = setup(),
    data = bars();
  let calls = 0;
  const a = adapter([], () => calls++),
    options = { adapterFor: () => a, dataFor: async () => ({ bars: data }) };
  const r = await autoCycle(db, () => ({}), options);
  assert.equal(r.status, "SIGNAL");
  assert.equal(db.prepare("SELECT count(*) n FROM signals").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM market_bars").get().n, 40);
  await autoCycle(db, () => ({}), options);
  assert.equal(calls, 1);
  db.close();
});
test("forward long/flat sizing matches backtest: no second entry while long", async () => {
  const db = setup();
  let calls = 0;
  const r = await autoCycle(db, () => ({}), {
    adapterFor: () => adapter([{ symbol: "AAPL", qty: "1" }], () => calls++),
    dataFor: async () => ({ bars: bars() }),
  });
  assert.equal(r.status, "STRATEGY_ALREADY_LONG");
  assert.equal(calls, 0);
  db.close();
});
test("forward ignores stale candles and stops at the persisted 60-day deadline", async () => {
  const db = setup();
  let calls = 0;
  const options = {
    adapterFor: () => adapter([], () => calls++),
    dataFor: async () => ({
      bars: bars().map((b) => ({
        ...b,
        t: new Date(Date.parse(b.t) - 3600000).toISOString(),
      })),
    }),
  };
  assert.equal((await autoCycle(db, () => ({}), options)).status, "STALE_DATA");
  setSetting(db, "experiment_end", new Date(Date.now() - 1).toISOString());
  assert.equal(
    (await autoCycle(db, () => ({}), options)).status,
    "EXPERIMENT_COMPLETE",
  );
  assert.equal(setting(db, "kill_switch"), "1");
  assert.equal(calls, 0);
  db.close();
});
