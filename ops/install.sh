#!/usr/bin/env bash
set -euo pipefail
# Run as root on an EXISTING Oracle Linux/Ubuntu VM. Creates no cloud resources.
[ "$(id -u)" = 0 ] || { echo 'Run as root on deployment VM'; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)' || { echo 'Install Node 24 LTS first'; exit 1; }
SOURCE_ROOT=$(cd "$(dirname "$0")/.." && pwd)
id praxis >/dev/null 2>&1 || useradd --system --home /var/lib/praxis --create-home --shell /usr/sbin/nologin praxis
install -d -m 700 -o praxis -g praxis /var/lib/praxis /var/backups/praxis /etc/praxis
install -d -m 755 /opt/praxis
# Deploy from the release archive (do not copy local secrets/runtime artifacts).
tar -C "$SOURCE_ROOT" --exclude=.git --exclude=.env --exclude=state --exclude=node_modules --exclude=reports --exclude=test-results -cf - . | tar -C /opt/praxis -xf -
cd /opt/praxis
npm ci --omit=dev
if [ ! -f /etc/praxis/praxis.env ]; then
 PRAXIS_ENV_TARGET=/etc/praxis/praxis.env node /opt/praxis/scripts/init-secrets.mjs
 chown praxis:praxis /etc/praxis/praxis.env
fi
install -m 644 ops/praxis.service /etc/systemd/system/praxis.service
install -m 644 ops/praxis-backup.service ops/praxis-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now praxis.service praxis-backup.timer
systemctl is-active praxis.service
