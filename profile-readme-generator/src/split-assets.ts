import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { ProfileData } from "./model.ts";
import { computeSplitLayouts, splitAssetFilename, splitFragmentHasMotion, type SplitFragment } from "./split-layout.ts";
import { renderSplitFragmentSvg } from "./renderer.ts";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs") as {
  PNG: {
    sync: {
      read(input: Buffer): { width: number; height: number; data: Uint8Array };
      write(input: { width: number; height: number; data: Uint8Array }): Buffer;
    };
  };
};

interface CropSource {
  width: number;
  height: number;
  data: Uint8Array;
}

function readPng(filePath: string): CropSource {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function cropPng(source: CropSource, fragment: SplitFragment): Buffer {
  if (
    fragment.x < 0 ||
    fragment.y < 0 ||
    fragment.x + fragment.width > source.width ||
    fragment.y + fragment.height > source.height
  ) {
    throw new Error(`Split crop is outside source PNG: ${fragment.key}`);
  }

  const data = new Uint8Array(fragment.width * fragment.height * 4);
  for (let y = 0; y < fragment.height; y += 1) {
    const sourceOffset = ((fragment.y + y) * source.width + fragment.x) * 4;
    const targetOffset = y * fragment.width * 4;
    data.set(
      source.data.subarray(sourceOffset, sourceOffset + fragment.width * 4),
      targetOffset
    );
  }
  return PNG.sync.write({ width: fragment.width, height: fragment.height, data });
}

function writeSvgAssets(data: ProfileData, outputDir: string, motion: boolean): number {
  const layouts = computeSplitLayouts(data);
  let count = 0;
  for (const fragment of [...layouts.wide.fragments, ...layouts.narrow.fragments]) {
    const staticFilename = splitAssetFilename(fragment, "static", "svg");
    fs.writeFileSync(
      path.join(outputDir, staticFilename),
      renderSplitFragmentSvg(data, fragment, false),
      "utf8"
    );
    count += 1;

    // A static refresh must not overwrite the normal motion files that the
    // publish README references. The static filenames are sufficient for the
    // explicit static build; the normal aliases are emitted by the publish
    // build only.
    if (motion) {
      const normalFilename = splitAssetFilename(fragment, "motion", "svg");
      fs.writeFileSync(
        path.join(outputDir, normalFilename),
        renderSplitFragmentSvg(data, fragment, splitFragmentHasMotion(fragment)),
        "utf8"
      );
      count += 1;
    }
  }
  return count;
}

function writePngAssets(
  data: ProfileData,
  outputDir: string,
  sourcePaths: { wide: string; narrow: string }
): number {
  const layouts = computeSplitLayouts(data);
  const sources = {
    wide: readPng(sourcePaths.wide),
    narrow: readPng(sourcePaths.narrow)
  };
  let count = 0;
  for (const mode of ["wide", "narrow"] as const) {
    for (const fragment of layouts[mode].fragments) {
      const filename = splitAssetFilename(fragment, "static", "png");
      fs.writeFileSync(path.join(outputDir, filename), cropPng(sources[mode], fragment));
      count += 1;
    }
  }
  return count;
}

export function writeSplitAssets(
  data: ProfileData,
  outputDir: string,
  options: {
    motion: boolean;
    pngSources?: { wide: string; narrow: string };
  }
): { svgCount: number; pngCount: number } {
  fs.mkdirSync(outputDir, { recursive: true });
  const svgCount = writeSvgAssets(data, outputDir, options.motion);
  const pngCount = options.pngSources
    ? writePngAssets(data, outputDir, options.pngSources)
    : 0;
  return { svgCount, pngCount };
}
