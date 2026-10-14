import test from "node:test";
import assert from "node:assert/strict";
import { openDb, setSetting } from "../src/db.mjs";
import { liquidate } from "../src/positions.mjs";
function setup() {
  const db = openDb(":memory:");
  for (const [k, v] of Object.entries({
    selected_broker: "alpaca-trading-paper",
    selected_account: "paper123",
    run_mode: "MANUAL_PAPER",
    kill_switch: "0",
  }))
    setSetting(db, k, v);
  return db;
}
const opts = (adapter) => ({
  requestId: "liquidation-request-123",
  credentialFor: () => ({}),
  adapterFor: () => adapter,
});
function adapter(positions, onPost = () => {}) {
  return {
    positions: async () => positions,
    orders: async () => [],
    account: async () => ({ status: "ACTIVE" }),
    submit: async (id, o, { guard }) => {
      guard();
      onPost(o);
      return { id: "order-" + o.symbol, status: "accepted" };
    },
  };
}
test("liquidation closes long by selling and short by buying, preserves fractional quantities, duplicate never resends", async () => {
  const db = setup(),
    posts = [];
  try {
    const a = adapter(
      [
        { symbol: "AAPL", qty: "1.25" },
        { symbol: "MSFT", qty: "-2.5" },
      ],
      (o) => posts.push(o),
    );
    const r = await liquidate(db, opts(a));
    assert.equal(r.positionsRequested, 2);
    assert.deepEqual(
      posts.map((p) => [p.symbol, p.side, p.qty]),
      [
        ["AAPL", "sell", "1.25"],
        ["MSFT", "buy", "2.5"],
      ],
    );
    const duplicate = await liquidate(db, opts(a));
    assert.equal(duplicate.duplicated, true);
    assert.equal(posts.length, 2);
  } finally {
    db.close();
  }
});
test("liquidation does not operate while AUTO/kill switch active and refuses pending same-symbol orders", async () => {
  const db = setup();
  try {
    setSetting(db, "run_mode", "AUTO_PAPER");
    await assert.rejects(liquidate(db, opts(adapter([]))), /MANUAL_PAPER/);
    setSetting(db, "run_mode", "MANUAL_PAPER");
    const a = adapter([{ symbol: "AAPL", qty: "1" }]);
    a.orders = async () => [{ symbol: "AAPL", status: "accepted" }];
    await assert.rejects(liquidate(db, opts(a)), /pendentes/);
    assert.equal(db.prepare("SELECT count(*) n FROM order_intents").get().n, 0);
  } finally {
    db.close();
  }
});
test("ambiguous liquidation blocks accidental second request and never retries the POST", async () => {
  const db = setup();
  let posts = 0;
  try {
    const a = adapter([{ symbol: "AAPL", qty: "1" }]);
    a.submit = async () => {
      posts++;
      throw Error("timeout");
    };
    assert.equal((await liquidate(db, opts(a))).status, "NEEDS_RECONCILIATION");
    await liquidate(db, opts(a));
    await assert.rejects(
      liquidate(db, { ...opts(a), requestId: "another-liquidation-123" }),
      /pendente/,
    );
    assert.equal(posts, 1);
  } finally {
    db.close();
  }
});
test("concurrent repeated liquidation request sends one closing order", async () => {
  const db = setup();
  let posts = 0;
  try {
    const a = adapter([{ symbol: "AAPL", qty: "1" }], () => posts++);
    const results = await Promise.all([
      liquidate(db, opts(a)),
      liquidate(db, opts(a)),
    ]);
    assert.equal(posts, 1);
    assert.equal(results.filter((r) => r.duplicated).length, 1);
  } finally {
    db.close();
  }
});
