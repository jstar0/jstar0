import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { avatar, renderDefs } from "./sections.ts";
import { computeLayouts } from "./layout.ts";
import { loadProfileData, PROJECT_ROOT } from "./model.ts";
import { browserLaunchOptions, loadPlaywright } from "./qa-browser.ts";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");
const output = path.join(PROJECT_ROOT, "qa", "output", "avatar-compare");
const reference = path.join(PROJECT_ROOT, "assets", "reference-jstar-avatar.png");

function compare(referencePath: string, candidatePath: string, threshold: number, overlayPath?: string) {
  const a = PNG.sync.read(fs.readFileSync(referencePath));
  const b = PNG.sync.read(fs.readFileSync(candidatePath));
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  const overlay = new PNG({ width: a.width, height: a.height });
  let intersection = 0;
  let union = 0;
  let mismatch = 0;
  const parts = { ring: { intersection: 0, union: 0 }, body: { intersection: 0, union: 0 } };
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      // Detect visible ink, ignoring its hue. The same threshold is used for
      // the reference, old candidate, and replacement; RGB equality is not claimed.
      const first = 255 - Math.min(a.data[i], a.data[i + 1], a.data[i + 2]) > threshold;
      const second = 255 - Math.min(b.data[i], b.data[i + 1], b.data[i + 2]) > threshold;
      const region = Math.hypot((x + 0.5) * 128 / a.width - 64.2, (y + 0.5) * 128 / a.height - 63.6) > 54
        ? parts.ring : parts.body;
      if (first && second) { intersection++; region.intersection++; }
      if (first || second) { union++; region.union++; }
      if (first !== second) mismatch++;
      const rgb = first && second ? [75, 80, 88] : first ? [223, 59, 83] : second ? [0, 168, 199] : [255, 255, 255];
      overlay.data.set([...rgb, 255], i);
    }
  }
  if (overlayPath) fs.writeFileSync(overlayPath, PNG.sync.write(overlay));
  return {
    threshold,
    intersection,
    union,
    mismatchPixels: mismatch,
    iou: intersection / union,
    ringIou: parts.ring.intersection / parts.ring.union,
    bodyIou: parts.body.intersection / parts.body.union
  };
}

async function main(): Promise<void> {
  fs.mkdirSync(output, { recursive: true });
  const definitions = renderDefs(computeLayouts(loadProfileData()).wide);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${definitions}${avatar(0, 0, 128)}</svg>`;
  fs.writeFileSync(path.join(output, "corrected-avatar.svg"), svg);
  const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const pngUrl = `data:image/png;base64,${fs.readFileSync(reference).toString("base64")}`;
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(browserLaunchOptions());
  const measurements = [];
  try {
    for (const dpr of [1, 2]) {
      for (const size of [128, 114, 88, 28]) {
        const page = await browser.newPage({ viewport: { width: size * 2, height: size }, deviceScaleFactor: dpr });
        try {
          await page.setContent(`<style>body{margin:0;display:flex;background:white}img{width:${size}px;height:${size}px;display:block}</style><img id="reference" src="${pngUrl}"><img id="candidate" src="${svgUrl}">`);
          await page.evaluate(async () => { await Promise.all([...document.images].map((image) => image.decode())); });
          const referenceShot = path.join(output, `reference-${size}-${dpr}x.png`);
          const candidateShot = path.join(output, `candidate-${size}-${dpr}x.png`);
          await page.locator("#reference").screenshot({ path: referenceShot });
          await page.locator("#candidate").screenshot({ path: candidateShot });
          measurements.push({ size, dpr, ...compare(referenceShot, candidateShot, 8) });
        } finally { await page.close(); }
      }
    }

    const current = path.join(output, "candidate-128-1x.png");
    const previous = path.join(output, "current-avatar.png");
    const currentOverlay = path.join(output, "corrected-overlay.png");
    const previousOverlay = path.join(output, "previous-overlay.png");
    const final = compare(reference, current, 8, currentOverlay);
    const before = fs.existsSync(previous) ? compare(reference, previous, 8, previousOverlay) : null;
    const thresholds = [8, 24, 40, 60].map((threshold) => compare(reference, current, threshold));
    const url = (file: string) => pathToFileURL(file).href;
    const columns = [
      { label: "Reference PNG", file: reference, detail: "Original 128 x 128 pixels" },
      ...(before ? [{ label: "Previous SVG", file: previous, detail: `Visible-shape IoU: ${(before.iou * 100).toFixed(2)}%` }] : []),
      { label: "Corrected SVG", file: current, detail: `Visible-shape IoU: ${(final.iou * 100).toFixed(2)}%` }
    ];
    const html = `<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:24px;background:#fff;color:#25282d;font:14px Arial,sans-serif}
      h1{font-size:22px;margin:0 0 10px}p{margin:0 0 24px;color:#555}h2{font-size:16px;margin:0 0 8px}
      .grid{display:grid;grid-template-columns:repeat(${columns.length},384px);gap:24px}.large{width:384px;height:384px;image-rendering:pixelated;display:block}
      .small{margin:30px 0 0;display:flex;align-items:start;gap:38px}.pair{display:flex;gap:12px;align-items:start}
      .note{font-size:12px;margin:8px 0 20px}.legend{margin-top:24px}hr{border:0;border-top:1px solid #ddd;margin:24px 0}
    </style><h1>Avatar: reference / previous / corrected</h1><p>Same 128 px canvas, same scale. 3x nearest-neighbor enlargement. No alignment warp, recoloring, or smoothing.</p>
    <div class="grid">${columns.map((column) => `<section><h2>${column.label}</h2><img class="large" src="${url(column.file)}"><div class="note">${column.detail}</div></section>`).join("")}</div>
    <hr><h2>Shape overlay</h2><p>Gray = overlap; red = reference only; cyan = SVG only. Colors and source texture are excluded from this check.</p>
    <div class="grid"><section><img class="large" src="${url(reference)}"><div class="note">Reference</div></section>${before ? `<section><img class="large" src="${url(previousOverlay)}"><div class="note">Previous vs reference</div></section>` : ""}<section><img class="large" src="${url(currentOverlay)}"><div class="note">Corrected vs reference</div></section></div>
    <hr><h2>Actual displayed sizes</h2><div class="small">${[128, 114, 88, 28].map((size) => `<section><h2>${size}px</h2><div class="pair"><img width="${size}" height="${size}" src="${pngUrl}"><img width="${size}" height="${size}" src="${svgUrl}"></div><div class="note">PNG / SVG</div></section>`).join("")}</div>`;
    const comparisonPath = path.join(output, "comparison.html");
    fs.writeFileSync(comparisonPath, html);
    const page = await browser.newPage({ viewport: { width: columns.length * 408 + 24, height: 1250 }, deviceScaleFactor: 1 });
    try {
      await page.goto(url(comparisonPath), { waitUntil: "load" });
      await page.evaluate(async () => { await Promise.all([...document.images].map((image) => image.decode())); });
      await page.screenshot({ path: path.join(output, "avatar-comparison.png"), fullPage: true });
    } finally { await page.close(); }
    const report = { before, final, thresholds, measurements, note: "IoU is visible foreground overlap at the stated white-distance threshold, not RGB similarity. Higher thresholds are reported to expose color and antialias sensitivity. The reference is a 128 px raster; small-size and DPR results are diagnostic, not a 95% identity claim." };
    fs.writeFileSync(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    assert.ok(final.iou >= 0.95, `Avatar foreground IoU regressed to ${final.iou}`);
    assert.ok(final.bodyIou >= 0.95, `Avatar body IoU regressed to ${final.bodyIou}`);
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
