import test from "node:test";
import assert from "node:assert/strict";
import { openDb, setting, setSetting } from "../src/db.mjs";
import {
  checkRisk,
  clientOrderId,
  submitIntent,
  reconcile,
  crossSignal,
  listUnknown,
} from "../src/oms.mjs";
const fresh = () => new Date(Date.now() - 85_000).toISOString();
const base = {
  mode: "AUTO_PAPER",
  kill: false,
  broker: "alpaca-trading-paper",
  accountId: "paper123456",
  account: {
    status: "ACTIVE",
    equity: "100000",
    cash: "100000",
    buying_power: "100000",
  },
  positions: [],
  ordersToday: 0,
  side: "buy",
  symbol: "AAPL",
  qty: 10,
  price: 100,
  dataTime: fresh(),
  clock: { is_open: true },
};
const valid = () => ({ ...base, positions: [] });
function withDb(fn) {
  let db = openDb(":memory:");
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
test("demo validates fresh automatic signals without artificial financial caps", () => {
  assert.equal(checkRisk(valid()).allowed, true);
});
test("risk fails closed when disarmed, clock closed, missing prices, or stale data", () => {
  for (const override of [
    { mode: "DISARMED" },
    { kill: true },
    { clock: { is_open: false } },
    { dataTime: "2020-01-01T00:00:00Z" },
    { price: NaN },
    { qty: 0 },
  ])
    assert.equal(checkRisk({ ...valid(), ...override }).allowed, false);
});
test("DEMO allows large orders, unlimited positions, repeated trades and drawdown", () => {
  for (const override of [
    { qty: 5000 },
    { positions: [{ symbol: "MSFT", market_value: "980000" }] },
    { ordersToday: 5000 },
    { baselineEquity: { day: 999999, peak: 999999 } },
    { account: { ...base.account, equity: "1", cash: "0", buying_power: "0" } },
  ])
    assert.equal(checkRisk({ ...valid(), ...override }).allowed, true);
  assert.equal(
    checkRisk({ ...valid(), account: { ...base.account, status: "CLOSED" } })
      .allowed,
    false,
  );
});
test("DEMO permits testing broker-side short-sale rejections", () => {
  assert.equal(checkRisk({ ...valid(), side: "sell", qty: 10 }).allowed, true);
  assert.equal(
    checkRisk({ ...valid(), side: "sell", qty: 50, positions: [] }).allowed,
    true,
  );
});
test("manual market orders are not gated by stale candles or market hours", () => {
  assert.equal(
    checkRisk({
      ...valid(),
      mode: "MANUAL_PAPER",
      dataTime: null,
      price: NaN,
      clock: { is_open: false },
    }).allowed,
    true,
  );
});
test("client id deterministic and varies with signal", () => {
  const a = {
    broker: "alpaca-trading-paper",
    accountId: "a",
    signalId: "s1",
    symbol: "AAPL",
    side: "buy",
  };
  assert.equal(clientOrderId(a), clientOrderId(a));
  assert.notEqual(clientOrderId(a), clientOrderId({ ...a, signalId: "s2" }));
});
test("sqlite starts disarmed and kill switch ON", () =>
  withDb((db) => {
    assert.equal(setting(db, "run_mode"), "DISARMED");
    assert.equal(setting(db, "kill_switch"), "1");
  }));
test("paper submission persists BEFORE network call; duplicate signal never repeats", async () => {
  const db = openDb(":memory:");
  setSetting(db, "run_mode", "AUTO_PAPER");
  setSetting(db, "kill_switch", "0");
  let network = 0;
  const adapter = {
    account: async () => base.account,
    positions: async () => [],
    clock: async () => ({ is_open: true }),
    submit: async () => {
      network++;
      assert.equal(
        db.prepare("SELECT count(*) n FROM order_intents").get().n,
        1,
      );
      return { id: "order-01", status: "accepted" };
    },
  };
  const opts = {
    adapter,
    broker: base.broker,
    accountId: base.accountId,
    signalId: "AAPL|t1",
    symbol: "AAPL",
    side: "buy",
    qty: 10,
    price: 100,
    dataTime: fresh(),
    mode: "AUTO_PAPER",
  };
  const a = await submitIntent(db, opts),
    b = await submitIntent(db, opts);
  assert.equal(a.status, "ACCEPTED");
  assert.equal(b.duplicated, true);
  assert.equal(network, 1);
  db.close();
});
test("ambiguous submit marks UNKNOWN, reconciliation uses client id without retry", async () => {
  const db = openDb(":memory:");
  setSetting(db, "run_mode", "AUTO_PAPER");
  setSetting(db, "kill_switch", "0");
  let post = 0,
    lookup = 0;
  const adapter = {
    account: async () => base.account,
    positions: async () => [],
    clock: async () => ({ is_open: true }),
    submit: async () => {
      post++;
      throw Object.assign(new Error("timeout"), { code: "AMBIGUOUS_NETWORK" });
    },
    byClientId: async () => {
      lookup++;
      return { id: "final123", status: "filled" };
    },
  };
  const opts = {
    adapter,
    broker: base.broker,
    accountId: base.accountId,
    signalId: "AAPL|timeout",
    symbol: "AAPL",
    side: "buy",
    qty: 10,
    price: 100,
    dataTime: fresh(),
    mode: "AUTO_PAPER",
  };
  const a = await submitIntent(db, opts);
  assert.equal(a.status, "UNKNOWN");
  await submitIntent(db, opts);
  assert.equal(post, 1);
  const r = await reconcile(db, {
    adapter,
    broker: base.broker,
    accountId: base.accountId,
  });
  assert.equal(r.reconciled, 1);
  assert.equal(lookup, 1);
  assert.equal(
    db.prepare("SELECT status FROM order_intents").get().status,
    "FILLED",
  );
  db.close();
});
test("demo does not stop trading on simulated drawdown", () =>
  assert.equal(
    checkRisk({ ...valid(), baselineEquity: { day: 102000, peak: 105000 } })
      .allowed,
    true,
  ));
test("SMA crossover needs history and returns null for noncross", () => {
  assert.equal(crossSignal([]), null);
  assert.equal(
    crossSignal(Array.from({ length: 21 }, (_, i) => ({ t: `t${i}`, c: 100 }))),
    null,
  );
});
test("unique SQLite client id constraint prevents duplication at database level", () =>
  withDb((db) => {
    const sql =
      "INSERT INTO order_intents(id,broker,account_id,signal_id,symbol,side,qty,client_order_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)";
    const params = [
      "id",
      "alpaca-trading-paper",
      "account",
      "signal",
      "AAPL",
      "buy",
      "1",
      "coid",
      "SUBMITTING",
      "2026-10-01",
      "2026-10-01",
    ];
    db.prepare(sql).run(...params);
    assert.throws(() => db.prepare(sql).run(...["id2", ...params.slice(1)]));
  }));

test("accepted paper order does not freeze subsequent independent submissions", async () => {
  const db = openDb(":memory:");
  setSetting(db, "run_mode", "AUTO_PAPER");
  setSetting(db, "kill_switch", "0");
  let post = 0;
  const adapter = {
    account: async () => base.account,
    clock: async () => ({ is_open: true }),
    submit: async () => ({ id: "ack-" + ++post, status: "accepted" }),
  };
  const opts = {
    adapter,
    broker: base.broker,
    accountId: base.accountId,
    symbol: "AAPL",
    side: "buy",
    qty: 100,
    price: 100,
    dataTime: fresh(),
    mode: "AUTO_PAPER",
  };
  const a = await submitIntent(db, { ...opts, signalId: "sig-a" }),
    b = await submitIntent(db, { ...opts, signalId: "sig-b" });
  assert.equal(a.status, "ACCEPTED");
  assert.equal(b.status, "ACCEPTED");
  assert.equal(post, 2);
  assert.equal(listUnknown(db).length, 0);
  db.close();
});
test("two simultaneous identical signals send only one HTTP order", async () => {
  const db = openDb(":memory:");
  setSetting(db, "run_mode", "AUTO_PAPER");
  setSetting(db, "kill_switch", "0");
  let post = 0;
  const adapter = {
    account: async () => {
      await new Promise((r) => setTimeout(r, 2));
      return base.account;
    },
    clock: async () => ({ is_open: true }),
    submit: async () => {
      post++;
      return { id: "order-1", status: "accepted" };
    },
  };
  const opts = {
    adapter,
    broker: base.broker,
    accountId: base.accountId,
    signalId: "parallel-signal",
    symbol: "AAPL",
    side: "buy",
    qty: 2,
    price: 100,
    dataTime: fresh(),
    mode: "AUTO_PAPER",
  };
  const [one, two] = await Promise.all([
    submitIntent(db, opts),
    submitIntent(db, opts),
  ]);
  assert.equal(post, 1);
  assert.equal([one, two].filter((x) => x.duplicated).length, 1);
  db.close();
});

test("Broker HTTP 422 is recorded as REJECTED, not an ambiguous fill", async () => {
  const db = openDb(":memory:");
  setSetting(db, "run_mode", "MANUAL_PAPER");
  setSetting(db, "kill_switch", "0");
  const adapter = {
    account: async () => base.account,
    submit: async () => {
      throw Object.assign(new Error("rejected by sandbox"), {
        code: "HTTP_422",
      });
    },
  };
  const r = await submitIntent(db, {
    adapter,
    broker: base.broker,
    accountId: base.accountId,
    signalId: "broker-reject-test",
    symbol: "AAPL",
    side: "buy",
    qty: 9999,
    price: NaN,
    dataTime: null,
    mode: "MANUAL_PAPER",
  });
  assert.equal(r.status, "REJECTED");
  assert.equal(r.needsReconciliation, undefined);
  assert.equal(listUnknown(db).length, 0);
  db.close();
});
