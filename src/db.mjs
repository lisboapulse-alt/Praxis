import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { migrate } from "./storage.mjs";

export function openDb(
  filename = process.env.PRAXIS_DB || "./state/praxis.sqlite",
) {
  if (filename !== ":memory:")
    mkdirSync(dirname(resolve(filename)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS connections (
      type TEXT PRIMARY KEY, encrypted TEXT NOT NULL, masked TEXT NOT NULL,
      verified_at TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, summary TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS order_intents (
      id TEXT PRIMARY KEY, broker TEXT NOT NULL, account_id TEXT NOT NULL,
      signal_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, qty TEXT NOT NULL,
      client_order_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, broker_order_id TEXT,
      error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, happened_at TEXT NOT NULL,
      action TEXT NOT NULL, detail TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS equity_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, broker TEXT NOT NULL, account_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL, equity TEXT NOT NULL, cash TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_orders_status ON order_intents(status,updated_at);
    CREATE INDEX IF NOT EXISTS idx_snapshots_account ON equity_snapshots(broker,account_id,recorded_at);
  `);
  if (!db.prepare("SELECT value FROM settings WHERE key=?").get("run_mode"))
    db.prepare("INSERT INTO settings VALUES (?,?)").run("run_mode", "DISARMED");
  if (!db.prepare("SELECT value FROM settings WHERE key=?").get("kill_switch"))
    db.prepare("INSERT INTO settings VALUES (?,?)").run("kill_switch", "1");
  if (!db.prepare("SELECT value FROM settings WHERE key=?").get("auto_enabled"))
    db.prepare("INSERT INTO settings VALUES (?,?)").run("auto_enabled", "0");
  migrate(db);
  return db;
}
export const setting = (db, key, fallback = null) =>
  db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value ??
  fallback;
export const setSetting = (db, key, value) =>
  db
    .prepare(
      "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(key, String(value));
export const audit = (db, action, detail = {}) =>
  db
    .prepare("INSERT INTO audit(happened_at,action,detail) VALUES (?,?,?)")
    .run(new Date().toISOString(), action, JSON.stringify(detail));
export function orderList(db, limit = 60) {
  return db
    .prepare(
      "SELECT id,broker,account_id,signal_id,symbol,side,qty,client_order_id,status,broker_order_id,error_code,reference_price,data_time,latency_ms,strategy_version,created_at,updated_at FROM order_intents ORDER BY created_at DESC LIMIT ?",
    )
    .all(Math.min(500, Math.max(1, limit)));
}
export function snapshots(db, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db
    .prepare(
      "SELECT recorded_at,equity,cash,broker,account_id FROM equity_snapshots WHERE recorded_at>=? ORDER BY recorded_at ASC LIMIT 2500",
    )
    .all(since);
}
