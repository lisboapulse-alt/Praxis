import { DatabaseSync, backup } from "node:sqlite";
import { existsSync } from "node:fs";
const [source, target] = process.argv.slice(2);
if (!source || !target || existsSync(target))
  throw Error(
    "Usage: node ops/restore.mjs backup.sqlite NEW-database.sqlite (target must not exist)",
  );
const db = new DatabaseSync(source, { readOnly: true });
try {
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw Error("Backup integrity failed");
  await backup(db, target);
  console.log(
    "Restore verified. Keep engine stopped; reconcile before resuming.",
  );
} finally {
  db.close();
}
