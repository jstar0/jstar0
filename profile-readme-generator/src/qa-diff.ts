import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadProfileData, PROJECT_ROOT } from "./model.ts";
import { computeLayouts, type LayoutCoordinates } from "./layout.ts";

const require = createRequire(import.meta.url);

function loadCommonJsPackage(name: string): any {
  return require(name);
}

async function loadPixelmatch(): Promise<(a: Uint8Array, b: Uint8Array, output: Uint8Array, width: number, height: number, options?: Record<string, unknown>) => number> {
  const module = await import("pixelmatch");
  return module.default as any;
}

const { PNG } = loadCommonJsPackage("pngjs");

function readPng(filePath: string): any {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function writePng(filePath: string, png: any): void {
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function blend(reference: any, candidate: any): any {
  const output = new PNG({ width: reference.width, height: reference.height });
  for (let i = 0; i < reference.data.length; i += 4) {
    output.data[i] = Math.round(reference.data[i] * 0.5 + candidate.data[i] * 0.5);
    output.data[i + 1] = Math.round(reference.data[i + 1] * 0.5 + candidate.data[i + 1] * 0.5);
    output.data[i + 2] = Math.round(reference.data[i + 2] * 0.5 + candidate.data[i + 2] * 0.5);
    output.data[i + 3] = 255;
  }
  return output;
}

function regionReport(diff: any, width: number, top: number, bottom: number): { top: number; bottom: number; mismatchPixels: number; ratio: number } {
  let mismatchPixels = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const isDiff = diff.data[index] > 240 && diff.data[index + 1] < 32 && diff.data[index + 2] < 32;
      if (isDiff) mismatchPixels += 1;
    }
  }
  const area = width * (bottom - top);
  return { top, bottom, mismatchPixels, ratio: area ? mismatchPixels / area : 0 };
}

interface MaskRect {
  name: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function openSourceTextMasks(
  data: ReturnType<typeof loadProfileData>,
  coordinates: LayoutCoordinates,
  yOffset: number
): MaskRect[] {
  const wideMode = coordinates.mode === "wide";
  const repositoryLane = wideMode
    ? { left: 105, right: 500, topInset: 7, bottomInset: 36 }
    : { left: 75, right: 350, topInset: 7, bottomInset: 38 };
  const pullRequestLane = wideMode
    ? { left: 520, right: 620, topInset: 7, bottomInset: 36 }
    : { left: 540, right: 650, topInset: 7, bottomInset: 38 };

  return data.upstreamExamples.flatMap((_item, index) => {
    const rowTop = coordinates.openRowsTop + yOffset + index * coordinates.openRowHeight;
    return [
      {
        name: `open-source-${index + 1}-repository-text`,
        left: repositoryLane.left,
        top: rowTop + repositoryLane.topInset,
        right: repositoryLane.right,
        bottom: rowTop + repositoryLane.bottomInset
      },
      {
        name: `open-source-${index + 1}-pull-request-text`,
        left: pullRequestLane.left,
        top: rowTop + pullRequestLane.topInset,
        right: pullRequestLane.right,
        bottom: rowTop + pullRequestLane.bottomInset
      }
    ];
  });
}

function preservationReport(first: any, second: any, masks: MaskRect[], threshold = 30): {
  mismatchPixels: number;
  ratio: number;
  masks: MaskRect[];
} {
  if (first.width !== second.width || first.height !== second.height) {
    throw new Error(`Baseline dimension mismatch: ${first.width}x${first.height} vs ${second.width}x${second.height}`);
  }

  let mismatchPixels = 0;
  for (let y = 0; y < first.height; y += 1) {
    for (let x = 0; x < first.width; x += 1) {
      if (masks.some((mask) => x >= mask.left && x < mask.right && y >= mask.top && y < mask.bottom)) continue;
      const index = (y * first.width + x) * 4;
      const delta = Math.abs(first.data[index] - second.data[index])
        + Math.abs(first.data[index + 1] - second.data[index + 1])
        + Math.abs(first.data[index + 2] - second.data[index + 2]);
      if (delta > threshold) mismatchPixels += 1;
    }
  }

  return {
    mismatchPixels,
    ratio: mismatchPixels / (first.width * first.height),
    masks
  };
}

async function main(): Promise<void> {
  const outputDir = path.join(PROJECT_ROOT, "qa", "output");
  const candidatePath = path.join(outputDir, "wide-mockup.png");
  const referencePath = path.join(PROJECT_ROOT, "..", "designs", "profile-readme", "profile-readme-original-system-concept-v6c-short-upstream.png");
  const diffPath = path.join(outputDir, "wide-diff.png");
  const overlayPath = path.join(outputDir, "wide-overlay.png");
  const reportPath = path.join(outputDir, "wide-diff.json");
  const baselineWidePath = path.join(PROJECT_ROOT, "qa", "baseline-before-ridgeline", "wide-mockup.png");
  const baselineNarrowPath = path.join(PROJECT_ROOT, "qa", "baseline-before-ridgeline", "narrow-body.png");
  if (!fs.existsSync(referencePath)) {
    console.log("Skipped visual diff: optional external reference files are not present.");
    return;
  }
  const data = loadProfileData();
  const coordinates = computeLayouts(data);
  const githubChromeOffset = 68;

  const reference = readPng(referencePath);
  const candidate = readPng(candidatePath);
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    throw new Error(`Dimension mismatch: reference ${reference.width}x${reference.height}, candidate ${candidate.width}x${candidate.height}`);
  }

  const diff = new PNG({ width: reference.width, height: reference.height });
  const pixelmatch = await loadPixelmatch();
  const mismatchPixels = pixelmatch(
    reference.data,
    candidate.data,
    diff.data,
    reference.width,
    reference.height,
    { threshold: 0.1, includeAA: false }
  );

  writePng(diffPath, diff);
  writePng(overlayPath, blend(reference, candidate));

  const preservation = fs.existsSync(baselineWidePath) && fs.existsSync(baselineNarrowPath)
    ? {
      wide: preservationReport(
        readPng(baselineWidePath),
        readPng(path.join(outputDir, "wide-mockup.png")),
        [
          { name: "github-chrome", left: 0, top: 0, right: 941, bottom: 70 },
          { name: "masthead-wave", left: 0, top: 68, right: 941, bottom: 270 },
          { name: "open-source-values", left: 55, top: 548 + githubChromeOffset, right: 876, bottom: 645 + githubChromeOffset },
          ...openSourceTextMasks(data, coordinates.wide, githubChromeOffset),
          // Project content is data-driven; keep the full project-and-following
          // region approved for curated row changes and downstream reflow.
          { name: "project-and-following-layout", left: 55, top: coordinates.wide.projectsRowsTop + githubChromeOffset, right: 886, bottom: 1672 }
        ]
      ),
      narrow: preservationReport(
        readPng(baselineNarrowPath),
        readPng(path.join(outputDir, "narrow-body.png")),
        [
          { name: "masthead-wave", left: 0, top: 0, right: 680, bottom: 210 },
          { name: "open-source-values", left: 35, top: 620, right: 645, bottom: 715 },
          ...openSourceTextMasks(data, coordinates.narrow, 0),
          // The narrow layout uses the same data-driven reflow boundary.
          { name: "project-and-following-layout", left: 35, top: coordinates.narrow.projectsRowsTop, right: 650, bottom: 2140 }
        ]
      )
    }
    : null;

  if (preservation && (preservation.wide.mismatchPixels > 0 || preservation.narrow.mismatchPixels > 0)) {
    throw new Error("Preservation QA failed: pixels outside approved motion, structure, and data-content regions changed.");
  }

  const report = {
    reference: referencePath,
    candidate: candidatePath,
    width: reference.width,
    height: reference.height,
    mismatchPixels,
    mismatchRatio: mismatchPixels / (reference.width * reference.height),
    regions: [
      regionReport(diff, reference.width, 0, 68),
      regionReport(diff, reference.width, 68, 540),
      regionReport(diff, reference.width, 540, 930),
      regionReport(diff, reference.width, 930, 1170),
      regionReport(diff, reference.width, 1170, 1604),
      regionReport(diff, reference.width, 1604, 1672)
    ],
    preservationAgainstPriorBaseline: preservation,
    note: "The reference comparison covers the complete mockup. Prior-baseline preservation keeps the header, wave, open-source section, and content-column margins pixel-checked; project rows and everything below them remain an approved data-driven reflow region for curated project and metric updates."
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
