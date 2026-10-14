import { chromium } from "@playwright/test";
const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
try {
  await page.goto("http://127.0.0.1:8787");
  await page.locator("#admin-password").fill(process.env.PRAXIS_ADMIN_PASS);
  await page.locator("#login-form button").click();
  await page.locator("#app").waitFor({ state: "visible" });
  await page.screenshot({
    path: "reports/dashboard-overview.png",
    fullPage: true,
  });
  await page.locator('[data-view="markets"]').click();
  await page.screenshot({
    path: "reports/dashboard-markets-empty.png",
    fullPage: true,
  });
  await page.locator("#theme-toggle").click();
  await page.locator('[data-view="monitor"]').click();
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: "reports/dashboard-monitor-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "reports/dashboard-mobile.png",
    fullPage: true,
  });
  console.log(
    "Actual empty-state dashboard screenshots captured; no broker fixtures used.",
  );
} finally {
  await browser.close();
}
