import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const appUrl = process.env.APP_URL ?? "http://localhost:5173/";
const artifactDir = path.resolve("artifacts");
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 }
];

const requiredText = [
  "IDEC 캘린더",
  "강좌 분류",
  "캠퍼스",
  "강의 형태",
  "상태",
  "강의 캘린더",
  "선택 강의",
  "신청 기간",
  "전체 신청"
];

await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const failures = [];

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport });
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto(appUrl, { waitUntil: "networkidle" });

  const overlayVisible = await page
    .locator(".vite-error-overlay, #webpack-dev-server-client-overlay")
    .count();
  if (overlayVisible > 0) {
    failures.push(`${viewport.name}: Vite error overlay is visible`);
  }

  const bodyText = await page.locator("body").innerText();
  if (bodyText.trim().length < 100) {
    failures.push(`${viewport.name}: page body is unexpectedly sparse`);
  }

  for (const text of requiredText) {
    if (!bodyText.includes(text)) {
      failures.push(`${viewport.name}: missing text "${text}"`);
    }
  }

  const lectureRows = await page.locator(".month-span, .selected-lecture").count();
  if (lectureRows === 0) {
    failures.push(`${viewport.name}: no lecture UI items rendered`);
  }

  const lectureBars = page.locator(".calendar-panel .month-span");
  const lectureBarCount = await lectureBars.count();
  if (lectureBarCount === 0) {
    failures.push(`${viewport.name}: no lecture calendar bars rendered`);
  } else {
    await lectureBars.nth(Math.min(1, lectureBarCount - 1)).click();
    const activeBars = await page.locator(".calendar-panel .month-span.active").count();
    if (activeBars !== 1) {
      failures.push(`${viewport.name}: selected lecture bar is not highlighted`);
    }
    const applicationBars = await page.locator(".application-panel .application-span").count();
    if (applicationBars === 0) {
      failures.push(`${viewport.name}: selected lecture application periods are not rendered`);
    }
  }

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 2) {
    failures.push(
      `${viewport.name}: horizontal overflow (${overflow.scrollWidth}px > ${overflow.clientWidth}px)`
    );
  }

  const screenshotPath = path.join(artifactDir, `home-${viewport.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`${viewport.name}: screenshot saved to ${screenshotPath}`);

  if (consoleErrors.length) {
    failures.push(`${viewport.name}: console errors: ${consoleErrors.join(" | ")}`);
  }
  if (pageErrors.length) {
    failures.push(`${viewport.name}: page errors: ${pageErrors.join(" | ")}`);
  }

  await page.close();
}

await browser.close();

if (failures.length) {
  console.error("UI verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("UI verification passed.");
