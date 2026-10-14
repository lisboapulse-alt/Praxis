import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
test(
  "HTTP isolation: encrypted credentials, CSRF, paper activation, duplicate request, logout revocation, restart",
  { timeout: 25000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-http-")),
      file = join(dir, "db.sqlite"),
      password = randomBytes(24).toString("hex"),
      port = 20300 + Math.floor(Math.random() * 500),
      base = `http://127.0.0.1:${port}`,
      env = {
        ...process.env,
        PRAXIS_DB: file,
        PRAXIS_HOST: "127.0.0.1",
        PRAXIS_PORT: String(port),
        PRAXIS_ADMIN_PASS: password,
        PRAXIS_VAULT_KEY: randomBytes(32).toString("base64"),
        PRAXIS_STREAMS_ENABLED: "0",
      };
    let child;
    async function start() {
      child = spawn(
        process.execPath,
        ["--import", "./tests/fixtures/mock-network.mjs", "src/server.mjs"],
        { env, stdio: "ignore" },
      );
      for (let i = 0; i < 80; i++) {
        try {
          if ((await fetch(base + "/api/health")).ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 50));
      }
      throw Error("HTTP server startup failed");
    }
    async function stop() {
      const done = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await done;
    }
    let cookie = "";
    async function call(path, method = "GET", payload, extra = {}) {
      return fetch(base + "/api/" + path, {
        method,
        headers: {
          Cookie: cookie,
          "X-Praxis-Action": "1",
          "Content-Type": "application/json",
          ...extra,
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });
    }
    try {
      await start();
      assert.equal((await call("orders")).status, 401);
      let r = await call("auth/login", "POST", { password });
      cookie = r.headers.get("set-cookie").split(";")[0];
      assert.equal(r.status, 200);
      assert.equal(
        (
          await call(
            "engine/disarm",
            "POST",
            {},
            { Origin: "https://evil.example" },
          )
        ).status,
        403,
      );
      r = await call("brokers/alpaca-trading-paper/activate", "POST", {
        key: "FIXTUREKEY123",
        secret: "ISOLATED-SECRET-NEVER-PUBLIC",
      });
      assert.equal(r.status, 200);
      assert.equal(
        JSON.stringify(await r.json()).includes("ISOLATED-SECRET"),
        false,
      );
      const db = new DatabaseSync(file, { readOnly: true });
      const c = db.prepare("SELECT encrypted FROM connections").get().encrypted;
      assert.equal(c.includes("ISOLATED-SECRET"), false);
      db.close();
      assert.equal(
        JSON.stringify(await (await call("brokers")).json()).includes(
          "ISOLATED-SECRET",
        ),
        false,
      );
      assert.equal(
        (
          await call("engine/arm", "POST", {
            broker: "alpaca-live",
            accountId: "account123",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call("engine/arm", "POST", {
            broker: "alpaca-trading-paper",
            accountId: "paper-account-123",
            mode: "MANUAL_PAPER",
          })
        ).status,
        200,
      );
      const order = {
        requestId: "unique-http-request-123",
        symbol: "AAPL",
        qty: 1,
        side: "buy",
      };
      const first = await (await call("orders/manual", "POST", order)).json(),
        second = await (await call("orders/manual", "POST", order)).json();
      assert.equal(first.result.status, "ACCEPTED");
      assert.equal(second.result.duplicated, true);
      await stop();
      await start();
      for (let i = 0; i < 30; i++) {
        const s = await (await call("engine")).json();
        if (s.mode === "MANUAL_PAPER") break;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal((await (await call("orders")).json()).intents.length, 1);
      assert.equal((await (await call("engine")).json()).mode, "MANUAL_PAPER");
      const frozen = new DatabaseSync(file);
      frozen
        .prepare(
          "INSERT INTO settings VALUES('experiment_start',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(new Date(Date.now() - 45 * 86400000).toISOString());
      frozen.close();
      assert.equal(
        (
          await call("strategies/parameters", "POST", {
            fast: 3,
            slow: 10,
            quantity: 1,
          })
        ).status,
        409,
      );
      assert.equal(
        (await call("engine/symbol", "POST", { symbol: "MSFT" })).status,
        409,
      );
      const oldCookie = cookie;
      assert.equal((await call("auth/logout", "POST", {})).status, 200);
      cookie = oldCookie;
      assert.equal((await call("engine")).status, 401);
    } finally {
      if (child && !child.killed) await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
