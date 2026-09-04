import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PROJECT_ROOT } from "./model.ts";
import { browserLaunchOptions, loadPlaywright } from "./qa-browser.ts";

const generatedDir = path.join(PROJECT_ROOT, "generated");
const outputDir = path.join(PROJECT_ROOT, "qa", "output", "pixel-edges");
const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

interface EdgeRun {
  left: number;
  right: number;
  width: number;
}

interface RenderedStack {
  screenshotPath: string;
  header: { x: number; y: number; width: number; height: number };
  overview: { x: number; y: number; width: number; height: number };
}

function dataUrl(content: string, mime: string): string {
  return `data:${mime};base64,${Buffer.from(content).toString("base64")}`;
}

function pngDataUrl(filePath: string): string {
  return `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function readPng(filePath: string): Raster {
  return PNG.sync.read(fs.readFileSync(filePath)) as Raster;
}

function isWhite(raster: Raster, x: number, y: number): boolean {
  if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) return false;
  const offset = (y * raster.width + x) * 4;
  return raster.data[offset] >= 251
    && raster.data[offset + 1] >= 251
    && raster.data[offset + 2] >= 251;
}

function longestWhiteRun(raster: Raster, y: number): EdgeRun | null {
  let best: EdgeRun | null = null;
  let start = -1;
  for (let x = 0; x <= raster.width; x += 1) {
    const white = x < raster.width && isWhite(raster, x, y);
    if (white && start < 0) start = x;
    if (white || start < 0) continue;
    const run = { left: start, right: x - 1, width: x - start };
    if (!best || run.width > best.width) best = run;
    start = -1;
  }
  return best;
}

function edgeAt(raster: Raster, y: number): EdgeRun {
  const candidates = [y - 1, y, y + 1]
    .map((row) => longestWhiteRun(raster, row))
    .filter((run): run is EdgeRun => run !== null && run.width > 40);
  if (candidates.length === 0) throw new Error(`No white canvas run found near physical row ${y}`);
  return candidates.sort((a, b) => b.width - a.width)[0];
}

function darkness(raster: Raster, x: number, y: number): number {
  if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) return 0;
  const offset = (y * raster.width + x) * 4;
  return Math.max(0, 245 - Math.min(
    raster.data[offset],
    raster.data[offset + 1],
    raster.data[offset + 2]
  ));
}

function inkLeft(raster: Raster, top: number, bottom: number, left: number, right: number): number {
  for (let x = Math.max(0, left); x < Math.min(raster.width, right); x += 1) {
    for (let y = top; y < bottom; y += 1) {
      if (darkness(raster, x, y) > 0) return x;
    }
  }
  throw new Error(`No ink found in physical rows ${top}..${bottom}`);
}

async function renderStack(
  browser: any,
  mode: "wide" | "narrow",
  width: number,
  deviceScaleFactor: number
): Promise<RenderedStack> {
  const headerWidth = mode === "wide" ? 941 : 680;
  const headerHeight = mode === "wide" ? 200 : 210;
  const header = fs.readFileSync(path.join(generatedDir, `profile-${mode}-split-header.svg`), "utf8");
  const overview = path.join(generatedDir, `profile-${mode}-split-overview-static.png`);
  const outputPath = path.join(outputDir, `${mode}-${String(width).replace(".", "_")}-dpr-${deviceScaleFactor}.png`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#0d1117;overflow:hidden}
    #stack{position:absolute;left:31.25px;top:0;width:${width}px}
    img{display:block;width:100%;height:auto}
  </style></head><body><main id="stack">
    <img id="header" src="${dataUrl(header, "image/svg+xml")}" alt="">
    <img id="overview" src="${pngDataUrl(overview)}" alt="">
  </main></body></html>`;
  const htmlPath = path.join(outputDir, `${mode}-${String(width).replace(".", "_")}-dpr-${deviceScaleFactor}.html`);
  fs.writeFileSync(htmlPath, html, "utf8");

  const page = await browser.newPage({
    viewport: {
      width: Math.ceil(width + 80),
      height: Math.ceil((headerHeight + 80) * width / headerWidth)
    },
    deviceScaleFactor
  });
  try {
    await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
    await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
    const boxes = await page.evaluate(() => ({
      header: document.querySelector("#header")?.getBoundingClientRect().toJSON(),
      overview: document.querySelector("#overview")?.getBoundingClientRect().toJSON()
    }));
    if (!boxes.header || !boxes.overview) throw new Error("Pixel-edge harness images did not render");
    await page.screenshot({ path: outputPath, fullPage: true });
    return {
      screenshotPath: outputPath,
      header: boxes.header,
      overview: boxes.overview
    };
  } finally {
    await page.close();
  }
}

function physicalBox(box: { x: number; y: number; width: number; height: number }, dpr: number) {
  return {
    x: box.x * dpr,
    y: box.y * dpr,
    width: box.width * dpr,
    height: box.height * dpr
  };
}

async function main(): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(browserLaunchOptions());
  const edgeReports: Array<Record<string, unknown>> = [];
  const waveReports: Array<Record<string, unknown>> = [];

  try {
    for (const width of [823.25, 823.5, 823.75, 941.25, 1012.5]) {
      for (const dpr of [1, 2]) {
        const rendered = await renderStack(browser, "wide", width, dpr);
        const raster = readPng(rendered.screenshotPath);
        const headerBox = physicalBox(rendered.header, dpr);
        const overviewBox = physicalBox(rendered.overview, dpr);
        const headerEdge = edgeAt(raster, Math.round(headerBox.y + 10 * dpr));
        // The first overview rows contain the section heading. Sample the
        // quiet gap below its intro so text cannot split the white run.
        const overviewEdge = edgeAt(raster, Math.round(overviewBox.y + 68 * dpr));
        const report = {
          width,
          dpr,
          header: headerEdge,
          overview: overviewEdge,
          leftDelta: headerEdge.left - overviewEdge.left,
          rightDelta: headerEdge.right - overviewEdge.right
        };
        if (Math.abs(report.leftDelta) > 0 || Math.abs(report.rightDelta) > 0) {
          throw new Error(`Wide canvas edge mismatch at ${width}px DPR ${dpr}: ${JSON.stringify(report)}`);
        }
        edgeReports.push(report);
      }
    }

    for (const width of [264, 320, 390, 550, 680]) {
      for (const dpr of [1, 2]) {
        const rendered = await renderStack(browser, "narrow", width, dpr);
        const raster = readPng(rendered.screenshotPath);
        const headerBox = physicalBox(rendered.header, dpr);
        const overviewBox = physicalBox(rendered.overview, dpr);
        const scale = width / 680;
        const waveTop = Math.round(headerBox.y + (170 - 4) * scale * dpr);
        const waveBottom = Math.round(headerBox.y + (170 + 4) * scale * dpr);
        const titleTop = Math.round(overviewBox.y);
        const titleBottom = Math.round(overviewBox.y + 35 * scale * dpr);
        const imageLeft = Math.round(headerBox.x);
        const imageRight = Math.round(headerBox.x + headerBox.width);
        const waveLeft = inkLeft(raster, waveTop, waveBottom, imageLeft, imageRight);
        const titleLeft = inkLeft(raster, titleTop, titleBottom, Math.round(overviewBox.x), Math.round(overviewBox.x + overviewBox.width));
        // Work in CSS-equivalent pixels so a one-device-pixel antialiasing
        // difference is not over-weighted at a small rendered width.
        const cssDelta = (waveLeft - titleLeft) / dpr;
        const report = { width, dpr, waveLeft, titleLeft, cssDelta };
        if (Math.abs(cssDelta) > 1.05) {
          throw new Error(`Narrow wave/title ink axis mismatch at ${width}px DPR ${dpr}: ${JSON.stringify(report)}`);
        }
        waveReports.push(report);
      }
    }
  } finally {
    await browser.close();
  }

  const report = {
    wideCanvasEdges: edgeReports,
    narrowWaveTitleAxis: waveReports,
    note: "Wide edge checks use the rendered raster at fractional CSS widths and DPR 1/2. Narrow axis checks compare the wave ink band with the PNG overview heading after the same centering/scaling pass."
  };
  fs.writeFileSync(path.join(outputDir, "pixel-edge-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
