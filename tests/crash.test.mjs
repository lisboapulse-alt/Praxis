import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
test(
  "SIGKILL during POST: SUBMITTING survives, expired lease permits restart, reconciliation finds accepted order",
  { timeout: 45000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-crash-")),
      file = join(dir, "db.sqlite"),
      port = 21100 + Math.floor(Math.random() * 300),
      base = `http://127.0.0.1:${port}`,
      password = randomBytes(24).toString("hex");
    let child,
      cookie = "";
    const env = {
      ...process.env,
      PRAXIS_DB: file,
      PRAXIS_PORT: String(port),
      PRAXIS_HOST: "127.0.0.1",
      PRAXIS_ADMIN_PASS: password,
      PRAXIS_VAULT_KEY: randomBytes(32).toString("base64"),
      PRAXIS_STREAMS_ENABLED: "0",
      PRAXIS_TEST_POST_DELAY_MS: "10000",
    };
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
      throw Error("server startup failed");
    }
    async function request(path, body) {
      return fetch(base + "/api/" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Cookie: cookie,
          "X-Praxis-Action": "1",
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    }
    try {
      await start();
      const login = await request("auth/login", { password });
      cookie = login.headers.get("set-cookie").split(";")[0];
      await request("brokers/alpaca-trading-paper/activate", {
        key: "CRASHKEY",
        secret: "CRASHTESTSECRET",
      });
      await request("engine/arm", {
        broker: "alpaca-trading-paper",
        accountId: "paper-account-123",
        mode: "MANUAL_PAPER",
      });
      const pending = request("orders/manual", {
        requestId: "crash-mid-flight-123",
        symbol: "AAPL",
        qty: 1,
        side: "buy",
      }).catch(() => null);
      for (
        let i = 0;
        i < 100 && !existsSync(file + ".fixture-broker.json");
        i++
      )
        await new Promise((r) => setTimeout(r, 20));
      assert.ok(existsSync(file + ".fixture-broker.json"));
      const db = new DatabaseSync(file, { readOnly: true });
      assert.equal(
        db.prepare("SELECT status FROM order_intents").get().status,
        "SUBMITTING",
      );
      db.close();
      const killed = new Promise((r) => child.once("exit", r));
      child.kill("SIGKILL");
      await killed;
      await pending;
      // Real lease timeout is exercised, without editing database state or speeding the clock.
      await new Promise((r) => setTimeout(r, 31000));
      delete env.PRAXIS_TEST_POST_DELAY_MS;
      await start();
      for (let i = 0; i < 80; i++) {
        const state = await (await request("engine")).json();
        if (state.mode === "MANUAL_PAPER") break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const orders = await (await request("orders")).json();
      assert.equal(orders.intents.length, 1);
      assert.equal(orders.intents[0].status, "ACCEPTED");
      assert.equal(
        (await (await request("engine")).json()).mode,
        "MANUAL_PAPER",
      );
    } finally {
      if (child && child.exitCode === null) {
        const done = new Promise((r) => child.once("exit", r));
        child.kill("SIGTERM");
        await done;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
