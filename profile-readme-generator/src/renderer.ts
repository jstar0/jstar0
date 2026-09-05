import type { ProfileData } from "./model.ts";
import { computeLayouts } from "./layout.ts";
import { computeSplitLayouts, splitAssetFilename, type SplitFragment } from "./split-layout.ts";
import { colors, layout, setTheme, type ThemeMode } from "./theme.ts";
import { escapeXml, rect, svgDocument, element } from "./svg.ts";
import {
  renderDefs,
  renderFooter,
  renderGithubChrome,
  renderHeaderNarrow,
  renderHeaderWide,
  renderMetricsNarrow,
  renderMetricsWide,
  renderNarrowContent,
  renderOpenSourceNarrow,
  renderOpenSourceWide,
  renderProjectsNarrow,
  renderProjectsWide,
  renderWorkNarrow,
  renderWorkWide,
  renderWideContent
} from "./sections.ts";

export type RenderMode = "wide" | "narrow";

export interface ReadmeSnippetOptions {
  assetPrefix?: string;
  includePngFallback?: boolean;
  theme?: ThemeMode;
}

export const TEXT_FALLBACK_MARKER = "<!-- profile-text-fallback -->";

function description(data: ProfileData): string {
  const contributionSummary = data.stats.contributionsLastYear === undefined
    ? ""
    : ` ${data.stats.contributionsLastYear} contributions in the last year.`;
  return [
    `${data.identity.name} profile overview.`,
    data.identity.intro,
    `${data.stats.mergedPrs} merged PRs across ${data.stats.publicRepositories} public repositories.`,
    `Languages: ${data.languages.map((language) => `${language.name} ${language.percentage.toFixed(2)}%`).join(", ")}.${contributionSummary}`
  ].join(" ");
}

export function renderProfile(data: ProfileData, mode: RenderMode, motion: boolean, theme: ThemeMode = "light"): string {
  setTheme(theme);
  const coordinates = computeLayouts(data)[mode];
  const content = mode === "wide"
    ? renderWideContent(data, motion, coordinates)
    : renderNarrowContent(data, motion, coordinates);

  return svgDocument({
    width: coordinates.width,
    height: coordinates.height,
    body: [
      rect(0, 0, coordinates.width, coordinates.height, { fill: colors.background }),
      renderDefs(coordinates, motion),
      content
    ].join(""),
    title: `${data.identity.name} profile metrics`,
    description: description(data),
    motion
  });
}

export function renderWideMockup(data: ProfileData, motion: boolean, theme: ThemeMode = "light"): string {
  setTheme(theme);
  const coordinates = computeLayouts(data).wide;
  const width = coordinates.width;
  const height = coordinates.height + layout.githubChromeHeight;
  const content = renderWideContent(data, motion, coordinates);

  return svgDocument({
    width,
    height,
    body: [
      rect(0, 0, width, height, { fill: colors.background }),
      renderDefs(coordinates, motion),
      renderGithubChrome(height),
      element("g", { transform: `translate(0 ${layout.githubChromeHeight})` }, content)
    ].join(""),
    title: `${data.identity.name} README mockup`,
    description: description(data),
    motion
  });
}

function escapeHtml(value: string): string {
  return escapeXml(value);
}

function escapeMarkdownText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function markdownLink(label: string, url: string | undefined): string {
  const text = escapeMarkdownText(label);
  if (!url) return text;
  const safeUrl = url.replaceAll("\\", "%5C").replaceAll(")", "%29");
  return `[${text}](<${safeUrl}>)`;
}

function asset(prefix: string, filename: string): string {
  return `${prefix}${filename}`;
}

function normalizedAssetPrefix(prefix: string | undefined): string {
  const value = prefix ?? "./assets/";
  return value.endsWith("/") ? value : `${value}/`;
}

function sourceTag(media: string | undefined, type: string, srcset: string): string {
  const mediaAttribute = media ? ` media="${escapeHtml(media)}"` : "";
  return `  <source${mediaAttribute} type="${escapeHtml(type)}" srcset="${escapeHtml(srcset)}">`;
}

function compactSourceTag(media: string | undefined, type: string, srcset: string): string {
  return sourceTag(media, type, srcset).trim();
}

export function renderTextFallback(data: ProfileData): string {
  const upstream = data.upstreamExamples
    .map((item) => `- ${markdownLink(item.repository, item.repositoryUrl)} ${markdownLink(item.pr, item.prUrl)}`)
    .join("\n");
  const projects = data.personalProjects
    .map((item) => `- ${markdownLink(item.title, item.url)} / ${escapeMarkdownText(item.description)}`)
    .join("\n");
  const languages = data.languages
    .map((item) => `${item.name} ${item.percentage.toFixed(2)}%`)
    .join(" / ");
  const descriptor = data.identity.descriptor
    .map((item) => escapeMarkdownText(item))
    .join(" ");

  return `${TEXT_FALLBACK_MARKER}

# ${escapeMarkdownText(data.identity.name)}

_${descriptor}_

${escapeMarkdownText(data.identity.intro)}

### What I work on

${data.workstreams.map((stream) => `- **${escapeMarkdownText(stream.label)}**: ${escapeMarkdownText(stream.detail)}`).join("\n")}

### Open-source record

${data.stats.mergedPrs} merged PRs / ${data.stats.publicRepositories} public repositories / as of ${escapeMarkdownText(data.stats.asOf)}.

${upstream}

### Personal projects

${projects}

### Metrics

Languages: ${languages}.

${data.stats.contributionsLastYear === undefined
    ? "Contribution intensity is grouped by workstream and month in the generated visual above."
    : `${data.stats.contributionsLastYear.toLocaleString("en-US")} contributions are summarized by month in the generated visual above.`}

${data.profileUrl ? `[GitHub profile](<${data.profileUrl}>)` : ""}
`;
}

/**
 * Keep the original one-image publication helper available for visual
 * comparison and consumers that intentionally want a single hit area.
 */
export function renderSingleImageReadmeSnippet(data: ProfileData, options: ReadmeSnippetOptions = {}): string {
  const prefix = normalizedAssetPrefix(options.assetPrefix);
  const includePngFallback = options.includePngFallback ?? true;
  const wideMotion = asset(prefix, "profile-wide.svg");
  const narrowMotion = asset(prefix, "profile-narrow.svg");
  const wideStatic = asset(prefix, "profile-wide-static.svg");
  const narrowStatic = asset(prefix, "profile-narrow-static.svg");
  const widePng = asset(prefix, "profile-wide-static.png");
  const narrowPng = asset(prefix, "profile-narrow-static.png");
  const fallback = includePngFallback ? widePng : wideStatic;
  const contributionAlt = data.stats.contributionsLastYear === undefined
    ? ""
    : ` ${data.stats.contributionsLastYear} contributions in the last year.`;
  const alt = `${data.identity.name} profile metrics: ${data.identity.intro} ${data.stats.mergedPrs} merged PRs across ${data.stats.publicRepositories} public repositories.${contributionAlt}`;
  const sources = [
    "<picture>",
    sourceTag("(max-width: 640px) and (prefers-reduced-data: reduce)", "image/svg+xml", narrowStatic),
    sourceTag("(prefers-reduced-data: reduce)", "image/svg+xml", wideStatic),
    sourceTag("(max-width: 640px) and (prefers-reduced-motion: reduce)", "image/svg+xml", narrowStatic),
    sourceTag("(prefers-reduced-motion: reduce)", "image/svg+xml", wideStatic),
    sourceTag("(max-width: 640px)", "image/svg+xml", narrowMotion),
    sourceTag(undefined, "image/svg+xml", wideMotion)
  ];
  if (includePngFallback) {
    sources.push(
      sourceTag("(max-width: 640px)", "image/png", narrowPng),
      sourceTag(undefined, "image/png", widePng)
    );
  }
  const picture = [
    ...sources,
    `  <img src="${escapeHtml(fallback)}" width="941" alt="${escapeHtml(alt)}" loading="eager" decoding="async">`,
    "</picture>"
  ].join("\n");
  const linkedPicture = data.profileUrl
    ? `<a href="${escapeHtml(data.profileUrl)}" aria-label="Open ${escapeHtml(data.identity.name)} GitHub profile">\n${picture}\n</a>`
    : picture;

  // A full Markdown text layer cannot be conditionally revealed by GitHub
  // when an image request fails. The native <img alt> is the reliable
  // per-image fallback, so keep the published snippet image-only.
  return linkedPicture;
}

function renderSplitFragmentContent(data: ProfileData, fragment: SplitFragment, motion: boolean): string {
  const coordinates = computeLayouts(data)[fragment.mode];
  switch (fragment.kind) {
    case "header":
      return fragment.mode === "wide"
        ? `${renderHeaderWide(data, motion)}${renderWorkWide(data)}`
        : `${renderHeaderNarrow(data, motion)}${renderWorkNarrow(data)}`;
    case "overview":
      return fragment.mode === "wide"
        ? `${renderWorkWide(data)}${renderOpenSourceWide(data, coordinates)}`
        : `${renderWorkNarrow(data)}${renderOpenSourceNarrow(data, coordinates)}`;
    case "open-repository":
    case "open-pull-request":
      return fragment.mode === "wide"
        ? renderOpenSourceWide(data, coordinates)
        : renderOpenSourceNarrow(data, coordinates);
    case "projects-heading":
      // The first project pixel row may be the final rule emitted by the
      // preceding open-source section. Keep that source section in the SVG so
      // the cropped fragment remains identical to the full-canvas render.
      return fragment.mode === "wide"
        ? `${renderOpenSourceWide(data, coordinates)}${renderProjectsWide(data, coordinates)}`
        : `${renderOpenSourceNarrow(data, coordinates)}${renderProjectsNarrow(data, coordinates)}`;
    case "project":
      return fragment.mode === "wide"
        ? renderProjectsWide(data, coordinates)
        : renderProjectsNarrow(data, coordinates);
    case "metrics":
      // Narrow project rows always emit their trailing rule, including the
      // last row, which lands on the metrics fragment's first pixel row. The
      // footer rule likewise lands on the metrics fragment's final pixel row.
      return fragment.mode === "wide"
        ? `${renderProjectsWide(data, coordinates)}${renderMetricsWide(data, motion, coordinates)}${renderFooter(coordinates)}`
        : `${renderProjectsNarrow(data, coordinates)}${renderMetricsNarrow(data, motion, coordinates)}${renderFooter(coordinates)}`;
    case "footer":
      return renderFooter(coordinates);
  }
}

export function renderSplitFragmentText(data: ProfileData, fragment: SplitFragment): string {
  const content = renderSplitFragmentContent(data, fragment, false);
  return [...content.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((match) => match[1].replace(/<[^>]+>/g, ""))
    .join("")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

/**
 * Render one independently publishable SVG crop. The content keeps its
 * original full-canvas coordinates while the root viewBox exposes only the
 * fragment rectangle, so the crop does not introduce a second layout system.
 */
export function renderSplitFragmentSvg(
  data: ProfileData,
  fragment: SplitFragment,
  motion: boolean,
  theme: ThemeMode = "light"
): string {
  setTheme(theme);
  const coordinates = computeLayouts(data)[fragment.mode];
  const content = renderSplitFragmentContent(data, fragment, motion);
  return svgDocument({
    width: fragment.width,
    height: fragment.height,
    // Use a local viewport plus an explicit integer translation. This keeps
    // rasterization aligned with the full canvas at fragment edges; a
    // non-zero viewBox origin can make antialiased strokes land on a slightly
    // different coverage grid in Chromium.
    viewBox: { x: 0, y: 0, width: fragment.width, height: fragment.height },
    body: [
      rect(0, 0, coordinates.width, coordinates.height, { fill: colors.background }),
      renderDefs(coordinates, motion),
      element("g", { transform: `translate(${-fragment.x} ${-fragment.y})` }, content)
    ].join(""),
    title: `${fragment.label} for ${data.identity.name}`,
    description: description(data),
    motion,
    fontSubsetKey: `profile-${fragment.mode}-split-${fragment.key}`
  });
}

function splitImageWidth(fragment: SplitFragment, canvasWidth: number): string {
  // Full rows must follow the rendered Markdown container. A numeric width
  // would become an inset, centered row in GitHub's wider edit preview.
  if (fragment.width === canvasWidth) return "100%";
  return `${(fragment.width / canvasWidth * 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function renderSplitPicture(
  wide: SplitFragment,
  narrow: SplitFragment,
  options: ReadmeSnippetOptions,
  animated: boolean,
  canvasWidths: { wide: number; narrow: number }
): string {
  const prefix = normalizedAssetPrefix(options.assetPrefix);
  const includePngFallback = options.includePngFallback ?? true;
  const wideStaticSvg = asset(prefix, splitAssetFilename(wide, "static", "svg", "light"));
  const narrowStaticSvg = asset(prefix, splitAssetFilename(narrow, "static", "svg", "light"));
  const wideDarkStaticSvg = asset(prefix, splitAssetFilename(wide, "static", "svg", "dark"));
  const narrowDarkStaticSvg = asset(prefix, splitAssetFilename(narrow, "static", "svg", "dark"));
  const useMotionSvg = animated && includePngFallback;
  const wideNormalSvg = asset(prefix, splitAssetFilename(wide, useMotionSvg ? "motion" : "static", "svg", "light"));
  const narrowNormalSvg = asset(prefix, splitAssetFilename(narrow, useMotionSvg ? "motion" : "static", "svg", "light"));
  const wideDarkNormalSvg = asset(prefix, splitAssetFilename(wide, useMotionSvg ? "motion" : "static", "svg", "dark"));
  const narrowDarkNormalSvg = asset(prefix, splitAssetFilename(narrow, useMotionSvg ? "motion" : "static", "svg", "dark"));
  const widePng = asset(prefix, splitAssetFilename(wide, "static", "png", "light"));
  const narrowPng = asset(prefix, splitAssetFilename(narrow, "static", "png", "light"));
  const wideDarkPng = asset(prefix, splitAssetFilename(wide, "static", "png", "dark"));
  const narrowDarkPng = asset(prefix, splitAssetFilename(narrow, "static", "png", "dark"));
  const fallback = includePngFallback ? widePng : wideStaticSvg;
  const width = splitImageWidth(wide, canvasWidths.wide);

  // The editor uses this explicit mode for side-by-side review. Publication
  // keeps the default auto mode below, where GitHub chooses by color scheme.
  if (options.theme) {
    const forcedWideStatic = options.theme === "dark" ? wideDarkStaticSvg : wideStaticSvg;
    const forcedNarrowStatic = options.theme === "dark" ? narrowDarkStaticSvg : narrowStaticSvg;
    const forcedWideNormal = options.theme === "dark" ? wideDarkNormalSvg : wideNormalSvg;
    const forcedNarrowNormal = options.theme === "dark" ? narrowDarkNormalSvg : narrowNormalSvg;
    const forcedWidePng = options.theme === "dark" ? wideDarkPng : widePng;
    const forcedNarrowPng = options.theme === "dark" ? narrowDarkPng : narrowPng;
    const forcedWideSource = animated ? forcedWideNormal : forcedWideStatic;
    const forcedNarrowSource = animated ? forcedNarrowNormal : forcedNarrowStatic;
    return [
      "<picture>",
      compactSourceTag("(max-width: 640px)", "image/svg+xml", forcedNarrowSource),
      compactSourceTag("(min-width: 641px)", "image/svg+xml", forcedWideSource),
      ...(includePngFallback ? [
        compactSourceTag("(max-width: 640px)", "image/png", forcedNarrowPng),
        compactSourceTag("(min-width: 641px)", "image/png", forcedWidePng)
      ] : []),
      `<img src="${escapeHtml(includePngFallback ? forcedWidePng : forcedWideStatic)}" width="${escapeHtml(width)}" alt="${escapeHtml(wide.label)}" loading="${wide.kind === "header" ? "eager" : "lazy"}" decoding="async" align="top">`,
      "</picture>"
    ].join("");
  }

  // Keep the two half-row pictures adjacent with no text nodes between them.
  // GitHub's README renderer lays these inline; even one newline can move the
  // second half onto a new line when the available width is rounded down.
  const sources = ["<picture>"];
  if (includePngFallback) {
    sources.push(
      compactSourceTag("(prefers-color-scheme: dark) and (max-width: 640px) and (prefers-reduced-data: reduce)", "image/png", narrowDarkPng),
      compactSourceTag("(prefers-color-scheme: dark) and (min-width: 641px) and (prefers-reduced-data: reduce)", "image/png", wideDarkPng),
      compactSourceTag("(prefers-color-scheme: light) and (max-width: 640px) and (prefers-reduced-data: reduce)", "image/png", narrowPng),
      compactSourceTag("(prefers-color-scheme: light) and (min-width: 641px) and (prefers-reduced-data: reduce)", "image/png", widePng)
    );
  }
  if (animated && includePngFallback) {
    sources.push(
      compactSourceTag("(prefers-color-scheme: dark) and (max-width: 640px) and (prefers-reduced-motion: reduce)", "image/svg+xml", narrowDarkStaticSvg),
      compactSourceTag("(prefers-color-scheme: dark) and (min-width: 641px) and (prefers-reduced-motion: reduce)", "image/svg+xml", wideDarkStaticSvg),
      compactSourceTag("(prefers-color-scheme: light) and (max-width: 640px) and (prefers-reduced-motion: reduce)", "image/svg+xml", narrowStaticSvg),
      compactSourceTag("(prefers-color-scheme: light) and (min-width: 641px) and (prefers-reduced-motion: reduce)", "image/svg+xml", wideStaticSvg),
      compactSourceTag("(prefers-color-scheme: dark) and (max-width: 640px)", "image/svg+xml", narrowDarkNormalSvg),
      compactSourceTag("(prefers-color-scheme: dark) and (min-width: 641px)", "image/svg+xml", wideDarkNormalSvg),
      compactSourceTag("(prefers-color-scheme: light) and (max-width: 640px)", "image/svg+xml", narrowNormalSvg),
      compactSourceTag("(prefers-color-scheme: light) and (min-width: 641px)", "image/svg+xml", wideNormalSvg)
    );
  } else {
    sources.push(
      compactSourceTag("(prefers-color-scheme: dark) and (max-width: 640px)", "image/svg+xml", narrowDarkStaticSvg),
      compactSourceTag("(prefers-color-scheme: dark) and (min-width: 641px)", "image/svg+xml", wideDarkStaticSvg),
      compactSourceTag("(prefers-color-scheme: light) and (max-width: 640px)", "image/svg+xml", narrowStaticSvg),
      compactSourceTag("(prefers-color-scheme: light) and (min-width: 641px)", "image/svg+xml", wideStaticSvg)
    );
  }
  if (includePngFallback) {
    sources.push(
      compactSourceTag("(prefers-color-scheme: dark) and (max-width: 640px)", "image/png", narrowDarkPng),
      compactSourceTag("(prefers-color-scheme: dark) and (min-width: 641px)", "image/png", wideDarkPng),
      compactSourceTag("(prefers-color-scheme: light) and (max-width: 640px)", "image/png", narrowPng),
      compactSourceTag("(prefers-color-scheme: light) and (min-width: 641px)", "image/png", widePng)
    );
  }
  const alt = escapeHtml(wide.label);
  sources.push(
    `<img src="${escapeHtml(fallback)}" width="${escapeHtml(width)}" alt="${alt}" loading="${wide.kind === "header" ? "eager" : "lazy"}" decoding="async" align="top">`,
    "</picture>"
  );
  return sources.join("");
}

function wrapSplitFragment(
  wide: SplitFragment,
  narrow: SplitFragment,
  picture: string
): string {
  if (!wide.href) return picture;
  return `<a href="${escapeHtml(wide.href)}" aria-label="${escapeHtml(wide.label)}">${picture}</a>`;
}

function fragmentByKey(fragments: SplitFragment[], key: string): SplitFragment {
  const fragment = fragments.find((candidate) => candidate.key === key);
  if (!fragment) throw new Error(`Missing split fragment: ${key}`);
  return fragment;
}

function renderSplitRow(
  wideFragments: SplitFragment[],
  narrowFragments: SplitFragment[],
  keys: string[],
  options: ReadmeSnippetOptions,
  animatedKeys: Set<string>,
  canvasWidths: { wide: number; narrow: number }
): string {
  return `<div align="center">${keys.map((key) => {
    const wide = fragmentByKey(wideFragments, key);
    const narrow = fragmentByKey(narrowFragments, key);
    const picture = renderSplitPicture(wide, narrow, options, animatedKeys.has(key), canvasWidths);
    return wrapSplitFragment(wide, narrow, picture);
  }).join("")}</div>`;
}

/**
 * Publish the README as independent image units. GitHub treats an external
 * SVG in an <img> as one hit area, so links are deliberately attached to the
 * HTML fragments instead of relying on links embedded inside the SVG.
 */
export function renderSplitReadmeSnippet(data: ProfileData, options: ReadmeSnippetOptions = {}): string {
  const layouts = computeSplitLayouts(data);
  const wideFragments = layouts.wide.fragments;
  const narrowFragments = layouts.narrow.fragments;
  const animatedKeys = new Set(["header", "metrics"]);
  const canvasWidths = { wide: layouts.wide.width, narrow: layouts.narrow.width };
  const rows: string[] = [];

  rows.push(renderSplitRow(wideFragments, narrowFragments, ["header"], options, animatedKeys, canvasWidths));
  rows.push(renderSplitRow(wideFragments, narrowFragments, ["overview"], options, animatedKeys, canvasWidths));
  data.upstreamExamples.forEach((_, index) => {
    const number = String(index + 1).padStart(2, "0");
    rows.push(renderSplitRow(
      wideFragments,
      narrowFragments,
      [`open-${number}-repo`, `open-${number}-pr`],
      options,
      animatedKeys,
      canvasWidths
    ));
  });
  rows.push(renderSplitRow(wideFragments, narrowFragments, ["projects-heading"], options, animatedKeys, canvasWidths));
  data.personalProjects.forEach((_, index) => {
    rows.push(renderSplitRow(
      wideFragments,
      narrowFragments,
      [`project-${String(index + 1).padStart(2, "0")}`],
      options,
      animatedKeys,
      canvasWidths
    ));
  });
  rows.push(renderSplitRow(wideFragments, narrowFragments, ["metrics"], options, animatedKeys, canvasWidths));
  rows.push(renderSplitRow(wideFragments, narrowFragments, ["footer"], options, animatedKeys, canvasWidths));

  // Keep the published README free of a permanently visible duplicate text
  // layer. Consumers that need a text-only export can call renderTextFallback
  // directly.
  return rows.join("\n");
}

export function renderReadmeSnippet(data: ProfileData, options: ReadmeSnippetOptions = {}): string {
  return renderSplitReadmeSnippet(data, options);
}
