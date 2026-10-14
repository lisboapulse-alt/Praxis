import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { openDb, setting, setSetting } from "../src/db.mjs";
import { disarm, arm, pauseForRecovery, recover } from "../src/engine.mjs";
import { submitIntent, reconcile } from "../src/oms.mjs";
import { lease, storeFills, storeOrders } from "../src/storage.mjs";
const account = { status: "ACTIVE", id: "account123" },
  base = {
    broker: "alpaca-trading-paper",
    accountId: "account123",
    signalId: "race1",
    symbol: "AAPL",
    side: "buy",
    qty: 1,
    mode: "MANUAL_PAPER",
  };
function ready(db) {
  setSetting(db, "run_mode", "MANUAL_PAPER");
  setSetting(db, "kill_switch", "0");
}
test("kill switch during asynchronous account validation prevents network POST", async () => {
  const db = openDb(":memory:");
  ready(db);
  let calls = 0;
  await assert.rejects(
    submitIntent(db, {
      ...base,
      adapter: {
        account: async () => {
          disarm(db);
          return account;
        },
        submit: async () => {
          calls++;
          return { id: "bad" };
        },
      },
    }),
    /suspensa/,
  );
  assert.equal(calls, 0);
  db.close();
});
test("kill switch during adapter dispatch delay prevents POST with guarded dispatch", async () => {
  const db = openDb(":memory:");
  ready(db);
  let calls = 0;
  const r = await submitIntent(db, {
    ...base,
    adapter: {
      account: async () => account,
      submit: async (id, data, { guard }) => {
        disarm(db);
        guard();
        calls++;
        return { id: "bad" };
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(r.status, "REJECTED");
  db.close();
});
test("accepted and partially filled orders reconcile to filled, fills are idempotent", async () => {
  const db = openDb(":memory:");
  ready(db);
  const adapter = {
    account: async () => account,
    submit: async () => ({ id: "ord1", status: "accepted" }),
    byClientId: async () => ({ id: "ord1", status: "filled" }),
    positions: async () => [],
    fills: async () => [
      {
        id: "fill1",
        order_id: "ord1",
        symbol: "AAPL",
        side: "buy",
        qty: "1",
        price: "100",
        transaction_time: "2026-10-01T12:00:00Z",
      },
    ],
  };
  await submitIntent(db, { ...base, adapter });
  await reconcile(db, { adapter, ...base });
  await reconcile(db, { adapter, ...base });
  assert.equal(
    db.prepare("SELECT status FROM order_intents").get().status,
    "FILLED",
  );
  assert.equal(db.prepare("SELECT count(*) n FROM fills").get().n, 1);
  db.close();
});
test("SQLite lease excludes a second process owner and expired leases recover", () => {
  const db = openDb(":memory:");
  assert.equal(lease(db, "one", 100), true);
  assert.equal(lease(db, "two", 101), false);
  assert.equal(lease(db, "two", 30101), true);
  db.close();
});
test("restart restores durable intentions and backup includes committed WAL data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "px-durable-")),
    file = join(dir, "db.sqlite");
  let db = openDb(file);
  try {
    ready(db);
    await submitIntent(db, {
      ...base,
      adapter: {
        account: async () => account,
        submit: async () => {
          throw Error("timeout");
        },
      },
    });
    await backup(db, join(dir, "backup.sqlite"));
    db.close();
    db = openDb(file);
    assert.equal(
      db.prepare("SELECT status FROM order_intents").get().status,
      "UNKNOWN",
    );
    const restored = new DatabaseSync(join(dir, "backup.sqlite"));
    assert.equal(
      restored.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.equal(
      restored.prepare("SELECT status FROM order_intents").get().status,
      "UNKNOWN",
    );
    restored.close();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("restart pauses execution and resumes manual mode only after account reconciliation", async () => {
  const db = openDb(":memory:");
  ready(db);
  setSetting(db, "selected_broker", base.broker);
  setSetting(db, "selected_account", base.accountId);
  pauseForRecovery(db);
  assert.equal(setting(db, "kill_switch"), "1");
  const adapter = {
    accounts: async () => [{ id: base.accountId, status: "ACTIVE" }],
    positions: async () => [],
    orders: async () => [],
    fills: async () => [],
  };
  assert.equal(
    await recover(
      db,
      () => ({ key: "test" }),
      () => adapter,
    ),
    true,
  );
  assert.equal(setting(db, "run_mode"), "MANUAL_PAPER");
  disarm(db);
  assert.equal(
    await recover(
      db,
      () => ({ key: "test" }),
      () => adapter,
    ),
    false,
  );
  db.close();
});
test("arm interrupted by a kill switch cannot clear it again", async () => {
  const db = openDb(":memory:");
  const adapter = {
    accounts: async () => {
      disarm(db);
      return [{ id: base.accountId, status: "ACTIVE" }];
    },
    orders: async () => [],
    fills: async () => [],
    positions: async () => [],
  };
  await assert.rejects(
    arm(db, { ...base, credentialFor: () => ({}), adapterFor: () => adapter }),
    /interrompida/,
  );
  assert.equal(setting(db, "kill_switch"), "1");
  db.close();
});
test("same signal cannot be reused with a different quantity or side", async () => {
  const db = openDb(":memory:");
  ready(db);
  let post = 0;
  const adapter = {
    account: async () => account,
    submit: async () => {
      post++;
      return { id: "ord1", status: "accepted" };
    },
  };
  await submitIntent(db, { ...base, adapter });
  await assert.rejects(
    submitIntent(db, { ...base, adapter, qty: 2 }),
    /paramètres|parâmetros/,
  );
  await assert.rejects(
    submitIntent(db, { ...base, adapter, side: "sell" }),
    /parâmetros/,
  );
  assert.equal(post, 1);
  db.close();
});
test("timeout lookup 404 remains UNKNOWN and never proves safe redelivery", async () => {
  const db = openDb(":memory:");
  ready(db);
  let post = 0;
  const adapter = {
    account: async () => account,
    submit: async () => {
      post++;
      throw Error("timeout");
    },
    byClientId: async () => {
      throw Object.assign(Error("missing"), { code: "NOT_FOUND" });
    },
  };
  await submitIntent(db, { ...base, adapter });
  assert.equal((await reconcile(db, { ...base, adapter })).unknown, 1);
  const duplicate = await submitIntent(db, { ...base, adapter });
  assert.equal(duplicate.status, "UNKNOWN");
  assert.equal(post, 1);
  db.close();
});

test("late accepted acknowledgement never regresses a FILLED order from the trade stream", async () => {
  const db = openDb(":memory:");
  ready(db);
  const cid = (await import("../src/oms.mjs")).clientOrderId(base);
  const adapter = {
    account: async () => account,
    submit: async () => {
      storeOrders(db, base.broker, base.accountId, [
        { id: "late-ack", status: "filled", client_order_id: cid },
      ]);
      return { id: "late-ack", status: "accepted" };
    },
  };
  await submitIntent(db, { ...base, adapter });
  assert.equal(
    db.prepare("SELECT status FROM order_intents").get().status,
    "FILLED",
  );
  assert.equal(
    db.prepare("SELECT status FROM broker_orders").get().status,
    "FILLED",
  );
  db.close();
});
