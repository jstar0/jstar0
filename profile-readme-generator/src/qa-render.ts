import fs from "node:fs";
import path from "node:path";
import { loadProfileData, PROJECT_ROOT } from "./model.ts";
import { computeLayouts } from "./layout.ts";
import { layout } from "./theme.ts";
import { browserLaunchOptions, loadPlaywright } from "./qa-browser.ts";

const generatedDir = path.join(PROJECT_ROOT, "generated");
const outputDir = path.join(PROJECT_ROOT, "qa", "output");

async function renderSvg(browser: any, filename: string, outputName: string, width: number, height: number): Promise<void> {
  const svgPath = path.join(generatedDir, filename);
  const htmlPath = path.join(outputDir, `${outputName}.html`);
  const screenshotPath = path.join(outputDir, `${outputName}.png`);
  const svgUrl = `file://${svgPath}`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; width: ${width}px; height: ${height}px; background: #fff; overflow: hidden; }
img { display: block; width: ${width}px; height: ${height}px; }
  </style></head><body><img src="${svgUrl}" alt=""></body></html>`;
  fs.writeFileSync(htmlPath, html, "utf8");

  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
  await page.locator("img").waitFor({ state: "visible" });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.close();
}

async function main(): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });
  const coordinates = computeLayouts(loadProfileData());
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(browserLaunchOptions());
  try {
    await renderSvg(browser, "profile-wide-mockup-static.svg", "wide-mockup", coordinates.wide.width, coordinates.wide.height + layout.githubChromeHeight);
    await renderSvg(browser, "profile-wide-static.svg", "wide-body", coordinates.wide.width, coordinates.wide.height);
    await renderSvg(browser, "profile-narrow-static.svg", "narrow-body", coordinates.narrow.width, coordinates.narrow.height);
  } finally {
    await browser.close();
  }
  console.log(`Rendered QA screenshots to ${outputDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
