import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
const password = "E2E-only-password-with-32-characters",
  port = 19287,
  base = `http://127.0.0.1:${port}`;
let child, dir;
test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "praxis-e2e-"));
  child = spawn(
    process.execPath,
    ["--import", "./tests/fixtures/mock-network.mjs", "src/server.mjs"],
    {
      env: {
        ...process.env,
        PRAXIS_DB: join(dir, "db.sqlite"),
        PRAXIS_PORT: String(port),
        PRAXIS_HOST: "127.0.0.1",
        PRAXIS_ADMIN_PASS: password,
        PRAXIS_SESSION_SECRET: randomBytes(40).toString("hex"),
        PRAXIS_VAULT_KEY: randomBytes(32).toString("base64"),
        PRAXIS_STREAMS_ENABLED: "0",
        PRAXIS_TEST_POSITIONS: JSON.stringify([
          {
            symbol: "AAPL",
            side: "long",
            qty: "1.25",
            market_value: "125",
            unrealized_pl: "0",
          },
          {
            symbol: "MSFT",
            side: "short",
            qty: "-2.5",
            market_value: "-250",
            unrealized_pl: "0",
          },
        ]),
      },
      stdio: "ignore",
    },
  );
  await expect
    .poll(async () => {
      try {
        return (await fetch(base + "/api/health")).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);
});
test.afterAll(async () => {
  child?.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  rmSync(dir, { recursive: true, force: true });
});
test("real browser and HTTP backend: login, encrypted connection, order, cancel, backtest, research, logout", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await expect(page.locator("body")).not.toContainText("cTrader");
  await page.locator("#admin-password").fill(password);
  await page.locator("#login-form button").click();
  await expect(page.locator("#app")).toBeVisible();
  await page.locator('[data-view="integrations"]').click();
  await page.locator("#paper-key").fill("FIXTURE-KEY-123");
  await page.locator("#paper-secret").fill("FIXTURE-PRIVATE-SECRET");
  await page.locator("#paper-activate").click();
  await expect(page.locator("#paper-message")).toContainText(
    "Ligação verificada",
  );
  await expect(page.locator("#paper-secret")).toHaveValue("");
  await page.locator("#paper-toggle").click();
  await expect(page.locator("#paper-badge")).toHaveText("DESLIGADO");
  await page.locator("#paper-toggle").click();
  await expect(page.locator("#paper-badge")).toHaveText("ATIVA");

  const leaked = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(leaked).not.toContain("FIXTURE");
  await page.locator('[data-view="executor"]').click();
  await page.locator("#exec-load").click();
  await page.locator("#exec-account").selectOption("paper-account-123");
  await page.locator("#exec-arm").click();
  await expect(page.locator("#exec-badge")).toHaveText("MANUAL_PAPER");
  await page.locator("#manual-order-form button").click();
  await expect(page.locator("#manual-message")).toContainText("ACCEPTED");
  await expect(page.locator("#executor-orders")).toContainText("AAPL");
  await page.locator('[data-view="operations"]').click();
  await page.locator("[data-cancel]").click();
  await expect(page.locator("#orders-table")).toContainText("canceled");
  await page.locator("#order-filter").fill("NONEXISTENT");
  await expect(page.locator("#orders-table")).toContainText("Sem resultados");
  await page.locator("#order-filter").fill("");
  await expect(page.locator("#positions-table")).toContainText(
    "Liquidar posição",
  );
  await page.locator("#liquidate-all").click();
  await expect(page.locator("#toast")).toContainText("Liquidação: SUBMITTED");
  await page.locator('[data-view="markets"]').click();
  await page.locator("#market-form button").click();
  await expect(page.locator("#market-chart svg")).toBeVisible();
  await expect(page.locator("#market-status")).toContainText("40 candles");
  await page.locator('[data-view="backtesting"]').click();
  await page
    .locator(
      '#backtest-form button[type="submit"], #backtest-form .btn.primary',
    )
    .click();
  await expect(page.locator("#bt-message")).toContainText("BACKTEST");
  await expect(page.locator("#bt-chart svg")).toBeVisible();
  await page.locator("#replay-run").click();
  await expect(page.locator("#bt-message")).toContainText("REPLAY");
  await page.locator('[data-view="research"]').click();
  await page
    .locator("#ollama-prompt")
    .fill("O banco central anunciou novas taxas de juro.");
  await page.locator("#ollama-research-form button").click();
  await expect(page.locator("#ollama-answer")).toContainText("TEST FIXTURE");
  await page.locator('[data-view="monitor"]').click();
  await expect(page.locator("#monitor-health")).toContainText("SQLite");
  await expect(page.locator("#monitor-audit")).toContainText(
    "paper_order_acknowledged",
  );
  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/theme-dark/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#menu-toggle").click();
  await expect(page.locator("#sidebar")).toHaveClass(/open/);
  await page.locator('[data-view="executor"]').click();
  await page.locator("#exec-stop").click();
  await expect(page.locator("#exec-badge")).toHaveText("DESARMADO");
  expect(errors).toEqual([]);
  await page.locator("#menu-toggle").click();
  await page.locator("#logout").click();
  await expect(page.locator("#login")).toBeVisible();
});
