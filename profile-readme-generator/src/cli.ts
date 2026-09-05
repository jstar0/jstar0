import fs from "node:fs";
import path from "node:path";
import { DEFAULT_DATA_PATH, loadProfileData, PROJECT_ROOT } from "./model.ts";
import { computeLayouts } from "./layout.ts";
import { renderProfile, renderReadmeSnippet, renderWideMockup } from "./renderer.ts";
import { writeStaticPngs } from "./png.ts";
import { writeSplitAssets } from "./split-assets.ts";
import { prepareFontSubsets } from "./prepare-font-subsets.ts";
import type { ThemeMode } from "./theme.ts";

const args = new Set(process.argv.slice(2));
const dataArgIndex = process.argv.indexOf("--data");
const dataPath = dataArgIndex >= 0 && process.argv[dataArgIndex + 1]
  ? path.resolve(process.argv[dataArgIndex + 1])
  : DEFAULT_DATA_PATH;
const outputDir = path.join(PROJECT_ROOT, "generated");

function removeStaleSplitAssets(preserveMotion: boolean): void {
  if (!fs.existsSync(outputDir)) return;
  for (const filename of fs.readdirSync(outputDir)) {
    if (!/^profile-(?:wide|narrow)-split-/.test(filename)) continue;
    if (preserveMotion && filename.endsWith(".svg") && !filename.includes("-static.svg")) continue;
    fs.unlinkSync(path.join(outputDir, filename));
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });

  const data = loadProfileData(dataPath);
  prepareFontSubsets(data);
  const motion = !args.has("--static");
  const includePngFallback = !args.has("--no-png");
  const coordinates = computeLayouts(data);
  removeStaleSplitAssets(!motion);

  const outputs = new Map<string, string>();
  for (const theme of ["light", "dark"] as const satisfies ThemeMode[]) {
    const themeSuffix = theme === "dark" ? "-dark" : "";
    const suffix = motion ? "" : "-static";
    outputs.set(`profile-wide${themeSuffix}${suffix}.svg`, renderProfile(data, "wide", motion, theme));
    outputs.set(`profile-narrow${themeSuffix}${suffix}.svg`, renderProfile(data, "narrow", motion, theme));
    outputs.set(`profile-wide-mockup${themeSuffix}${suffix}.svg`, renderWideMockup(data, motion, theme));
    if (motion) {
      outputs.set(`profile-wide${themeSuffix}-static.svg`, renderProfile(data, "wide", false, theme));
      outputs.set(`profile-narrow${themeSuffix}-static.svg`, renderProfile(data, "narrow", false, theme));
      outputs.set(`profile-wide-mockup${themeSuffix}-static.svg`, renderWideMockup(data, false, theme));
    }
  }

  for (const [filename, content] of outputs) {
    fs.writeFileSync(path.join(outputDir, filename), content, "utf8");
  }

  if (!args.has("--no-png")) {
    for (const theme of ["light", "dark"] as const) {
      const themeSuffix = theme === "dark" ? "-dark" : "";
      await writeStaticPngs([
        {
          filename: `profile-wide${themeSuffix}-static.png`,
          svg: renderProfile(data, "wide", false, theme),
          width: coordinates.wide.width,
          height: coordinates.wide.height
        },
        {
          filename: `profile-narrow${themeSuffix}-static.png`,
          svg: renderProfile(data, "narrow", false, theme),
          width: coordinates.narrow.width,
          height: coordinates.narrow.height
        }
      ], outputDir);
    }
  }

  let splitSvgCount = 0;
  let splitPngCount = 0;
  for (const theme of ["light", "dark"] as const) {
    const themeSuffix = theme === "dark" ? "-dark" : "";
    const splitAssets = writeSplitAssets(data, outputDir, {
      motion,
      theme,
      pngSources: includePngFallback
        ? {
          wide: path.join(outputDir, `profile-wide${themeSuffix}-static.png`),
          narrow: path.join(outputDir, `profile-narrow${themeSuffix}-static.png`)
        }
        : undefined
    });
    splitSvgCount += splitAssets.svgCount;
    splitPngCount += splitAssets.pngCount;
  }

  if (motion) {
    fs.writeFileSync(
      path.join(outputDir, "README.generated.md"),
      renderReadmeSnippet(data, { includePngFallback }),
      "utf8"
    );
  }

  console.log(`Generated ${outputs.size} SVG assets (${motion ? "motion" : "static"})`);
  for (const filename of outputs.keys()) {
    const filePath = path.join(outputDir, filename);
    console.log(`${filename}\t${fs.statSync(filePath).size} bytes`);
  }
  if (!args.has("--no-png")) {
    for (const filename of ["profile-wide-static.png", "profile-narrow-static.png"]) {
      const filePath = path.join(outputDir, filename);
      console.log(`${filename}\t${fs.statSync(filePath).size} bytes`);
    }
  }
  console.log(`Split assets\t${splitSvgCount} SVG + ${splitPngCount} PNG`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
