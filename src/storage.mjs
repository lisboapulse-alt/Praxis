import { randomUUID, createHash } from "node:crypto";
export function migrate(db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS liquidation_jobs(id TEXT PRIMARY KEY,broker TEXT,account_id TEXT,symbol TEXT,positions TEXT,status TEXT,results TEXT,created_at TEXT);
 CREATE TABLE IF NOT EXISTS broker_orders(broker TEXT,account_id TEXT,id TEXT,client_order_id TEXT,status TEXT,payload TEXT,updated_at TEXT,PRIMARY KEY(broker,account_id,id));
 CREATE TABLE IF NOT EXISTS order_actions(id TEXT PRIMARY KEY,broker TEXT,account_id TEXT,order_id TEXT,client_order_id TEXT,payload TEXT,status TEXT,result_order_id TEXT,created_at TEXT);
 CREATE TABLE IF NOT EXISTS order_events(event_key TEXT PRIMARY KEY,broker TEXT,account_id TEXT,order_id TEXT,status TEXT,recorded_at TEXT,payload TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_identity ON order_intents(broker,account_id,signal_id);
 CREATE TABLE IF NOT EXISTS fills(broker TEXT,account_id TEXT,id TEXT,order_id TEXT,symbol TEXT,side TEXT,qty REAL,price REAL,filled_at TEXT,payload TEXT,PRIMARY KEY(broker,account_id,id));
 CREATE TABLE IF NOT EXISTS position_snapshots(broker TEXT,account_id TEXT,recorded_at TEXT,payload TEXT,PRIMARY KEY(broker,account_id));
 CREATE TABLE IF NOT EXISTS market_bars(source TEXT,symbol TEXT,timeframe TEXT,t TEXT,o REAL,h REAL,l REAL,c REAL,v REAL,PRIMARY KEY(source,symbol,timeframe,t));
 CREATE TABLE IF NOT EXISTS market_imports(id TEXT PRIMARY KEY,created_at TEXT,broker TEXT,source TEXT,symbol TEXT,timeframe TEXT,feed TEXT,adjustment TEXT,start_at TEXT,end_at TEXT,pages INTEGER,candles INTEGER,complete INTEGER,quality TEXT);
 CREATE INDEX IF NOT EXISTS idx_market_imports_symbol ON market_imports(source,symbol,timeframe,created_at);
 CREATE TABLE IF NOT EXISTS market_ticks(source TEXT,symbol TEXT,kind TEXT,t TEXT,payload TEXT,PRIMARY KEY(source,symbol,kind));
 CREATE TABLE IF NOT EXISTS strategy_versions(version TEXT PRIMARY KEY,params TEXT,created_at TEXT);
 CREATE TABLE IF NOT EXISTS signals(id TEXT PRIMARY KEY,version TEXT,symbol TEXT,bar_time TEXT,side TEXT,price REAL,features TEXT,data_hash TEXT,created_at TEXT);
 CREATE TABLE IF NOT EXISTS research_runs(id TEXT PRIMARY KEY,model TEXT,kind TEXT,input TEXT,output TEXT,latency_ms REAL,created_at TEXT);
 CREATE TABLE IF NOT EXISTS backtest_runs(id TEXT PRIMARY KEY,version TEXT,result TEXT,created_at TEXT);
 CREATE TABLE IF NOT EXISTS heartbeats(id INTEGER PRIMARY KEY,recorded_at TEXT,detail TEXT);
 CREATE TABLE IF NOT EXISTS worker_lock(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT,expires INTEGER);
 CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY,recorded_at TEXT,severity TEXT,code TEXT,detail TEXT,resolved INTEGER DEFAULT 0);
 `);
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(order_intents)")
      .all()
      .map((c) => c.name),
  );
  for (const [name, type] of Object.entries({
    reference_price: "REAL",
    data_time: "TEXT",
    latency_ms: "REAL",
    strategy_version: "TEXT",
  }))
    if (!columns.has(name))
      db.exec("ALTER TABLE order_intents ADD COLUMN " + name + " " + type);
}
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function lease(db, owner, now = Date.now()) {
  return transaction(db, () => {
    const row = db.prepare("SELECT * FROM worker_lock WHERE id=1").get();
    if (row && row.owner !== owner && row.expires > now) return false;
    db.prepare(
      "INSERT INTO worker_lock VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires",
    ).run(owner, now + 30000);
    return true;
  });
}
export const newId = () => randomUUID();
export function saveBars(db, source, symbol, timeframe, bars) {
  transaction(db, () => {
    const q = db.prepare(
      "INSERT INTO market_bars VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source,symbol,timeframe,t) DO UPDATE SET o=excluded.o,h=excluded.h,l=excluded.l,c=excluded.c,v=excluded.v",
    );
    for (const b of bars)
      q.run(source, symbol, timeframe, b.t, b.o, b.h, b.l, b.c, b.v);
  });
}
export function storeOrders(db, broker, accountId, orders) {
  transaction(db, () => {
    for (const o of orders) {
      if (!o?.id) continue;
      const status = String(o.status || "UNKNOWN").toUpperCase();
      const previous = db
        .prepare(
          "SELECT status,payload FROM broker_orders WHERE broker=? AND account_id=? AND id=?",
        )
        .get(broker, accountId, String(o.id));
      const terminal = new Set([
        "FILLED",
        "CANCELED",
        "EXPIRED",
        "REJECTED",
        "REPLACED",
      ]);
      // A delayed POST acknowledgement or stream event cannot undo a terminal fill.
      if (previous && terminal.has(previous.status) && !terminal.has(status))
        continue;
      if (previous && previous.status === "FILLED" && status !== "FILLED")
        continue;
      if (
        previous?.status === "PARTIALLY_FILLED" &&
        ["NEW", "ACCEPTED", "PENDING_NEW"].includes(status)
      )
        continue;

      const eventKey = createHash("sha256")
        .update(
          JSON.stringify([
            broker,
            accountId,
            String(o.id),
            status,
            o.filled_qty || null,
            o.filled_avg_price || null,
          ]),
        )
        .digest("hex");
      db.prepare(
        "INSERT OR IGNORE INTO order_events VALUES(?,?,?,?,?,?,?)",
      ).run(
        eventKey,
        broker,
        accountId,
        String(o.id),
        status,
        new Date().toISOString(),
        JSON.stringify(o),
      );
      db.prepare(
        "INSERT INTO broker_orders VALUES(?,?,?,?,?,?,?) ON CONFLICT(broker,account_id,id) DO UPDATE SET client_order_id=excluded.client_order_id,status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at",
      ).run(
        broker,
        accountId,
        String(o.id),
        o.client_order_id || null,
        status,
        JSON.stringify(o),
        new Date().toISOString(),
      );
      db.prepare(
        "UPDATE order_intents SET status=?,broker_order_id=?,error_code=NULL,updated_at=? WHERE broker=? AND account_id=? AND client_order_id=?",
      ).run(
        status,
        String(o.id),
        new Date().toISOString(),
        broker,
        accountId,
        o.client_order_id || "",
      );
    }
  });
}
export function storeFills(db, broker, accountId, entries) {
  transaction(db, () => {
    for (const f of entries) {
      if (
        !f.id ||
        !Number.isFinite(Number(f.price)) ||
        !Number.isFinite(Number(f.qty)) ||
        Number(f.qty) <= 0 ||
        Number(f.price) <= 0 ||
        !Number.isFinite(Date.parse(f.transaction_time))
      )
        continue;
      db.prepare(
        "INSERT INTO fills VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(broker,account_id,id) DO NOTHING",
      ).run(
        broker,
        accountId,
        String(f.id),
        String(f.order_id),
        f.symbol,
        f.side,
        Number(f.qty),
        Number(f.price),
        f.transaction_time,
        JSON.stringify(f),
      );
    }
  });
}
export function alert(db, code, detail, severity = "error") {
  db.prepare(
    "INSERT INTO alerts(recorded_at,severity,code,detail) VALUES(?,?,?,?)",
  ).run(new Date().toISOString(), severity, code, JSON.stringify(detail));
}
