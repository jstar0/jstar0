import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadProfileData, PROJECT_ROOT } from "./model.ts";
import { computeSplitLayouts } from "./split-layout.ts";
import { renderSplitFragmentText } from "./renderer.ts";

const outputDirectory = path.join(PROJECT_ROOT, "generated", "font-subsets");

export function prepareFontSubsets(data = loadProfileData()): void {
  const fragments = [
    ...computeSplitLayouts(data).wide.fragments,
    ...computeSplitLayouts(data).narrow.fragments
  ];
  const manifestDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "jstar-profile-fonts-"));
  const manifestPath = path.join(manifestDirectory, "manifest.json");
  const manifest = Object.fromEntries(fragments.map((fragment) => [
    `profile-${fragment.mode}-split-${fragment.key}`,
    renderSplitFragmentText(data, fragment)
  ]));

  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const filename of fs.readdirSync(outputDirectory)) {
    if (filename.endsWith(".woff2")) fs.rmSync(path.join(outputDirectory, filename));
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
  try {
    execFileSync("uv", [
      "run",
      "--with",
      "fonttools==4.59.0",
      "--with",
      "brotli==1.1.0",
      "--no-project",
      "python",
      path.join(PROJECT_ROOT, "scripts", "subset-fonts.py"),
      "--manifest",
      manifestPath,
      "--output-dir",
      outputDirectory
    ], { cwd: PROJECT_ROOT, stdio: "inherit" });
  } finally {
    fs.rmSync(manifestDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  prepareFontSubsets();
}
