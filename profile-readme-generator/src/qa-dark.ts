import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadProfileData, PROJECT_ROOT } from "./model.ts";
import { computeLayouts } from "./layout.ts";
import { renderProfile, renderReadmeSnippet } from "./renderer.ts";
import { computeSplitLayouts, splitAssetFilename } from "./split-layout.ts";
import { browserLaunchOptions, loadPlaywright } from "./qa-browser.ts";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");
const generated = path.join(PROJECT_ROOT, "generated");
const output = path.join(PROJECT_ROOT, "qa", "output", "dark-mode");
const background = [13, 17, 23];

function readPng(file: string) {
  return PNG.sync.read(fs.readFileSync(file)) as { width: number; height: number; data: Uint8Array };
}

function visibleMask(file: string, bg: number[]): Uint8Array {
  const image = readPng(file);
  const mask = new Uint8Array(image.width * image.height);
  for (let i = 0; i < mask.length; i += 1) {
    const offset = i * 4;
    mask[i] = Math.abs(image.data[offset] - bg[0]) + Math.abs(image.data[offset + 1] - bg[1]) + Math.abs(image.data[offset + 2] - bg[2]) > 9 ? 1 : 0;
  }
  return mask;
}

function compareMasks(first: Uint8Array, second: Uint8Array): { intersection: number; union: number; iou: number } {
  assert.equal(first.length, second.length);
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < first.length; i += 1) {
    if (first[i] && second[i]) intersection += 1;
    if (first[i] || second[i]) union += 1;
  }
  return { intersection, union, iou: intersection / union };
}

function assertCanvas(file: string, width: number, height: number): Record<string, unknown> {
  const image = readPng(file);
  assert.equal(image.width, width, `${file} width changed`);
  assert.equal(image.height, height, `${file} height changed`);
  let exactBackground = 0;
  for (let i = 0; i < image.width * image.height; i += 1) {
    const offset = i * 4;
    if (image.data[offset] === background[0] && image.data[offset + 1] === background[1] && image.data[offset + 2] === background[2]) exactBackground += 1;
  }
  for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
    const offset = (y * width + x) * 4;
    assert.deepEqual([...image.data.slice(offset, offset + 3)], background, `${file} corner is not GitHub dark canvas`);
  }
  return { width, height, exactBackgroundPixels: exactBackground, exactBackgroundRatio: exactBackground / (width * height) };
}

function svgGeometry(svg: string): string {
  return svg
    .replaceAll(/#[0-9a-fA-F]{6}/g, "#COLOR")
    .replaceAll(/fill="[^"]+"/g, "fill=\"COLOR\"")
    .replaceAll(/stroke="[^"]+"/g, "stroke=\"COLOR\"")
    .replaceAll(/style="background:[^"]+"/g, "style=\"background:COLOR\"");
}

async function main(): Promise<void> {
  fs.mkdirSync(output, { recursive: true });
  const data = loadProfileData();
  const layouts = computeLayouts(data);
  const lightSvg = renderProfile(data, "wide", false, "light");
  const darkSvg = renderProfile(data, "wide", false, "dark");
  const lightPath = path.join(output, "geometry-light.svg");
  const darkPath = path.join(output, "geometry-dark.svg");
  fs.writeFileSync(lightPath, lightSvg, "utf8");
  fs.writeFileSync(darkPath, darkSvg, "utf8");
  assert.equal(svgGeometry(lightSvg), svgGeometry(darkSvg), "dark theme changed SVG geometry or text structure");

  const canvas = {
    wide: assertCanvas(path.join(generated, "profile-wide-dark-static.png"), layouts.wide.width, layouts.wide.height),
    narrow: assertCanvas(path.join(generated, "profile-narrow-dark-static.png"), layouts.narrow.width, layouts.narrow.height)
  };
  const lightMask = visibleMask(path.join(generated, "profile-wide-static.png"), [255, 255, 255]);
  const darkMask = visibleMask(path.join(generated, "profile-wide-dark-static.png"), background);
  const geometry = compareMasks(lightMask, darkMask);
  assert.ok(geometry.iou > 0.99, `dark/light visible geometry drifted to ${geometry.iou}`);

  const snippet = renderReadmeSnippet(data);
  const expectedFragments = 1 + 1 + data.upstreamExamples.length * 2 + 1 + data.personalProjects.length + 1 + 1;
  const pictures = [...snippet.matchAll(/<picture>/g)].length;
  assert.equal(pictures, expectedFragments);
  assert.ok([...snippet.matchAll(/profile-wide-dark-[^"\s]+/g)].length >= expectedFragments);
  assert.ok([...snippet.matchAll(/profile-narrow-dark-[^"\s]+/g)].length >= expectedFragments);

  const fragments = [
    ...Object.values(computeSplitLayouts(data)).flatMap((layout) => layout.fragments)
  ];
  const missing: string[] = [];
  for (const fragment of fragments) {
    for (const variant of ["static", "motion"] as const) {
      const file = path.join(generated, splitAssetFilename(fragment, variant as "static" | "motion", "svg", "dark"));
      if (!fs.existsSync(file)) missing.push(file);
    }
  }
  assert.deepEqual(missing, [], "dark split asset set is incomplete");

  const report = { canvas, geometry, generatedDarkAssets: fragments.length * 2, output: [lightPath, darkPath] };
  fs.writeFileSync(path.join(output, "dark-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
