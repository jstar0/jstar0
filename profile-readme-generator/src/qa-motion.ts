import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { PROJECT_ROOT } from "./model.ts";
import { layout } from "./theme.ts";
import { browserLaunchOptions, loadPlaywright } from "./qa-browser.ts";

const generatedDir = path.join(PROJECT_ROOT, "generated");
const outputDir = path.join(PROJECT_ROOT, "qa", "output", "motion-keyframes");
const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

interface AssetServer {
  baseUrl: string;
  close: () => Promise<void>;
}

function contentType(filename: string): string {
  if (filename.endsWith(".html")) return "text/html; charset=utf-8";
  if (filename.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

async function startAssetServer(): Promise<AssetServer> {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    const route = pathname.startsWith("/generated/")
      ? { prefix: "/generated/", root: generatedDir }
      : pathname.startsWith("/harness/")
        ? { prefix: "/harness/", root: outputDir }
        : undefined;
    if (!route) {
      response.writeHead(404);
      response.end();
      return;
    }

    const filename = pathname.slice(route.prefix.length);
    if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
      response.writeHead(400);
      response.end();
      return;
    }

    const filePath = path.join(route.root, filename);
    if (!fs.existsSync(filePath)) {
      response.writeHead(404);
      response.end();
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentType(filename),
      "Cache-Control": "no-store"
    });
    response.end(fs.readFileSync(filePath));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start the motion QA asset server");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

function harnessUrl(baseUrl: string, htmlPath: string): string {
  return `${baseUrl}/harness/${path.basename(htmlPath)}`;
}

function readSvg(filename: string): string {
  return fs.readFileSync(path.join(generatedDir, filename), "utf8");
}

function writeHtml(filename: string, svg: string): string {
  const htmlPath = path.join(outputDir, `${filename}.html`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style></head><body>${svg}</body></html>`;
  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

function writeExternalHtml(filename: string, svgUrl: string): string {
  const htmlPath = path.join(outputDir, `${filename}.html`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}img{display:block}</style></head><body><img src="${svgUrl}" alt=""></body></html>`;
  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

function writeReducedMotionPictureHtml(filename: string, motionUrl: string, staticUrl: string): string {
  const htmlPath = path.join(outputDir, `${filename}.html`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}img{display:block}</style></head><body><picture><source media="(prefers-reduced-motion: reduce)" srcset="${staticUrl}"><img src="${motionUrl}" alt=""></picture></body></html>`;
  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

async function freezeAnimations(page: any, milliseconds: number): Promise<void> {
  await page.evaluate(async (time: number) => {
    const svg = document.querySelector("svg") as SVGSVGElement | null;
    if (svg?.pauseAnimations && svg.setCurrentTime) {
      svg.pauseAnimations();
      svg.setCurrentTime(time / 1000);
    }
    const animations = document.getAnimations();
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = time;
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, milliseconds);
}

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function renderKeyframes(
  browser: any,
  svgFilename: string,
  prefix: string,
  width: number,
  height: number,
  times: number[]
): Promise<string[]> {
  const htmlPath = writeHtml(prefix, readSvg(svgFilename));
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts?.ready);
  const screenshotPaths: string[] = [];

  for (const time of times) {
    await freezeAnimations(page, time);
    const screenshotPath = path.join(outputDir, `${prefix}-${String(time).padStart(4, "0")}ms.png`);
    await page.screenshot({
      path: screenshotPath,
      fullPage: true
    });
    screenshotPaths.push(screenshotPath);
  }

  await page.close();
  return screenshotPaths;
}

async function renderStatic(
  browser: any,
  svgFilename: string,
  prefix: string,
  width: number,
  height: number
): Promise<string> {
  const htmlPath = writeHtml(prefix, readSvg(svgFilename));
  const screenshotPath = path.join(outputDir, `${prefix}.png`);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts?.ready);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.close();
  return screenshotPath;
}

async function waitForExternalImage(page: any): Promise<void> {
  await page.waitForFunction(() => {
    const image = document.querySelector("img") as HTMLImageElement | null;
    return image?.complete === true && image.naturalWidth > 0;
  });
  await page.evaluate(() => document.fonts?.ready);
}

async function renderExternalMotion(
  browser: any,
  assetBaseUrl: string,
  svgFilename: string,
  prefix: string,
  width: number,
  height: number
): Promise<{ initial: string; snapshot: string }> {
  const htmlPath = writeExternalHtml(prefix, `${assetBaseUrl}/generated/${svgFilename}`);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(harnessUrl(assetBaseUrl, htmlPath), { waitUntil: "load" });
  await waitForExternalImage(page);
  await page.waitForTimeout(20);
  const initial = path.join(outputDir, `${prefix}-load.png`);
  await page.screenshot({ path: initial });
  await page.waitForTimeout(1300);
  const snapshot = path.join(outputDir, `${prefix}-snapshot.png`);
  await page.screenshot({ path: snapshot });
  await page.close();
  return { initial, snapshot };
}

async function renderExternalSnapshot(
  browser: any,
  assetBaseUrl: string,
  svgFilename: string,
  prefix: string,
  width: number,
  height: number,
  reducedMotion = false
): Promise<string> {
  const htmlPath = writeExternalHtml(prefix, `${assetBaseUrl}/generated/${svgFilename}`);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(harnessUrl(assetBaseUrl, htmlPath), { waitUntil: "load" });
  await waitForExternalImage(page);
  await page.waitForTimeout(1300);
  const screenshotPath = path.join(outputDir, `${prefix}.png`);
  await page.screenshot({ path: screenshotPath });
  await page.close();
  return screenshotPath;
}

async function renderReducedMotionPicture(
  browser: any,
  assetBaseUrl: string,
  motionFilename: string,
  staticFilename: string,
  prefix: string,
  width: number,
  height: number
): Promise<string> {
  const htmlPath = writeReducedMotionPictureHtml(
    prefix,
    `${assetBaseUrl}/generated/${motionFilename}`,
    `${assetBaseUrl}/generated/${staticFilename}`
  );
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(harnessUrl(assetBaseUrl, htmlPath), { waitUntil: "load" });
  await waitForExternalImage(page);
  await page.waitForTimeout(1300);
  const screenshotPath = path.join(outputDir, `${prefix}.png`);
  await page.screenshot({ path: screenshotPath });
  await page.close();
  return screenshotPath;
}

interface PixelDiff {
  changedPixels: number;
  ratio: number;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
}

function comparePngs(firstPath: string, secondPath: string, threshold = 12): PixelDiff {
  const first = PNG.sync.read(fs.readFileSync(firstPath));
  const second = PNG.sync.read(fs.readFileSync(secondPath));
  if (first.width !== second.width || first.height !== second.height) {
    throw new Error(`PNG dimension mismatch: ${firstPath} vs ${secondPath}`);
  }

  let changedPixels = 0;
  let minX = first.width;
  let minY = first.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < first.height; y += 1) {
    for (let x = 0; x < first.width; x += 1) {
      const offset = (y * first.width + x) * 4;
      const delta = Math.abs(first.data[offset] - second.data[offset])
        + Math.abs(first.data[offset + 1] - second.data[offset + 1])
        + Math.abs(first.data[offset + 2] - second.data[offset + 2]);
      if (delta <= threshold) continue;
      changedPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return {
    changedPixels,
    ratio: changedPixels / (first.width * first.height),
    boundingBox: changedPixels === 0
      ? null
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  };
}

function comparePngRegions(firstPath: string, secondPath: string, region: Region, threshold = 12): PixelDiff {
  const first = PNG.sync.read(fs.readFileSync(firstPath));
  const second = PNG.sync.read(fs.readFileSync(secondPath));
  if (first.width !== second.width || first.height !== second.height) {
    throw new Error(`PNG dimension mismatch: ${firstPath} vs ${secondPath}`);
  }

  const left = Math.max(0, region.x);
  const top = Math.max(0, region.y);
  const right = Math.min(first.width, region.x + region.width);
  const bottom = Math.min(first.height, region.y + region.height);
  let changedPixels = 0;
  let minX = right;
  let minY = bottom;
  let maxX = left - 1;
  let maxY = top - 1;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * first.width + x) * 4;
      const delta = Math.abs(first.data[offset] - second.data[offset])
        + Math.abs(first.data[offset + 1] - second.data[offset + 1])
        + Math.abs(first.data[offset + 2] - second.data[offset + 2]);
      if (delta <= threshold) continue;
      changedPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return {
    changedPixels,
    ratio: changedPixels / Math.max(1, (right - left) * (bottom - top)),
    boundingBox: changedPixels === 0
      ? null
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  };
}

function parseNumberList(value: string): number[] {
  return value.split(";").map((entry) => Number(entry));
}

interface ParsedWavePath {
  leadX: number;
  tailX: number;
  flat: boolean;
}

function parseWavePathFrame(frame: string): ParsedWavePath {
  const tokens = frame.match(/[A-Za-z]|-?(?:\d+(?:\.\d*)?|\.\d+)/g) || [];
  let cursor = 0;
  const expectCommand = (expected: string): void => {
    if (tokens[cursor++] !== expected) throw new Error(`Unexpected wave command: expected ${expected}.`);
  };
  const readPair = (): { x: number; y: number } => {
    const x = Number(tokens[cursor++]);
    const y = Number(tokens[cursor++]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid wave coordinate.");
    return { x, y };
  };

  expectCommand("M");
  const start = readPair();
  expectCommand("L");
  const lead = readPair();
  const yValues = [start.y, lead.y];
  let tail = lead;

  // Keep this parser tied to the path grammar, not to a particular number of
  // cubic spans. The renderer may change the smoothness of the curve while
  // preserving the same M/L/C/L structure.
  let cubicCount = 0;
  while (tokens[cursor] === "C") {
    expectCommand("C");
    readPair();
    const control = readPair();
    const endpoint = readPair();
    yValues.push(control.y, endpoint.y);
    tail = endpoint;
    cubicCount += 1;
  }
  if (cubicCount === 0) throw new Error("Wave path must contain at least one cubic span.");

  expectCommand("L");
  const finish = readPair();
  yValues.push(finish.y);

  return {
    leadX: lead.x,
    tailX: tail.x,
    flat: yValues.every((value) => Math.abs(value - start.y) < 0.001)
  };
}

function motionSourceReport(svg: string, mode: "wide" | "narrow") {
  const pathMatch = svg.match(/class="motion-wave-path">[\s\S]*?attributeName="d" values="([^"]+)"/);
  const pathAnimation = svg.match(/<animate attributeName="d"[^>]*class="motion-wave-animation"\/>/);
  const gradientMatch = svg.match(new RegExp(
    `id="wave-accent-line-${mode}-motion"[\\s\\S]*?attributeName="x1" values="([^"]+)"`
  ));
  if (!pathMatch || !pathAnimation || !gradientMatch) throw new Error(`Motion source markers missing for ${mode} wave.`);

  const pathFrames = pathMatch[1].split(";").map(parseWavePathFrame);
  const pathLeads = pathFrames.map((frame) => frame.leadX);
  const gradientStarts = parseNumberList(gradientMatch[1]);
  const keyTimesMatch = pathAnimation[0].match(/keyTimes="([^"]+)"/);
  const durationMatch = pathAnimation[0].match(/dur="([0-9.]+)s"/);
  if (!keyTimesMatch || !durationMatch) throw new Error(`Motion timing markers missing for ${mode} wave.`);
  const keyTimes = parseNumberList(keyTimesMatch[1]);
  const durationSeconds = Number(durationMatch[1]);
  const segmentSpeeds = pathLeads.slice(1).map((lead, index) =>
    (lead - pathLeads[index]) / ((keyTimes[index + 1] - keyTimes[index]) * durationSeconds)
  );
  const span = mode === "wide" ? layout.wide : layout.narrow;
  return {
    pathStarts: pathLeads,
    gradientStarts,
    pathMovesRight: pathLeads.every((value, index) => index === 0 || value > pathLeads[index - 1]),
    gradientMovesRight: gradientStarts.every((value, index) => index === 0 || value > gradientStarts[index - 1]),
    durationSeconds,
    segmentSpeeds,
    boundary: {
      first: {
        lead: pathFrames[0].leadX,
        tail: pathFrames[0].tailX,
        flat: pathFrames[0].flat,
        pulseFullyLeft: pathFrames[0].tailX < span.margin
      },
      last: {
        lead: pathFrames[pathFrames.length - 1].leadX,
        tail: pathFrames[pathFrames.length - 1].tailX,
        flat: pathFrames[pathFrames.length - 1].flat,
        pulseFullyRight: pathFrames[pathFrames.length - 1].leadX > span.right
      }
    }
  };
}

function waveStrokeSourceReport(svg: string) {
  return {
    staticPaths: (svg.match(/class="wave-static-path"/g) || []).length,
    motionPaths: (svg.match(/class="motion-wave-path"/g) || []).length,
    legacyAccentPaths: (svg.match(/class="motion-wave-accent"/g) || []).length
  };
}

function waveBandReport(
  imagePaths: string[],
  region: Region,
  threshold = 18
): { maxBands: number; columnsWithMultipleBands: number; frames: Array<{ image: string; maxBands: number; columnsWithMultipleBands: number }> } {
  const frames = imagePaths.map((imagePath) => {
    const png = PNG.sync.read(fs.readFileSync(imagePath));
    let maxBands = 0;
    let columnsWithMultipleBands = 0;

    for (let x = region.x; x < region.x + region.width; x += 1) {
      let bands = 0;
      let inBand = false;
      for (let y = region.y; y < region.y + region.height; y += 1) {
        const offset = (y * png.width + x) * 4;
        const delta = Math.abs(png.data[offset] - 255)
          + Math.abs(png.data[offset + 1] - 255)
          + Math.abs(png.data[offset + 2] - 255);
        const hit = delta > threshold;
        if (hit && !inBand) bands += 1;
        inBand = hit;
      }
      maxBands = Math.max(maxBands, bands);
      if (bands > 1) columnsWithMultipleBands += 1;
    }

    return { image: imagePath, maxBands, columnsWithMultipleBands };
  });

  return {
    maxBands: Math.max(...frames.map((frame) => frame.maxBands)),
    columnsWithMultipleBands: frames.reduce((sum, frame) => sum + frame.columnsWithMultipleBands, 0),
    frames
  };
}

async function main(): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(browserLaunchOptions());
  let assetServer: AssetServer | undefined;
  const times = [0, 1000, 2652, 3467, 4198, 5508, 8160];
  let wideKeyframes: string[] = [];
  let narrowKeyframes: string[] = [];
  let wideExternal: { initial: string; snapshot: string } | undefined;
  let narrowExternal: { initial: string; snapshot: string } | undefined;
  let wideExternalStatic = "";
  let narrowExternalStatic = "";
  let wideExternalReduced = "";
  let narrowExternalReduced = "";

  try {
    assetServer = await startAssetServer();
    wideKeyframes = await renderKeyframes(browser, "profile-wide-mockup.svg", "wide-mockup", 941, 1672, times);
    narrowKeyframes = await renderKeyframes(browser, "profile-narrow.svg", "narrow-body", 680, 2140, times);
    await renderStatic(browser, "profile-wide-mockup-static.svg", "wide-static-inline", 941, 1672);
    await renderStatic(browser, "profile-narrow-static.svg", "narrow-static-inline", 680, 2140);
    wideExternal = await renderExternalMotion(browser, assetServer.baseUrl, "profile-wide-mockup.svg", "wide-external", 941, 1672);
    narrowExternal = await renderExternalMotion(browser, assetServer.baseUrl, "profile-narrow.svg", "narrow-external", 680, 2140);
    wideExternalStatic = await renderExternalSnapshot(browser, assetServer.baseUrl, "profile-wide-mockup-static.svg", "wide-external-static", 941, 1672);
    narrowExternalStatic = await renderExternalSnapshot(browser, assetServer.baseUrl, "profile-narrow-static.svg", "narrow-external-static", 680, 2140);
    wideExternalReduced = await renderReducedMotionPicture(
      browser,
      assetServer.baseUrl,
      "profile-wide-mockup.svg",
      "profile-wide-mockup-static.svg",
      "wide-external-reduced",
      941,
      1672
    );
    narrowExternalReduced = await renderReducedMotionPicture(
      browser,
      assetServer.baseUrl,
      "profile-narrow.svg",
      "profile-narrow-static.svg",
      "narrow-external-reduced",
      680,
      2140
    );
  } finally {
    await browser.close();
    await assetServer?.close();
  }

  const summarize = (keyframes: string[]) => ({
    intervals: keyframes.slice(1).map((frame, index) => ({
      fromMs: times[index],
      toMs: times[index + 1],
      ...comparePngs(keyframes[index], frame)
    }))
  });
  const waveRegions = {
    wide: { x: 40, y: 214, width: 860, height: 35 },
    narrow: { x: 30, y: 145, width: 620, height: 40 }
  };
  const report = {
    timesMs: times,
    sourceDirection: {
      wide: motionSourceReport(readSvg("profile-wide.svg"), "wide"),
      narrow: motionSourceReport(readSvg("profile-narrow.svg"), "narrow")
    },
    sourceStrokes: {
      wide: waveStrokeSourceReport(readSvg("profile-wide.svg")),
      narrow: waveStrokeSourceReport(readSvg("profile-narrow.svg"))
    },
    wide: summarize(wideKeyframes),
    narrow: summarize(narrowKeyframes),
    wave: {
      wide: {
        initialToFirst: comparePngRegions(wideKeyframes[0], wideKeyframes[1], waveRegions.wide),
        firstToSecond: comparePngRegions(wideKeyframes[1], wideKeyframes[2], waveRegions.wide),
        secondToThird: comparePngRegions(wideKeyframes[2], wideKeyframes[3], waveRegions.wide),
        thirdToExit: comparePngRegions(wideKeyframes[3], wideKeyframes[5], waveRegions.wide)
      },
      narrow: {
        initialToFirst: comparePngRegions(narrowKeyframes[0], narrowKeyframes[1], waveRegions.narrow),
        firstToSecond: comparePngRegions(narrowKeyframes[1], narrowKeyframes[2], waveRegions.narrow),
        secondToThird: comparePngRegions(narrowKeyframes[2], narrowKeyframes[3], waveRegions.narrow),
        thirdToExit: comparePngRegions(narrowKeyframes[3], narrowKeyframes[5], waveRegions.narrow)
      }
    },
    waveSingleStroke: {
      wide: waveBandReport(wideKeyframes, waveRegions.wide),
      narrow: waveBandReport(narrowKeyframes, waveRegions.narrow)
    },
    externalImageMode: {
      wide: {
        loadToSnapshot: comparePngs(wideExternal!.initial, wideExternal!.snapshot),
        reducedMotionVsStatic: comparePngs(wideExternalReduced, wideExternalStatic)
      },
      narrow: {
        loadToSnapshot: comparePngs(narrowExternal!.initial, narrowExternal!.snapshot),
        reducedMotionVsStatic: comparePngs(narrowExternalReduced, narrowExternalStatic)
      }
    }
  };
  fs.writeFileSync(path.join(outputDir, "motion-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (report.wide.intervals[0].changedPixels === 0 || report.narrow.intervals[0].changedPixels === 0) {
    throw new Error("Motion QA failed: the first keyframe interval has no visible change.");
  }
  if (!report.sourceDirection.wide.pathMovesRight
    || !report.sourceDirection.wide.gradientMovesRight
    || !report.sourceDirection.narrow.pathMovesRight
    || !report.sourceDirection.narrow.gradientMovesRight) {
    throw new Error("Motion QA failed: wave geometry or color field does not move left to right.");
  }
  for (const [mode, direction] of Object.entries(report.sourceDirection)) {
    const fastest = Math.max(...direction.segmentSpeeds);
    const slowest = Math.min(...direction.segmentSpeeds);
    if (fastest - slowest > 0.5) {
      throw new Error(`Motion QA failed: ${mode} wave speed varies across keyframe segments.`);
    }
  }
  if (!report.sourceDirection.wide.boundary.first.flat
    || !report.sourceDirection.wide.boundary.first.pulseFullyLeft
    || !report.sourceDirection.wide.boundary.last.flat
    || !report.sourceDirection.wide.boundary.last.pulseFullyRight
    || !report.sourceDirection.narrow.boundary.first.flat
    || !report.sourceDirection.narrow.boundary.first.pulseFullyLeft
    || !report.sourceDirection.narrow.boundary.last.flat
    || !report.sourceDirection.narrow.boundary.last.pulseFullyRight) {
    throw new Error("Motion QA failed: the wave must start and end as a flat line outside both visible boundaries.");
  }
  if (report.sourceStrokes.wide.staticPaths !== 1
    || report.sourceStrokes.wide.motionPaths !== 1
    || report.sourceStrokes.wide.legacyAccentPaths !== 0
    || report.sourceStrokes.narrow.staticPaths !== 1
    || report.sourceStrokes.narrow.motionPaths !== 1
    || report.sourceStrokes.narrow.legacyAccentPaths !== 0) {
    throw new Error("Motion QA failed: the masthead wave must have one static path and one live path, with no overlay accent path.");
  }
  if (report.waveSingleStroke.wide.maxBands > 1
    || report.waveSingleStroke.wide.columnsWithMultipleBands > 0
    || report.waveSingleStroke.narrow.maxBands > 1
    || report.waveSingleStroke.narrow.columnsWithMultipleBands > 0) {
    throw new Error("Motion QA failed: the masthead wave contains multiple separated stroke bands.");
  }
  if (report.wave.wide.initialToFirst.changedPixels === 0
    || report.wave.wide.firstToSecond.changedPixels === 0
    || report.wave.narrow.initialToFirst.changedPixels === 0
    || report.wave.narrow.firstToSecond.changedPixels === 0) {
    throw new Error("Motion QA failed: the masthead wave has no visible shape change.");
  }
  if (report.externalImageMode.wide.loadToSnapshot.changedPixels === 0
    || report.externalImageMode.narrow.loadToSnapshot.changedPixels === 0) {
    throw new Error("Motion QA failed: SVG animation is not observable in external image mode.");
  }
  if (report.externalImageMode.wide.reducedMotionVsStatic.changedPixels > 500
    || report.externalImageMode.narrow.reducedMotionVsStatic.changedPixels > 500) {
    throw new Error("Motion QA failed: reduced-motion external image does not match the static fallback.");
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
