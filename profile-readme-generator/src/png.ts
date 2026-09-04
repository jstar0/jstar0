import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PROJECT_ROOT } from "./model.ts";
import { browserLaunchOptions, loadPlaywright } from "./qa-browser.ts";

export interface StaticPngInput {
  filename: string;
  svg: string;
  width: number;
  height: number;
}

const require = createRequire(import.meta.url);

function writeRenderFiles(directory: string, input: StaticPngInput): string {
  const baseName = input.filename.replace(/\.png$/i, "");
  const svgPath = path.join(directory, `${baseName}.svg`);
  const htmlPath = path.join(directory, `${baseName}.html`);
  fs.writeFileSync(svgPath, input.svg, "utf8");

  const svgUrl = pathToFileURL(svgPath).href;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; width: ${input.width}px; height: ${input.height}px; background: #fff; overflow: hidden; }
img { display: block; width: ${input.width}px; height: ${input.height}px; }
</style></head><body><img src="${svgUrl}" alt=""></body></html>`;
  fs.writeFileSync(htmlPath, html, "utf8");
  return pathToFileURL(htmlPath).href;
}

async function renderOne(browser: any, directory: string, outputDir: string, input: StaticPngInput): Promise<void> {
  const htmlUrl = writeRenderFiles(directory, input);
  const page = await browser.newPage({
    viewport: { width: input.width, height: input.height },
    deviceScaleFactor: 1
  });
  try {
    await page.goto(htmlUrl, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const image = document.querySelector("img") as HTMLImageElement | null;
      return image?.complete === true && image.naturalWidth > 0;
    });
    await page.evaluate(() => document.fonts?.ready);
    await page.screenshot({
      path: path.join(outputDir, input.filename),
      fullPage: true
    });
  } finally {
    await page.close();
  }
}

export async function writeStaticPngs(
  inputs: StaticPngInput[],
  outputDir = path.join(PROJECT_ROOT, "generated")
): Promise<void> {
  if (inputs.length === 0) return;
  fs.mkdirSync(outputDir, { recursive: true });
  const renderDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "jstar-profile-png-"));
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(browserLaunchOptions());

  try {
    for (const input of inputs) {
      await renderOne(browser, renderDirectory, outputDir, input);
    }
  } finally {
    await browser.close();
    fs.rmSync(renderDirectory, { recursive: true, force: true });
  }
}
