#!/usr/bin/env bash
set -euo pipefail
# Run as 'praxis' on the VM; secure and test backup/restore regularly.
SOURCE="${PRAXIS_DB:-/var/lib/praxis/praxis.sqlite}"
DEST="${1:-/var/backups/praxis}"
mkdir -p "$DEST"
chmod 700 "$DEST"
TARGET="$DEST/praxis-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
# SQLite's online backup command via built-in node:sqlite; safe with WAL writers.
SRC="$SOURCE" DST="$TARGET" node --input-type=module <<'JS'
import { DatabaseSync, backup } from 'node:sqlite';
const db = new DatabaseSync(process.env.SRC, {readOnly:true});
try { await backup(db,process.env.DST); } finally { db.close(); }
JS
chmod 600 "$TARGET"
printf 'Backup criado: %s\n' "$TARGET"
