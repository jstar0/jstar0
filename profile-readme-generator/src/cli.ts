import fs from "node:fs";
import path from "node:path";
import { DEFAULT_DATA_PATH, loadProfileData, PROJECT_ROOT } from "./model.ts";
import { computeLayouts } from "./layout.ts";
import { renderProfile, renderReadmeSnippet, renderWideMockup } from "./renderer.ts";
import { writeStaticPngs } from "./png.ts";
import { writeSplitAssets } from "./split-assets.ts";

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
  const motion = !args.has("--static");
  const suffix = motion ? "" : "-static";
  const includePngFallback = !args.has("--no-png");
  const coordinates = computeLayouts(data);
  removeStaleSplitAssets(!motion);

  const outputs = new Map<string, string>([
    [`profile-wide${suffix}.svg`, renderProfile(data, "wide", motion)],
    [`profile-narrow${suffix}.svg`, renderProfile(data, "narrow", motion)],
    [`profile-wide-mockup${suffix}.svg`, renderWideMockup(data, motion)]
  ]);

  if (motion) {
    outputs.set("profile-wide-static.svg", renderProfile(data, "wide", false));
    outputs.set("profile-narrow-static.svg", renderProfile(data, "narrow", false));
    outputs.set("profile-wide-mockup-static.svg", renderWideMockup(data, false));
  }

  for (const [filename, content] of outputs) {
    fs.writeFileSync(path.join(outputDir, filename), content, "utf8");
  }

  if (!args.has("--no-png")) {
    await writeStaticPngs([
      {
        filename: "profile-wide-static.png",
        svg: renderProfile(data, "wide", false),
        width: coordinates.wide.width,
        height: coordinates.wide.height
      },
      {
        filename: "profile-narrow-static.png",
        svg: renderProfile(data, "narrow", false),
        width: coordinates.narrow.width,
        height: coordinates.narrow.height
      }
    ], outputDir);
  }

  const splitAssets = writeSplitAssets(data, outputDir, {
    motion,
    pngSources: includePngFallback
      ? {
        wide: path.join(outputDir, "profile-wide-static.png"),
        narrow: path.join(outputDir, "profile-narrow-static.png")
      }
      : undefined
  });

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
  console.log(`Split assets\t${splitAssets.svgCount} SVG + ${splitAssets.pngCount} PNG`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
