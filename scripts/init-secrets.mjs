import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const target = process.env.PRAXIS_ENV_TARGET || ".env";
writeFileSync(
  target,
  `NODE_USE_ENV_PROXY=1\nPRAXIS_HOST=127.0.0.1\nPRAXIS_PORT=8787\nPRAXIS_DB=${target.startsWith("/etc/") ? "/var/lib/praxis/praxis.sqlite" : "./state/praxis.sqlite"}\nPRAXIS_ADMIN_PASS=${randomBytes(32).toString("hex")}\nPRAXIS_VAULT_KEY=${randomBytes(32).toString("base64")}\nPRAXIS_COOKIE_SECURE=${target.startsWith("/etc/") ? "1" : "0"}\nPRAXIS_STRATEGY_POLL_SECONDS=90\n`,
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Segredos gerados no ficheiro privado: " +
    target +
    "; nenhuma chave broker incluída.",
);
