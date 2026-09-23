/* global document */
// End-to-end smoke test in a real browser at iPhone size.
// Usage: start the server (npm start), then: BASE_URL=http://localhost:8787 npm run smoke
// Optional: SCREENSHOT_DIR=./shots  CHROMIUM_PATH=/path/to/chrome
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const SHOTS = process.env.SCREENSHOT_DIR;
const executablePath = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const step = (s) => console.log(`• ${s}`);
const nav = (label) => page.locator("nav.bottom-nav button", { hasText: label }).click();

await page.goto(BASE, { waitUntil: "networkidle" });
step("app loaded");
await shot("01-start");

// If a previous LIVE is running, end it for a clean run.
if (await page.locator("button", { hasText: "End LIVE" }).count()) {
  page.once("dialog", (d) => d.accept());
  await page.locator("button", { hasText: "End LIVE" }).click();
  await nav("Live");
}

await page.locator(".seg button", { hasText: "20x" }).first().click();
await page.locator("button", { hasText: "START DEMO LIVE" }).click();
step("demo started at 20x");
await page.waitForSelector(".msg", { timeout: 10_000 });
await page.waitForSelector(".critical-strip", { timeout: 30_000 });
step("critical alert surfaced on the Live screen");
await page.waitForTimeout(1500);
await shot("02-live");

const msgCount = await page.locator(".msg").count();
if (msgCount < 5) throw new Error(`expected chat rows, got ${msgCount}`);
step(`chat rendering (${msgCount} virtualized rows in DOM)`);

await nav("Alerts");
await page.waitForSelector(".alert-card");
await shot("03-alerts");
const cards = await page.locator(".alert-card").count();
step(`alert queue shows ${cards} alerts`);
const firstSeverity = await page.locator(".alert-card").first().getAttribute("class");
if (!firstSeverity?.includes("critical")) throw new Error("critical alert is not on top of the queue");
step("critical alert is at the top of the queue");

await page.locator(".alert-card").first().locator("button.act", { hasText: "BLOCK" }).click();
await page.waitForSelector(".toast");
step(`action result: ${await page.locator(".toast").innerText()}`);
await shot("04-after-action");

await page.locator(".alert-card .alert-user").first().click();
await page.waitForSelector(".sheet .stat-grid");
step("viewer intelligence panel opened");
await page.waitForTimeout(500);
await shot("05-viewer");
await page.locator(".sheet-close").click();

await nav("Viewers");
await page.waitForSelector(".list-row");
await shot("06-viewers");

await nav("Assistant");
await page.locator("button", { hasText: "CATCH ME UP" }).click();
await page.waitForSelector(".catchup-card h3");
step(`catch-up: ${await page.locator(".catchup-card h3").innerText()}`);
await page.waitForTimeout(800);
await shot("07-assistant");

await nav("Analytics");
await page.waitForSelector(".stat-grid");
await page.waitForTimeout(500);
await shot("08-analytics");

await nav("Settings");
await page.waitForSelector(".state-badge");
await shot("09-settings");
await page.locator(".section-title", { hasText: "TikTok" }).scrollIntoViewIfNeeded();
await shot("10-tiktok");

// No horizontal overflow at phone width.
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 0) throw new Error(`horizontal overflow of ${overflow}px`);
step("no horizontal overflow at 390px");

await browser.close();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("SMOKE OK");
