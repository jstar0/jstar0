import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { loadProfileData, PROJECT_ROOT } from "./model.ts";
import { renderReadmeSnippet, renderTextFallback, TEXT_FALLBACK_MARKER } from "./renderer.ts";
import { computeSplitLayouts, splitAssetFilename } from "./split-layout.ts";
import { browserLaunchOptions, loadPlaywright } from "./qa-browser.ts";

const generatedDir = path.join(PROJECT_ROOT, "generated");
const outputDir = path.join(PROJECT_ROOT, "qa", "output", "readme-compat");
const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function imageLayer(snippet: string): string {
  const marker = `\n\n${TEXT_FALLBACK_MARKER}`;
  const end = snippet.indexOf(marker);
  return end >= 0 ? snippet.slice(0, end) : snippet;
}

function harnessHtml(snippet: string, textFallback: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: 100%; min-height: 100%; background: #fff; }
main { width: 100%; max-width: 941px; margin: 0 auto; }
main > div { width: 100%; text-align: center; }
main > a, main > picture { display: block; width: 100%; }
main > div > a, main > div > picture { vertical-align: top; }
img { max-width: 100%; height: auto; }
#text-fallback { margin: 24px 0 0; padding: 16px; white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.5 sans-serif; color: #53627a; }
</style></head><body><main><section id="image-layer">${imageLayer(snippet)}</section><pre id="text-fallback">${escapeHtml(textFallback)}</pre></main></body></html>`;
}

function directImageHtml(filename: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;background:#fff;overflow:hidden}img{display:block}</style></head><body><img src="/assets/${filename}" alt=""></body></html>`;
}

interface TestServer {
  url: string;
  setDocument: (html: string) => void;
  setDelay: (milliseconds: number) => void;
  clearRequests: () => void;
  requests: () => string[];
  close: () => Promise<void>;
}

function contentType(filename: string): string {
  if (filename.endsWith(".svg")) return "image/svg+xml";
  if (filename.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function startServer(root: string): Promise<TestServer> {
  let document = "";
  let delay = 0;
  const requestedAssets: string[] = [];
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(document);
      return;
    }

    if (!requestUrl.pathname.startsWith("/assets/")) {
      response.writeHead(404);
      response.end();
      return;
    }

    const filename = requestUrl.pathname.slice("/assets/".length);
    if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
      response.writeHead(400);
      response.end();
      return;
    }

    requestedAssets.push(filename);

    if (delay > 0) await sleep(delay);
    const filePath = path.join(root, filename);
    if (!fs.existsSync(filePath)) {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end();
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentType(filename),
      "Cache-Control": "no-store"
    });
    fs.createReadStream(filePath).pipe(response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  return {
    url: `http://127.0.0.1:${address.port}`,
    setDocument: (html) => { document = html; },
    setDelay: (milliseconds) => { delay = milliseconds; },
    clearRequests: () => { requestedAssets.length = 0; },
    requests: () => [...requestedAssets],
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

function basename(url: string): string {
  return new URL(url).pathname.split("/").pop() || "";
}

async function waitForImage(page: any, allowBroken = false): Promise<void> {
  await page.waitForFunction((broken: boolean) => {
    const image = document.querySelector("img") as HTMLImageElement | null;
    return image?.complete === true && (broken || image.naturalWidth > 0);
  }, allowBroken);
}

async function waitForAllImages(page: any): Promise<void> {
  await page.waitForFunction(() => {
    const images = [...document.images];
    return images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0);
  });
}

interface PixelReport {
  changedPixels: number;
  ratio: number;
}

function comparePng(firstPath: string, secondPath: string, threshold = 12): PixelReport {
  const first = PNG.sync.read(fs.readFileSync(firstPath));
  const second = PNG.sync.read(fs.readFileSync(secondPath));
  assert.equal(first.width, second.width, `${firstPath} width differs from ${secondPath}`);
  assert.equal(first.height, second.height, `${firstPath} height differs from ${secondPath}`);
  let changedPixels = 0;
  for (let index = 0; index < first.data.length; index += 4) {
    const delta = Math.abs(first.data[index] - second.data[index])
      + Math.abs(first.data[index + 1] - second.data[index + 1])
      + Math.abs(first.data[index + 2] - second.data[index + 2]);
    if (delta > threshold) changedPixels += 1;
  }
  return { changedPixels, ratio: changedPixels / (first.width * first.height) };
}

interface RasterImage {
  width: number;
  height: number;
  data: Uint8Array;
}

function readRaster(filePath: string): RasterImage {
  return PNG.sync.read(fs.readFileSync(filePath)) as RasterImage;
}

function composeSplitPng(mode: "wide" | "narrow", data: ReturnType<typeof loadProfileData>): {
  filePath: string;
  coverage: { min: number; max: number; uncovered: number; overdrawn: number };
} {
  const splitLayout = computeSplitLayouts(data)[mode];
  const canvas = readRaster(path.join(generatedDir, `profile-${mode}-static.png`));
  assert.equal(canvas.width, splitLayout.width);
  assert.equal(canvas.height, splitLayout.height);
  const composed = new Uint8Array(canvas.width * canvas.height * 4);
  const coverage = new Uint8Array(canvas.width * canvas.height);

  for (const fragment of splitLayout.fragments) {
    const filePath = path.join(generatedDir, splitAssetFilename(fragment, "static", "png"));
    assert.ok(fs.existsSync(filePath), `missing split PNG ${filePath}`);
    const source = readRaster(filePath);
    assert.equal(source.width, fragment.width, `${fragment.key} width differs from manifest`);
    assert.equal(source.height, fragment.height, `${fragment.key} height differs from manifest`);
    for (let y = 0; y < fragment.height; y += 1) {
      const sourceOffset = y * source.width * 4;
      const targetOffset = ((fragment.y + y) * canvas.width + fragment.x) * 4;
      composed.set(source.data.subarray(sourceOffset, sourceOffset + fragment.width * 4), targetOffset);
      const coverageOffset = (fragment.y + y) * canvas.width + fragment.x;
      for (let x = 0; x < fragment.width; x += 1) coverage[coverageOffset + x] += 1;
    }
  }

  let min = 255;
  let max = 0;
  let uncovered = 0;
  let overdrawn = 0;
  for (const value of coverage) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    if (value === 0) uncovered += 1;
    if (value > 1) overdrawn += 1;
  }

  const filePath = path.join(outputDir, `composed-${mode}-static.png`);
  fs.writeFileSync(filePath, PNG.sync.write({ width: canvas.width, height: canvas.height, data: composed }));
  return { filePath, coverage: { min, max, uncovered, overdrawn } };
}

function assertReadmeContract(readme: string, data: ReturnType<typeof loadProfileData>): Record<string, unknown> {
  const layouts = computeSplitLayouts(data);
  const pictures = [...readme.matchAll(/<picture>([\s\S]*?)<\/picture>/g)].map((match) => match[1]);
  const sources = [...readme.matchAll(/<source\b[^>]*>/g)].map((match) => match[0]);
  const anchors = [...readme.matchAll(/<a\s+href="([^"]+)"[^>]*>/g)].map((match) => match[1]);
  const expectedFragments = layouts.wide.fragments.length;
  const expectedUrls = [
    data.profileUrl,
    ...data.upstreamExamples.flatMap((item) => [item.repositoryUrl, item.prUrl]),
    ...data.personalProjects.filter((item) => !item.placeholder).map((item) => item.url)
  ].filter((url): url is string => Boolean(url));

  assert.equal(pictures.length, expectedFragments, "README picture count changed");
  assert.equal((readme.match(/<img\b/g) || []).length, expectedFragments, "README image count changed");
  assert.deepEqual(anchors, expectedUrls, "README image-link order changed");
  assert.equal(sources.length, 2 * 8 + (expectedFragments - 2) * 2, "README source count changed");
  assert.match(pictures[0], /prefers-reduced-data: reduce[^>]*type="image\/png"/);
  assert.match(pictures[0], /prefers-reduced-motion: reduce[^>]*profile-narrow-split-header-static\.svg/);
  assert.match(pictures[0], /srcset="\.\/assets\/profile-wide-split-header\.svg"/);
  assert.match(pictures.at(-2) || "", /srcset="\.\/assets\/profile-wide-split-metrics\.svg"/);
  assert.doesNotMatch(pictures[1], /profile-(?:wide|narrow)-split-overview\.svg/);
  assert.match(pictures[1], /profile-wide-split-overview-static\.png/);
  assert.match(pictures[1], /profile-narrow-split-overview-static\.png/);
  assert.equal((pictures[1].match(/<source\b/g) || []).length, 2);
  assert.match(pictures[0], /<img src="\.\/assets\/profile-wide-split-header-static\.png" width="100%"[^>]*loading="eager"[^>]*decoding="async"/);

  const rows = [...readme.matchAll(/<div align="center">([\s\S]*?)<\/div>/g)].map((match) => match[1]);
  assert.equal(rows.length, 1 + 1 + data.upstreamExamples.length + 1 + data.personalProjects.length + 1 + 1);
  const pairRows = rows.filter((row) => /profile-(?:wide|narrow)-split-open-\d{2}-repo/.test(row));
  assert.equal(pairRows.length, data.upstreamExamples.length);
  assert.ok(pairRows.every((row) => /<\/picture><\/a><a href=/.test(row)));
  assert.ok(pairRows.every((row) => !/<\/picture>\s+<a href=/.test(row)));

  const assetReferences = [...readme.matchAll(/\b(?:src|srcset)="([^"]+)"/g)]
    .map((match) => match[1].split(/\s+/)[0])
    .map((reference) => path.basename(new URL(reference, "https://example.invalid/").pathname));
  for (const filename of new Set(assetReferences)) {
    assert.ok(fs.existsSync(path.join(generatedDir, filename)), `README references missing asset ${filename}`);
  }

  for (const url of expectedUrls) assert.ok(readme.includes(url), `README is missing ${url}`);
  for (const project of data.personalProjects.filter((item) => item.placeholder)) {
    assert.ok(!readme.includes(`${project.title}](<`), "placeholder project received a link");
  }

  return {
    pictureCount: pictures.length,
    sourceCount: sources.length,
    expectedLinkCount: expectedUrls.length,
    imageFallback: "profile-wide-split-header-static.png",
    existingAssetCount: new Set(assetReferences).size
  };
}

function assertMarkdownFallbackContract(textFallback: string, data: ReturnType<typeof loadProfileData>): Record<string, unknown> {
  const links = [...textFallback.matchAll(/\[([^\]]+)\]\(<(https:\/\/[^>]+)>\)/g)]
    .map((match) => ({ label: match[1], href: match[2] }));
  const expected = [
    ...data.upstreamExamples.flatMap((item) => [item.repositoryUrl, item.prUrl]),
    ...data.personalProjects.filter((item) => !item.placeholder).map((item) => item.url),
    data.profileUrl
  ].filter((url): url is string => Boolean(url));
  assert.equal(links.length, expected.length, "Markdown fallback link count changed");
  assert.deepEqual(links.map((link) => link.href), expected, "Markdown fallback link order changed");
  assert.ok(links.every((link) => link.href.startsWith("https://") && link.label.length > 0));
  return { count: links.length, hrefs: links.map((link) => link.href) };
}

async function checkResponsive(browser: any, server: TestServer, snippet: string, textFallback: string): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  for (const width of [320, 375, 390, 430, 640, 641, 768, 838, 941, 1440]) {
    server.setDocument(harnessHtml(snippet.replaceAll('loading="lazy"', 'loading="eager"'), textFallback));
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    try {
      await page.goto(server.url, { waitUntil: "load" });
      await waitForImage(page);
      const state = await page.evaluate(() => {
        const image = document.querySelector("img") as HTMLImageElement;
        const anchor = document.querySelector("main a") as HTMLAnchorElement | null;
        const rect = image.getBoundingClientRect();
        return {
          currentSrc: image.currentSrc,
          width: rect.width,
          height: rect.height,
          scrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          alt: image.alt,
          anchorHref: anchor?.href || null
        };
      });
      const expected = width <= 640 ? "profile-narrow-split-header.svg" : "profile-wide-split-header.svg";
      assert.equal(basename(state.currentSrc), expected, `${width}px selected the wrong profile asset`);
      assert.ok(state.width <= width + 0.5, `${width}px image overflows its viewport`);
      assert.ok(state.scrollWidth <= width + 1, `${width}px page has horizontal overflow`);
      assert.ok(state.height > 0 && state.alt.length > 0, `${width}px image has no accessible dimensions/alt`);
      assert.equal(state.anchorHref, "https://github.com/jstar0");
      results.push({ width, selected: basename(state.currentSrc), renderedWidth: state.width, renderedHeight: state.height });
    } finally {
      await page.close();
    }
  }
  return results;
}

async function checkSplitGeometry(
  browser: any,
  server: TestServer,
  snippet: string,
  textFallback: string,
  data: ReturnType<typeof loadProfileData>
): Promise<Array<Record<string, unknown>>> {
  const layouts = computeSplitLayouts(data);
  const expectedKeys = [
    "header",
    "overview",
    ...data.upstreamExamples.flatMap((_, index) => {
      const suffix = String(index + 1).padStart(2, "0");
      return [`open-${suffix}-repo`, `open-${suffix}-pr`];
    }),
    "projects-heading",
    ...data.personalProjects.map((_, index) => `project-${String(index + 1).padStart(2, "0")}`),
    "metrics",
    "footer"
  ];
  const expectedRows = 1 + 1 + data.upstreamExamples.length + 1 + data.personalProjects.length + 1 + 1;
  const reports: Array<Record<string, unknown>> = [];
  const qaSnippet = snippet.replaceAll('loading="lazy"', 'loading="eager"');

  for (const width of [320, 390, 640, 641, 768, 838, 941, 1440]) {
    server.setDocument(harnessHtml(qaSnippet, textFallback));
    const page = await browser.newPage({ viewport: { width, height: 1200 }, deviceScaleFactor: 1 });
    try {
      await page.goto(server.url, { waitUntil: "load" });
      await waitForAllImages(page);
      const state = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("#image-layer > div")];
        return rows.map((row) => {
          const rowRect = row.getBoundingClientRect();
          const images = [...row.querySelectorAll("img")].map((image) => {
            const rect = image.getBoundingClientRect();
            return {
              src: image.currentSrc,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            };
          });
          const anchors = [...row.querySelectorAll("a")].map((anchor) => {
            const rect = anchor.getBoundingClientRect();
            return { href: (anchor as HTMLAnchorElement).href, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          });
          return {
            x: rowRect.x,
            y: rowRect.y,
            width: rowRect.width,
            height: rowRect.height,
            images,
            anchors
          };
        });
      });

      assert.equal(state.length, expectedRows, `${width}px row count changed`);
      let imageIndex = 0;
      let previousBottom = 0;
      const imageReports: Array<Record<string, unknown>> = [];
      for (let rowIndex = 0; rowIndex < state.length; rowIndex += 1) {
        const row = state[rowIndex];
        const expectedImageCount = rowIndex >= 2 && rowIndex < 2 + data.upstreamExamples.length ? 2 : 1;
        assert.equal(row.images.length, expectedImageCount, `${width}px row ${rowIndex} image count changed`);
        const rowKeys = expectedKeys.slice(imageIndex, imageIndex + expectedImageCount);
        const expectedRowHrefs = rowKeys
          .map((key) => layouts[width <= 640 ? "narrow" : "wide"].fragments.find((fragment) => fragment.key === key)?.href)
          .filter((href): href is string => Boolean(href));
        assert.deepEqual(row.anchors.map((anchor: { href: string }) => anchor.href), expectedRowHrefs, `${width}px row ${rowIndex} links changed`);
        assert.ok(row.width <= width + 0.5 && row.width > 0, `${width}px row ${rowIndex} width is invalid`);
        assert.ok(row.y >= previousBottom - 1.5, `${width}px row ${rowIndex} overlaps the previous row`);
        previousBottom = row.y + row.height;

        const expectedMode = width <= 640 ? "narrow" : "wide";
        const rowImages = row.images;
        for (const image of rowImages) {
          const expectedKey = expectedKeys[imageIndex];
          const expectedAnimated = expectedKey === "header" || expectedKey === "metrics";
          const expectedFilename = expectedAnimated
            ? `profile-${expectedMode}-split-${expectedKey}.svg`
            : `profile-${expectedMode}-split-${expectedKey}-static.png`;
          assert.equal(basename(image.src), expectedFilename, `${width}px selected the wrong asset for ${expectedKey}`);
          assert.ok(image.naturalWidth > 0 && image.naturalHeight > 0, `${width}px ${expectedKey} image did not load`);
          assert.ok(image.width > 0 && image.height > 0, `${width}px ${expectedKey} has no rendered box`);
          imageIndex += 1;
        }

        const first = rowImages[0];
        assert.ok(first);
        if (rowImages.length === 1) {
          assert.ok(Math.abs(first.width - row.width) <= 1.5, `${width}px full row is not flush with its container`);
        } else {
          const second = rowImages[1];
          assert.ok(second);
          assert.ok(Math.abs(first.y - second.y) <= 1.5, `${width}px split halves have different y coordinates`);
          const gap = second.x - (first.x + first.width);
          assert.ok(Math.abs(gap) <= 1.5, `${width}px split halves have a ${gap}px gap/overlap`);
          const contentWidth = second.x + second.width - first.x;
          assert.ok(Math.abs(contentWidth - row.width) <= 1.5, `${width}px split halves do not span the row`);
          assert.equal(row.anchors.length, 2, `${width}px split row does not expose two independent hit areas`);
          for (let anchorIndex = 0; anchorIndex < 2; anchorIndex += 1) {
            const anchor = row.anchors[anchorIndex];
            const image = rowImages[anchorIndex];
            assert.ok(Math.abs(anchor.x - image.x) <= 1.5, `${width}px split anchor ${anchorIndex} is offset from its image`);
            assert.ok(Math.abs(anchor.width - image.width) <= 1.5, `${width}px split anchor ${anchorIndex} width differs from its image`);
            assert.ok(Math.abs(anchor.y - image.y) <= 1.5, `${width}px split anchor ${anchorIndex} y differs from its image`);
          }
        }

        for (const anchor of row.anchors) {
          assert.ok(anchor.width > 0 && anchor.height > 0, `${width}px linked fragment has no hit area`);
        }
        imageReports.push({
          key: expectedKeys[imageIndex - rowImages.length],
          imageCount: rowImages.length,
          y: first.y,
          width: rowImages.reduce((sum: number, image: { width: number }) => sum + image.width, 0)
        });
      }
      assert.equal(imageIndex, expectedKeys.length, `${width}px image order count changed`);

      if (width === 390 || width === 941) {
        await page.locator("#image-layer").screenshot({
          path: path.join(outputDir, `split-layout-${width}.png`)
        });
      }
      reports.push({ width, rowCount: state.length, imageCount: imageIndex, rows: imageReports });
    } finally {
      await page.close();
    }
  }
  assert.equal(expectedKeys.length, layouts.wide.fragments.length);
  return reports;
}

async function checkReducedMotion(browser: any, server: TestServer, snippet: string, textFallback: string): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  for (const width of [390, 768]) {
    server.setDocument(harnessHtml(snippet.replaceAll('loading="lazy"', 'loading="eager"'), textFallback));
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(server.url, { waitUntil: "load" });
      await waitForImage(page);
      const selected = await page.locator("img").first().evaluate((image: HTMLImageElement) => image.currentSrc.split("/").pop() || "");
      const expected = width <= 640 ? "profile-narrow-split-header-static.svg" : "profile-wide-split-header-static.svg";
      assert.equal(selected, expected, `${width}px reduced-motion did not select static SVG`);
      results.push({ width, selected });
    } finally {
      await page.close();
    }
  }
  return results;
}

async function checkImageHitAreas(
  browser: any,
  server: TestServer,
  snippet: string,
  textFallback: string,
  data: ReturnType<typeof loadProfileData>
): Promise<Record<string, unknown>> {
  server.setDocument(harnessHtml(snippet.replaceAll('loading="lazy"', 'loading="eager"'), textFallback));
  const page = await browser.newPage({ viewport: { width: 941, height: 700 }, deviceScaleFactor: 1 });
  try {
    await page.goto(server.url, { waitUntil: "load" });
    await waitForAllImages(page);
    const reports = await page.evaluate(async () => {
      const anchors = [...document.querySelectorAll("#image-layer a")];
      const result: Array<{ label: string; href: string; hits: Array<string | null> }> = [];
      for (const anchor of anchors) {
        const image = anchor.querySelector("img");
        if (!image) continue;
        image.scrollIntoView({ block: "center" });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const rect = image.getBoundingClientRect();
        const points = [
          [rect.left + rect.width / 2, rect.top + rect.height / 2],
          [rect.left + Math.min(2, rect.width / 3), rect.top + Math.min(2, rect.height / 3)],
          [rect.right - Math.min(2, rect.width / 3), rect.bottom - Math.min(2, rect.height / 3)]
        ];
        result.push({
          label: anchor.getAttribute("aria-label") || "",
          href: (anchor as HTMLAnchorElement).href,
          hits: points.map(([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.getAttribute("aria-label") || null)
        });
      }
      return result;
    }) as Array<{ label: string; href: string; hits: Array<string | null> }>;
    const expected = [
      { label: "Profile identity", href: data.profileUrl },
      ...data.upstreamExamples.flatMap((item) => [
        { label: `Repository ${item.repository}`, href: item.repositoryUrl },
        { label: `Pull request ${item.repository} ${item.pr}`, href: item.prUrl }
      ]),
      ...data.personalProjects
        .filter((item) => !item.placeholder && item.url)
        .map((item) => ({ label: `Personal project ${item.title}`, href: item.url }))
    ].filter((item): item is { label: string; href: string } => Boolean(item.href));
    assert.equal(reports.length, expected.length, "linked image count changed");
    assert.deepEqual(reports.map((report) => ({ label: report.label, href: report.href })), expected, "linked image order changed");
    assert.ok(reports.every((report) => report.hits.every((hit) => hit === report.label)), "an image point resolves outside its owning link");
    return { count: reports.length, allImagePointsHitOwningAnchor: true };
  } finally {
    await page.close();
  }
}

function lowDataShim(snippet: string): string {
  return snippet
    .replaceAll("(max-width: 640px) and (prefers-reduced-data: reduce)", "(max-width: 640px) and (min-width: 0px)")
    .replaceAll("(prefers-reduced-data: reduce)", "(min-width: 0px)");
}

function noSvgShim(snippet: string): string {
  return snippet.replaceAll('type="image/svg+xml"', 'type="image/x-jstar-svg"');
}

async function checkSourceFallbacks(
  browser: any,
  server: TestServer,
  snippet: string,
  textFallback: string
): Promise<Record<string, unknown>> {
  const checks: Record<string, string> = {};
  for (const [name, variant, widths, expected] of [
    ["reduced-data", lowDataShim(snippet), [390, 768], ["profile-narrow-split-header-static.png", "profile-wide-split-header-static.png"]],
    ["no-svg", noSvgShim(snippet), [390, 768], ["profile-narrow-split-header-static.png", "profile-wide-split-header-static.png"]]
  ] as Array<[string, string, number[], string[]]>) {
    for (let index = 0; index < widths.length; index += 1) {
      const width = widths[index];
      server.setDocument(harnessHtml(variant.replaceAll('loading="lazy"', 'loading="eager"'), textFallback));
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      try {
        await page.goto(server.url, { waitUntil: "load" });
        await waitForImage(page);
        const selected = await page.locator("img").first().evaluate((image: HTMLImageElement) => image.currentSrc.split("/").pop() || "");
        assert.equal(selected, expected[index], `${name} fallback failed at ${width}px`);
        checks[`${name}-${width}`] = selected;
      } finally {
        await page.close();
      }
    }
  }
  return checks;
}

async function checkSvgOnly(
  browser: any,
  server: TestServer,
  data: ReturnType<typeof loadProfileData>,
  textFallback: string
): Promise<Record<string, string>> {
  const checks: Record<string, string> = {};
  const snippet = renderReadmeSnippet(data, { includePngFallback: false }).replaceAll('loading="lazy"', 'loading="eager"');
  for (const width of [390, 768]) {
    server.setDocument(harnessHtml(snippet, textFallback));
    const page = await browser.newPage({ viewport: { width, height: 1200 }, deviceScaleFactor: 1 });
    try {
      await page.goto(server.url, { waitUntil: "load" });
      await waitForAllImages(page);
      const selected = await page.locator("img").first().evaluate((image: HTMLImageElement) => ({
        first: image.currentSrc.split("/").pop() || "",
        allStaticSvg: [...document.images].every((candidate) => candidate.currentSrc.endsWith("-static.svg"))
      }));
      const expected = width <= 640 ? "profile-narrow-split-header-static.svg" : "profile-wide-split-header-static.svg";
      assert.equal(selected.first, expected, `${width}px SVG-only mode selected the wrong asset`);
      assert.equal(selected.allStaticSvg, true, `${width}px SVG-only mode selected a motion/non-static asset`);
      checks[String(width)] = selected.first;
    } finally {
      await page.close();
    }
  }
  return checks;
}

async function checkNormalRequestPlan(
  browser: any,
  server: TestServer,
  snippet: string,
  textFallback: string
): Promise<Record<string, unknown>> {
  const requestsByWidth: Record<string, string[]> = {};
  const qaSnippet = snippet.replaceAll('loading="lazy"', 'loading="eager"');
  const expectedImageCount = (qaSnippet.match(/<img\b/g) || []).length;
  for (const width of [390, 941]) {
    server.clearRequests();
    server.setDocument(harnessHtml(qaSnippet, textFallback));
    const page = await browser.newPage({ viewport: { width, height: 1200 }, deviceScaleFactor: 1 });
    try {
      await page.goto(server.url, { waitUntil: "load" });
      await waitForAllImages(page);
      const requests = server.requests();
      assert.equal(requests.length, expectedImageCount, `${width}px normal mode made an unexpected number of image requests`);
      const svgRequests = requests.filter((filename) => filename.endsWith(".svg"));
      const pngRequests = requests.filter((filename) => filename.endsWith(".png"));
      assert.equal(svgRequests.length, 2, `${width}px normal mode requested more than the two animated SVG units`);
      assert.equal(pngRequests.length, expectedImageCount - 2, `${width}px normal mode did not use PNG for the static units`);
      const mode = width <= 640 ? "narrow" : "wide";
      assert.deepEqual(new Set(svgRequests), new Set([
        `profile-${mode}-split-header.svg`,
        `profile-${mode}-split-metrics.svg`
      ]));
      assert.ok(pngRequests.every((filename) => filename.includes(`profile-${mode}-split-`) && filename.endsWith("-static.png")));
      requestsByWidth[String(width)] = requests;
    } finally {
      await page.close();
    }
  }
  return requestsByWidth;
}

async function checkBrokenImage(browser: any, server: TestServer, snippet: string, textFallback: string): Promise<Record<string, unknown>> {
  const broken = snippet
    .replaceAll(".svg", "-missing.svg")
    .replaceAll(".png", "-missing.png");
  server.setDocument(harnessHtml(broken, textFallback));
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(server.url, { waitUntil: "load" });
    await waitForImage(page, true);
    const state = await page.evaluate(() => {
      const image = document.querySelector("img") as HTMLImageElement;
      const fallback = document.querySelector("#text-fallback") as HTMLElement;
      return { naturalWidth: image.naturalWidth, alt: image.alt, fallbackHeight: fallback.getBoundingClientRect().height };
    });
    assert.equal(state.naturalWidth, 0, "broken image unexpectedly loaded");
    assert.ok(state.alt.length > 0 && state.fallbackHeight > 0, "text fallback is not visible after image failure");
    return state;
  } finally {
    await page.close();
  }
}

async function checkSlowNetwork(browser: any, server: TestServer, snippet: string, textFallback: string): Promise<Record<string, unknown>> {
  server.setDelay(700);
  server.setDocument(harnessHtml(snippet, textFallback));
  const page = await browser.newPage({ viewport: { width: 941, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await sleep(80);
    const duringLoad = await page.evaluate(() => {
      const image = document.querySelector("img") as HTMLImageElement;
      const fallback = document.querySelector("#text-fallback") as HTMLElement;
      return {
        imageComplete: image.complete,
        fallbackVisible: fallback.getBoundingClientRect().height > 0
      };
    });
    assert.ok(duringLoad.fallbackVisible, "text fallback is hidden while the image is loading");
    await waitForImage(page);
    return duringLoad;
  } finally {
    await page.close();
    server.setDelay(0);
  }
}

async function checkStaticVisuals(browser: any, server: TestServer): Promise<Record<string, PixelReport>> {
  const comparisons: Record<string, PixelReport> = {};
  for (const [name, width, expectedFile] of [
    ["wide", 941, "profile-wide-static.png"],
    ["narrow", 680, "profile-narrow-static.png"]
  ] as Array<[string, number, string]>) {
    const imageHeight = name === "wide" ? 1604 : 2140;
    server.setDocument(directImageHtml(expectedFile.replace(".png", ".svg")));
    const page = await browser.newPage({ viewport: { width, height: imageHeight }, deviceScaleFactor: 1 });
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(server.url, { waitUntil: "load" });
      await waitForImage(page);
      const screenshotPath = path.join(outputDir, `picture-${name}-static.png`);
      await page.locator("img").screenshot({ path: screenshotPath });
      const report = comparePng(screenshotPath, path.join(generatedDir, expectedFile));
      assert.ok(report.ratio <= 0.002, `${name} README image differs from its static PNG by ${report.ratio}`);
      comparisons[name] = report;
    } finally {
      await page.close();
    }
  }
  return comparisons;
}

async function checkSplitStaticVisuals(
  browser: any,
  server: TestServer,
  data: ReturnType<typeof loadProfileData>
): Promise<Record<string, unknown>> {
  const fragments = [
    ...computeSplitLayouts(data).wide.fragments,
    ...computeSplitLayouts(data).narrow.fragments
  ];
  const markup = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}img{display:block}</style></head><body>${fragments.map((fragment) => {
    const filename = splitAssetFilename(fragment, "static", "svg");
    return `<img src="/assets/${filename}" width="${fragment.width}" height="${fragment.height}" alt="">`;
  }).join("")}</body></html>`;
  server.setDocument(markup);
  const page = await browser.newPage({ viewport: { width: 941, height: 1200 }, deviceScaleFactor: 1 });
  const reports: Record<string, PixelReport> = {};
  const failures: string[] = [];
  try {
    await page.goto(server.url, { waitUntil: "load" });
    await waitForAllImages(page);
    for (let index = 0; index < fragments.length; index += 1) {
      const fragment = fragments[index];
      const filename = splitAssetFilename(fragment, "static", "png");
      const screenshotPath = path.join(outputDir, `split-svg-${fragment.mode}-${fragment.key}.png`);
      await page.locator("img").nth(index).screenshot({ path: screenshotPath });
      const report = comparePng(screenshotPath, path.join(generatedDir, filename));
      reports[`${fragment.mode}-${fragment.key}`] = report;
      if (report.ratio > 0.002) {
        failures.push(`${fragment.mode}/${fragment.key}: ${report.ratio} (${report.changedPixels} pixels)`);
      }
    }
  } finally {
    await page.close();
  }
  assert.equal(failures.length, 0, `split SVG pixel mismatches:\n${failures.join("\n")}`);
  const ratios = Object.values(reports).map((report) => report.ratio);
  return {
    count: fragments.length,
    maxRatio: Math.max(...ratios),
    changedPixels: Object.values(reports).reduce((sum, report) => sum + report.changedPixels, 0)
  };
}

async function checkInlineSvgLinks(browser: any, data: ReturnType<typeof loadProfileData>): Promise<Record<string, unknown>> {
  const svg = fs.readFileSync(path.join(generatedDir, "profile-wide-static.svg"), "utf8").replace(/^<\?xml[^>]+>\s*/, "");
  const page = await browser.newPage({ viewport: { width: 941, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(`<!doctype html><style>html,body{margin:0;padding:0}svg{display:block}</style>${svg}`);
    await page.evaluate(() => document.fonts?.ready);
    const links = await page.$$eval("svg a", (nodes: Element[]) => nodes.map((node: Element) => ({
      href: (node as SVGElement).getAttribute("href"),
      label: (node as SVGElement).getAttribute("aria-label"),
      box: (node as SVGGraphicsElement).getBBox ? (node as SVGGraphicsElement).getBBox().width : 0
    })));
    const expectedHrefs = [
      data.profileUrl,
      ...data.upstreamExamples.flatMap((item) => [item.repositoryUrl, item.prUrl]),
      ...data.personalProjects.filter((item) => !item.placeholder).map((item) => item.url)
    ].filter((href): href is string => Boolean(href));
    const expectedCount = expectedHrefs.length;
    assert.equal(links.length, expectedCount, "standalone SVG link count changed");
    assert.ok(links.every((link: { href: string | null; label: string | null; box: number }) => link.href?.startsWith("https://") && link.label && link.box > 0));
    assert.deepEqual(links.map((link: { href: string | null }) => link.href), expectedHrefs, "standalone SVG link targets changed");
    return { count: links.length, hrefs: links.map((link: { href: string | null }) => link.href) };
  } finally {
    await page.close();
  }
}

function checkPerformanceContract(): Record<string, unknown> {
  const motion = fs.readFileSync(path.join(generatedDir, "profile-wide.svg"), "utf8");
  const staticSvg = fs.readFileSync(path.join(generatedDir, "profile-wide-static.svg"), "utf8");
  const splitHeaderMotion = fs.readFileSync(path.join(generatedDir, "profile-wide-split-header.svg"), "utf8");
  const splitHeaderStatic = fs.readFileSync(path.join(generatedDir, "profile-wide-split-header-static.svg"), "utf8");
  const splitOverviewMotionAlias = fs.readFileSync(path.join(generatedDir, "profile-wide-split-overview.svg"), "utf8");
  for (const forbidden of ["<script", "<foreignObject", "<filter"]) {
    assert.ok(!motion.includes(forbidden), `motion SVG contains ${forbidden}`);
  }
  assert.equal((motion.match(/<animate\b/g) || []).length, 3, "motion SVG animation count changed");
  assert.equal((staticSvg.match(/<animate\b/g) || []).length, 0, "static SVG contains animation nodes");
  assert.equal((splitHeaderMotion.match(/<animate\b/g) || []).length, 3, "split header motion asset lost its animation");
  assert.equal((splitHeaderStatic.match(/<animate\b/g) || []).length, 0, "split header static asset contains animation nodes");
  assert.equal((splitOverviewMotionAlias.match(/<animate\b/g) || []).length, 0, "non-animated split asset unexpectedly contains animation nodes");
  return {
    motionBytes: Buffer.byteLength(motion),
    staticBytes: Buffer.byteLength(staticSvg),
    pngBytes: fs.statSync(path.join(generatedDir, "profile-wide-static.png")).size,
    splitHeaderMotionBytes: Buffer.byteLength(splitHeaderMotion),
    splitHeaderStaticBytes: Buffer.byteLength(splitHeaderStatic),
    svgAnimateNodes: 3,
    runtimeScriptNodes: 0
  };
}

async function main(): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });
  const data = loadProfileData();
  const readmePath = path.join(generatedDir, "README.generated.md");
  const readme = fs.readFileSync(readmePath, "utf8");
  const snippet = renderReadmeSnippet(data);
  const textFallback = renderTextFallback(data);
  assert.equal(readme, snippet, "generated README is stale; run the generator before compatibility QA");
  assertReadmeContract(readme, data);
  const markdownFallback = assertMarkdownFallbackContract(textFallback, data);
  fs.writeFileSync(
    path.join(outputDir, "split-preview.html"),
    harnessHtml(renderReadmeSnippet(data, { assetPrefix: "../../../generated/" }), textFallback),
    "utf8"
  );
  assert.ok(fs.existsSync(path.join(generatedDir, "profile-wide-static.png")));
  assert.ok(fs.existsSync(path.join(generatedDir, "profile-narrow-static.png")));

  const splitPixels: Record<string, PixelReport> = {};
  for (const mode of ["wide", "narrow"] as const) {
    const composed = composeSplitPng(mode, data);
    assert.equal(composed.coverage.min, 1, `${mode} split manifest leaves uncovered pixels`);
    assert.equal(composed.coverage.max, 1, `${mode} split manifest overlaps pixels`);
    assert.equal(composed.coverage.uncovered, 0);
    assert.equal(composed.coverage.overdrawn, 0);
    splitPixels[mode] = comparePng(composed.filePath, path.join(generatedDir, `profile-${mode}-static.png`), 0);
    assert.equal(splitPixels[mode].changedPixels, 0, `${mode} split PNG reassembly is not pixel-identical`);
  }

  const server = await startServer(generatedDir);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(browserLaunchOptions());

  try {
    const report = {
      responsive: await checkResponsive(browser, server, snippet, textFallback),
      splitGeometry: await checkSplitGeometry(browser, server, snippet, textFallback, data),
      imageHitAreas: await checkImageHitAreas(browser, server, snippet, textFallback, data),
      reducedMotion: await checkReducedMotion(browser, server, snippet, textFallback),
      sourceFallbacks: await checkSourceFallbacks(browser, server, snippet, textFallback),
      svgOnly: await checkSvgOnly(browser, server, data, textFallback),
      normalRequestPlan: await checkNormalRequestPlan(browser, server, snippet, textFallback),
      brokenImage: await checkBrokenImage(browser, server, snippet, textFallback),
      slowNetwork: await checkSlowNetwork(browser, server, snippet, textFallback),
      staticVisuals: await checkStaticVisuals(browser, server),
      splitStaticVisuals: await checkSplitStaticVisuals(browser, server, data),
      splitPixels,
      inlineSvgLinks: await checkInlineSvgLinks(browser, data),
      markdownFallback,
      performance: checkPerformanceContract(),
      note: "Reduced-data and no-SVG cases use deterministic media/type shims because Chromium cannot emulate those preferences directly."
    };
    fs.writeFileSync(path.join(outputDir, "compat-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
