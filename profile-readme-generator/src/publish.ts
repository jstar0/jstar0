import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./model.ts";

const GENERATED_ROOT = path.join(PROJECT_ROOT, "generated");
const DEFAULT_DESTINATION = path.resolve(PROJECT_ROOT, "..");
const MANIFEST_FILENAME = ".profile-readme-assets.json";
const SAFE_ASSET_NAME = /^[A-Za-z0-9._-]+$/;

interface PublishManifest {
  schemaVersion: 1;
  assets: string[];
}

export interface PublishOptions {
  generatedDir?: string;
  destinationDir: string;
  check?: boolean;
  pruneManaged?: boolean;
}

export interface PublishResult {
  destinationDir: string;
  readme: string;
  assets: string[];
  pruned: string[];
  checked: boolean;
}

function getArgument(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function manifestPath(destinationDir: string): string {
  return path.join(destinationDir, MANIFEST_FILENAME);
}

function readManifest(destinationDir: string): PublishManifest | undefined {
  const filePath = manifestPath(destinationDir);
  if (!fs.existsSync(filePath)) return undefined;

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<PublishManifest>;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.assets)
    || !parsed.assets.every((asset) => typeof asset === "string" && SAFE_ASSET_NAME.test(asset))) {
    throw new Error(`Invalid ${MANIFEST_FILENAME} in ${destinationDir}`);
  }
  return { schemaVersion: 1, assets: [...new Set(parsed.assets)].sort() };
}

function readAssetReferences(readme: string): string[] {
  const references = [...readme.matchAll(/\b(?:src|srcset)="([^"]+)"/g)]
    .flatMap((match) => match[1].split(",").map((candidate) => candidate.trim().split(/\s+/)[0]))
    .filter((candidate) => candidate.length > 0);

  const assets = new Set<string>();
  for (const reference of references) {
    if (!reference.startsWith("./assets/")) {
      throw new Error(`Generated README contains a non-local asset reference: ${reference}`);
    }
    const filename = reference.slice("./assets/".length);
    if (!SAFE_ASSET_NAME.test(filename)) {
      throw new Error(`Generated README contains an unsafe asset filename: ${filename}`);
    }
    assets.add(filename);
  }

  if (assets.size === 0) throw new Error("Generated README does not reference any publish assets");
  return [...assets].sort();
}

function temporaryPath(filePath: string): string {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  return path.join(directory, `.${basename}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
}

function writeAtomic(filePath: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = temporaryPath(filePath);
  try {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function copyAtomic(sourcePath: string, destinationPath: string): void {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const temporary = temporaryPath(destinationPath);
  try {
    fs.copyFileSync(sourcePath, temporary);
    fs.renameSync(temporary, destinationPath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function sameFile(firstPath: string, secondPath: string): boolean {
  if (!fs.existsSync(firstPath) || !fs.existsSync(secondPath)) return false;
  const first = fs.readFileSync(firstPath);
  const second = fs.readFileSync(secondPath);
  return first.equals(second);
}

function manifestContent(assets: string[]): string {
  return `${JSON.stringify({ schemaVersion: 1, assets: [...assets].sort() }, null, 2)}\n`;
}

export function publishProfile(options: PublishOptions): PublishResult {
  const generatedDir = path.resolve(options.generatedDir ?? GENERATED_ROOT);
  const destinationDir = path.resolve(options.destinationDir);
  const generatedReadmePath = path.join(generatedDir, "README.generated.md");
  const generatedReadme = fs.readFileSync(generatedReadmePath, "utf8");
  const assets = readAssetReferences(generatedReadme);
  const oldManifest = readManifest(destinationDir);
  const destinationAssetsDir = path.join(destinationDir, "assets");

  for (const filename of assets) {
    const sourcePath = path.join(generatedDir, filename);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`Generated README references a missing asset: ${sourcePath}`);
    }
  }

  const destinationReadmePath = path.join(destinationDir, "README.md");
  if (options.check) {
    if (!sameFile(generatedReadmePath, destinationReadmePath)) {
      throw new Error("Published README.md is stale; run the publish step to refresh it.");
    }
    for (const filename of assets) {
      if (!sameFile(path.join(generatedDir, filename), path.join(destinationAssetsDir, filename))) {
        throw new Error(`Published asset is stale or missing: assets/${filename}`);
      }
    }
    if (oldManifest && oldManifest.assets.join("\n") !== assets.join("\n")) {
      throw new Error(`${MANIFEST_FILENAME} does not match the generated asset set.`);
    }
    return {
      destinationDir,
      readme: destinationReadmePath,
      assets,
      pruned: [],
      checked: true
    };
  }

  for (const filename of assets) {
    copyAtomic(path.join(generatedDir, filename), path.join(destinationAssetsDir, filename));
  }
  writeAtomic(destinationReadmePath, generatedReadme);
  writeAtomic(manifestPath(destinationDir), manifestContent(assets));

  const pruned: string[] = [];
  if (options.pruneManaged && oldManifest) {
    const current = new Set(assets);
    for (const filename of oldManifest.assets) {
      if (current.has(filename)) continue;
      const stalePath = path.join(destinationAssetsDir, filename);
      if (fs.existsSync(stalePath)) {
        fs.rmSync(stalePath);
        pruned.push(filename);
      }
    }
  }

  return {
    destinationDir,
    readme: destinationReadmePath,
    assets,
    pruned,
    checked: false
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const destinationDir = path.resolve(getArgument(args, "--destination") ?? process.env.PUBLISH_ROOT ?? DEFAULT_DESTINATION);
  const result = publishProfile({
    destinationDir,
    check: args.includes("--check"),
    pruneManaged: args.includes("--prune-managed")
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
