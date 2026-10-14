import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
test(
  "real HTTP server: admin auth, CSRF guard, paper disarm, no exposure of creds",
  { timeout: 20000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-test-"));
    const port = 18000 + Math.floor(Math.random() * 1000),
      base = `http://127.0.0.1:${port}`;
    const password = randomBytes(28).toString("hex");
    const child = spawn(process.execPath, ["src/server.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PRAXIS_HOST: "127.0.0.1",
        PRAXIS_PORT: String(port),
        PRAXIS_DB: join(dir, "praxis.sqlite"),
        PRAXIS_ADMIN_PASS: password,
        PRAXIS_SESSION_SECRET: randomBytes(48).toString("hex"),
        PRAXIS_VAULT_KEY: randomBytes(32).toString("base64"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      let ready = false;
      for (let i = 0; i < 65; i++) {
        try {
          const r = await fetch(base + "/api/health");
          ready = r.status === 200;
          if (ready) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 60));
      }
      assert.equal(ready, true, "server must listen");
      let r = await fetch(base + "/api/auth/session");
      assert.equal(r.status, 401);
      r = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      assert.equal(r.status, 403, "mutation without X-Praxis-Action forbidden");
      r = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Praxis-Action": "1" },
        body: JSON.stringify({ password }),
      });
      assert.equal(r.status, 200);
      const cookie = r.headers.get("set-cookie").split(";")[0];
      assert.ok(cookie.includes("praxis-session="));
      r = await fetch(base + "/api/engine", { headers: { Cookie: cookie } });
      assert.equal(r.status, 200);
      let j = await r.json();
      assert.equal(j.mode, "DISARMED");
      assert.equal(j.killSwitch, true);
      assert.equal(j.profile, "DEMO_UNRESTRICTED");
      assert.equal(j.limits.financialCaps, false);
      r = await fetch(base + "/api/engine/disarm", {
        method: "POST",
        headers: {
          Cookie: cookie,
          "X-Praxis-Action": "1",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      assert.equal(r.status, 200);
      r = await fetch(base + "/api/equity?days=7", {
        headers: { Cookie: cookie },
      });
      assert.deepEqual((await r.json()).points, []);
      r = await fetch(base + "/api/engine/arm", {
        method: "POST",
        headers: {
          Cookie: cookie,
          "X-Praxis-Action": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          broker: "alpaca-trading-paper",
          accountId: "fake-account",
          confirm: "ARMAR PAPER",
        }),
      });
      assert.equal(r.status, 409, "cannot arm without verified keys");
      r = await fetch(base + "/");
      assert.equal(r.status, 200);
      assert.match(await r.text(), /PRAXIS/);
      r = await fetch(base + "/src/server.mjs");
      assert.equal(
        r.status,
        404,
        "server source files not publicly accessible",
      );
      r = await fetch(base + "/api/auth/logout", {
        method: "POST",
        headers: { Cookie: cookie, "X-Praxis-Action": "1" },
        body: "{}",
      });
      assert.equal(r.status, 200);
      r = await fetch(base + "/api/engine", { headers: { Cookie: cookie } });
      assert.equal(r.status, 401, "logout must revoke session");
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", resolve);
        setTimeout(resolve, 2000);
      });
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
