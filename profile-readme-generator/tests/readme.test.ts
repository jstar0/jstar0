import assert from "node:assert/strict";
import { computeSplitLayouts, splitAssetFilename } from "../src/split-layout.ts";
import { loadProfileData } from "../src/model.ts";
import {
  renderProfile,
  renderReadmeSnippet,
  renderSingleImageReadmeSnippet,
  renderSplitFragmentSvg,
  renderTextFallback,
  TEXT_FALLBACK_MARKER
} from "../src/renderer.ts";

const data = loadProfileData();
const layouts = computeSplitLayouts(data);
const snippet = renderReadmeSnippet(data);
const imageLayer = snippet;
const textFallback = renderTextFallback(data);

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function anchorHrefs(markup: string): string[] {
  return [...markup.matchAll(/<a\s+href="([^"]+)"/g)].map((match) => match[1]);
}

const expectedFragments = layouts.wide.fragments.length;
const expectedLinkedFragments = [
  data.profileUrl,
  ...data.upstreamExamples.flatMap((item) => [item.repositoryUrl, item.prUrl]),
  ...data.personalProjects.filter((item) => !item.placeholder).map((item) => item.url)
].filter((url): url is string => Boolean(url));

assert.equal(expectedFragments, 1 + 1 + data.upstreamExamples.length * 2 + 1 + data.personalProjects.length + 1 + 1);
assert.equal(layouts.narrow.fragments.length, expectedFragments);
assert.equal((imageLayer.match(/<picture>/g) || []).length, expectedFragments);
assert.equal((imageLayer.match(/<img\b/g) || []).length, expectedFragments);
assert.equal((imageLayer.match(/<a\b/g) || []).length, expectedLinkedFragments.length);
assert.deepEqual(anchorHrefs(imageLayer), expectedLinkedFragments);
assert.doesNotMatch(imageLayer, /profile-text-fallback/, "published README must not append a visible text layer");
const imageTags = [...imageLayer.matchAll(/<img\b([^>]*)>/g)].map((match) => match[1]);
const imageWidths = imageTags.map((attributes) => attributes.match(/\bwidth="([^"]+)"/)?.[1] || "");
assert.ok(imageTags.every((attributes) => /\balt="[^"]+"/.test(attributes)), "every image needs a native alt fallback");
const expectedImageWidths = layouts.wide.fragments.map((fragment) => {
  if (fragment.width === layouts.wide.width) return "100%";
  return `${(fragment.width / layouts.wide.width * 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%`;
});
assert.deepEqual(imageWidths, expectedImageWidths, "split image width contract changed");
assert.doesNotMatch(renderSingleImageReadmeSnippet(data), /profile-text-fallback/, "single-image publication must not append a visible text layer");

// Each repository/PR pair is one line with no whitespace node between the
// adjacent anchors; this is what prevents GitHub's inline layout from wrapping
// the second half to a new line.
const rows = [...imageLayer.matchAll(/<div align="center">([\s\S]*?)<\/div>/g)].map((match) => match[1]);
const expectedRows = 1 + 1 + data.upstreamExamples.length + 1 + data.personalProjects.length + 1 + 1;
assert.equal(rows.length, expectedRows);
const pairRows = rows.filter((row) => /profile-(?:wide|narrow)-split-open-\d{2}-repo/.test(row));
assert.equal(pairRows.length, data.upstreamExamples.length);
for (const row of pairRows) {
  assert.match(row, /<\/picture><\/a><a href=/);
  assert.doesNotMatch(row, /<\/picture>\s+<a href=/);
}

const pictureBlocks = [...imageLayer.matchAll(/<picture>([\s\S]*?)<\/picture>/g)].map((match) => match[1]);
assert.ok(pictureBlocks.every((block) => block.includes("<img ")));
assert.ok(pictureBlocks.every((block) => block.includes('type="image/png"') || block.includes('type="image/svg+xml"')));

const headerBlock = pictureBlocks[0];
const metricsBlock = pictureBlocks.at(-2) || "";
assert.equal((imageLayer.match(/<source\b/g) || []).length, 2 * 16 + (expectedFragments - 2) * 12);
assert.match(headerBlock, /prefers-reduced-data: reduce[^>]*" type="image\/png"/);
assert.match(headerBlock, /prefers-reduced-motion: reduce[^>]*profile-narrow-split-header-static\.svg/);
assert.match(headerBlock, /srcset="\.\/assets\/profile-wide-split-header\.svg"/);
assert.match(headerBlock, /prefers-color-scheme: dark[^>]*profile-wide-dark-split-header\.svg/);
assert.match(headerBlock, /prefers-color-scheme: light[^>]*profile-wide-split-header\.svg/);
assert.match(headerBlock, /src="\.\/assets\/profile-wide-split-header-static\.png"[^>]*loading="eager"/);
assert.match(metricsBlock, /srcset="\.\/assets\/profile-wide-split-metrics\.svg"/);
assert.match(metricsBlock, /prefers-color-scheme: dark[^>]*profile-wide-dark-split-metrics\.svg/);

// The narrow work heading crosses a fragment boundary with the header wave;
// keep its SVG anchor on the same baseline as the body and horizontal rules.
const narrowOverview = layouts.narrow.fragments.find((fragment) => fragment.key === "overview");
if (!narrowOverview) throw new Error("narrow overview fragment is missing");
const narrowOverviewSvg = renderSplitFragmentSvg(data, narrowOverview, false);
assert.match(
  narrowOverviewSvg,
  new RegExp(`<text x="${layouts.narrow.coordinates.margin}" y="220"[^>]*>WHAT I WORK ON</text>`)
);
assert.doesNotMatch(narrowOverviewSvg, /data:image\/png;base64/, "split SVG must not embed the raster avatar");
assert.doesNotMatch(narrowOverviewSvg, /font-family:'JstarDisplay'/, "non-header split SVG must not embed the display font");

// Non-animated fragments use static SVG for their normal path. PNG remains
// available for reduced-data mode and browsers that cannot use SVG sources.
const overviewBlock = pictureBlocks[1];
assert.match(overviewBlock, /profile-wide-split-overview-static\.svg/);
assert.match(overviewBlock, /profile-narrow-split-overview-static\.svg/);
assert.match(overviewBlock, /profile-wide-split-overview-static\.png/);
assert.match(overviewBlock, /profile-narrow-split-overview-static\.png/);
assert.equal((overviewBlock.match(/<source\b/g) || []).length, 12);

for (const item of data.upstreamExamples) {
  assert.ok(item.repositoryUrl);
  assert.ok(item.prUrl);
  assert.match(textFallback, new RegExp(`\\]\\(<${escapedRegExp(item.repositoryUrl)}>\\)`));
  assert.match(textFallback, new RegExp(`\\]\\(<${escapedRegExp(item.prUrl)}>\\)`));
}

assert.equal((renderProfile(data, "wide", true).match(/<a /g) || []).length, expectedLinkedFragments.length);
assert.equal((renderProfile(data, "narrow", false).match(/<a /g) || []).length, expectedLinkedFragments.length);
assert.match(renderProfile(data, "wide", false), /merged in 2026/);
assert.match(textFallback, new RegExp(`^${TEXT_FALLBACK_MARKER}\\n\\n# ${escapedRegExp(data.identity.name)}\\n`));
assert.match(textFallback, /SOFTWARE INFRASTRUCTURE \/ RELIABILITY \/ APPLIED AI/);
assert.ok(!textFallback.includes("project title](<"));
for (const project of data.personalProjects) {
  if (project.placeholder) {
    assert.doesNotMatch(textFallback, new RegExp(`\\[${escapedRegExp(project.title)}\\]\\(<`));
    continue;
  }
  assert.ok(project.url, `${project.title} must have a real project URL`);
  assert.match(textFallback, new RegExp(`\\]\\(<${escapedRegExp(project.url)}>\\)`));
}

for (const mode of ["wide", "narrow"] as const) {
  const fragments = layouts[mode].fragments;
  for (const fragment of fragments) {
    assert.ok(fragment.width > 0 && fragment.height > 0);
    const staticSvg = renderSplitFragmentSvg(data, fragment, false);
    assert.match(staticSvg, new RegExp(`viewBox="0 0 ${fragment.width} ${fragment.height}"`));
    assert.match(staticSvg, new RegExp(`translate\\(${ -fragment.x } ${ -fragment.y }\\)`));
    assert.doesNotMatch(staticSvg, /<animate\b/);
  }
}

for (let index = 0; index < data.upstreamExamples.length; index += 1) {
  const suffix = String(index + 1).padStart(2, "0");
  const wideRepo = layouts.wide.fragments.find((fragment) => fragment.key === `open-${suffix}-repo`);
  const widePr = layouts.wide.fragments.find((fragment) => fragment.key === `open-${suffix}-pr`);
  const narrowRepo = layouts.narrow.fragments.find((fragment) => fragment.key === `open-${suffix}-repo`);
  const narrowPr = layouts.narrow.fragments.find((fragment) => fragment.key === `open-${suffix}-pr`);
  assert.ok(wideRepo && widePr && narrowRepo && narrowPr);
  assert.equal(wideRepo.y, widePr.y);
  assert.equal(wideRepo.height, widePr.height);
  assert.equal(wideRepo.width + widePr.width, layouts.wide.width);
  assert.equal(narrowRepo.y, narrowPr.y);
  assert.equal(narrowRepo.height, narrowPr.height);
  assert.equal(narrowRepo.width + narrowPr.width, layouts.narrow.width);
}

const customPrefix = renderReadmeSnippet(data, { assetPrefix: "/profile-assets" });
assert.match(customPrefix, /srcset="\/profile-assets\/profile-wide-split-header\.svg"/);
assert.match(customPrefix, /src="\/profile-assets\/profile-wide-split-header-static\.png"/);

const svgOnly = renderReadmeSnippet(data, { includePngFallback: false });
assert.equal((svgOnly.match(/<picture>/g) || []).length, expectedFragments);
assert.equal((svgOnly.match(/<source\b/g) || []).length, expectedFragments * 4);
assert.ok(!svgOnly.includes(".png"));
const svgOnlyFiles = [...svgOnly.matchAll(/(?:src|srcset)="([^"]+\.svg)"/g)].map((match) => match[1]);
assert.ok(svgOnlyFiles.length > 0 && svgOnlyFiles.every((file) => file.includes("-static.svg")));
assert.match(svgOnly, /<img src="\.\/assets\/profile-wide-split-header-static\.svg"/);

const evolving = structuredClone(data);
evolving.identity.name = "NOVA";
evolving.identity.intro = "I make dependable tools for difficult systems.";
evolving.stats.mergedPrs = 7;
evolving.stats.publicRepositories = 4;
evolving.stats.mergedThisYear = 5;
evolving.stats.repositoriesOver1kStars = 2;
evolving.stats.year = 2031;
evolving.stats.asOf = "01 Jan 2031";
evolving.upstreamExamples = [{
  repository: "example/engine",
  pr: "#7",
  accent: "blue",
  repositoryUrl: "https://github.com/example/engine",
  prUrl: "https://github.com/example/engine/pull/7"
}];
evolving.personalProjects = [{
  title: "Atlas",
  description: "a real project",
  accent: "mint",
  url: "https://github.com/example/atlas"
}];
evolving.languages = [{ name: "Rust", percentage: 100, accent: "orange" }];

const evolvingSvg = renderProfile(evolving, "wide", false);
const evolvingReadme = renderReadmeSnippet(evolving);
const evolvingTextFallback = renderTextFallback(evolving);
assert.match(evolvingSvg, /NOVA/);
assert.match(evolvingSvg, /7 merged PRs across 4 public repositories/);
assert.match(evolvingSvg, /merged in 2031/);
assert.match(evolvingSvg, /example\/engine/);
assert.match(evolvingSvg, /Atlas/);
assert.match(evolvingSvg, /Rust/);
assert.ok(!evolvingSvg.includes("99 merged PRs") && !evolvingSvg.includes("merged in 2026"));
assert.match(evolvingReadme, /example\/engine/);
assert.match(evolvingReadme, /#7/);
assert.match(evolvingReadme, /Atlas/);
assert.doesNotMatch(evolvingReadme, /Rust 100\.00%/, "published README must not contain the full text layer");
assert.match(evolvingTextFallback, /Rust 100\.00%/);
assert.deepEqual(anchorHrefs(evolvingReadme), [
  evolving.profileUrl,
  "https://github.com/example/engine",
  "https://github.com/example/engine/pull/7",
  "https://github.com/example/atlas"
]);

const firstSplit = layouts.wide.fragments[0];
assert.equal(splitAssetFilename(firstSplit, "static", "png"), "profile-wide-split-header-static.png");

console.log("README split contract tests passed");
