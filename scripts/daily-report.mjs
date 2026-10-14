import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdirSync } from "node:fs";
import { engineState } from "../src/engine.mjs";
import { setting } from "../src/db.mjs";
import { metrics } from "../src/core.mjs";
const db = new DatabaseSync(process.env.PRAXIS_DB || "./state/praxis.sqlite", {
  readOnly: true,
});
const day = process.argv[2] || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
  throw Error("UTC day YYYY-MM-DD required");
try {
  const s = engineState(db),
    points = db
      .prepare(
        "SELECT * FROM equity_snapshots WHERE broker=? AND account_id=? AND substr(recorded_at,1,10)=? ORDER BY recorded_at",
      )
      .all(s.broker || "", s.accountId || "", day),
    result = {
      generatedAt: new Date().toISOString(),
      utcDay: day,
      kind: "PAPER_FORWARD_REPORT",
      engine: s,
      decisions: db
        .prepare("SELECT * FROM audit WHERE substr(happened_at,1,10)=?")
        .all(day),
      signals: db
        .prepare("SELECT * FROM signals WHERE substr(created_at,1,10)=?")
        .all(day),
      orders: db
        .prepare("SELECT * FROM order_intents WHERE substr(created_at,1,10)=?")
        .all(day),
      fills: db
        .prepare("SELECT * FROM fills WHERE substr(filled_at,1,10)=?")
        .all(day),
      equity: points,
      intradayEquityMetrics:
        points.length > 1
          ? {
              pnl: Number(points.at(-1).equity) - Number(points[0].equity),
              maxDrawdown: metrics(points).maxDrawdown,
            }
          : null,
      resourceSamples: db
        .prepare("SELECT * FROM heartbeats WHERE substr(recorded_at,1,10)=?")
        .all(day),
      alerts: db
        .prepare("SELECT * FROM alerts WHERE substr(recorded_at,1,10)=?")
        .all(day),
      notes:
        "Broker validation required. No realized Profit Factor without verified round-trip/cost ledger; no invented returns.",
    };
  mkdirSync("reports", { recursive: true });
  writeFileSync(
    "reports/daily-" + day + ".json",
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  console.log("Daily report written for UTC " + day);
} finally {
  db.close();
}
