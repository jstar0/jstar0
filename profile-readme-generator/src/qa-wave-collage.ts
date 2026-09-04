import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./model.ts";
import { browserLaunchOptions, loadPlaywright } from "./qa-browser.ts";

const outputDir = path.join(PROJECT_ROOT, "qa", "output", "motion-keyframes");
const outputHtml = path.join(outputDir, "wave-design-vs-current.html");
const outputPng = path.join(outputDir, "wave-design-vs-current.png");

function referencePaths(): { motion: string; static: string } {
  return {
    motion: path.join(
      PROJECT_ROOT,
      "..",
      "designs",
      "profile-readme",
      "motion-studies",
      "wave-flow-keyframes",
      "wave-flow-left-to-right-v1.png"
    ),
    static: path.join(
      PROJECT_ROOT,
      "..",
      "designs",
      "profile-readme",
      "profile-readme-original-system-concept-v6c-short-upstream.png"
    )
  };
}

function imageData(filePath: string): string {
  return `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`;
}

interface SourceImage {
  data: string;
  width: number;
  height: number;
}

interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function cropPanel(
  source: SourceImage,
  crop: Crop,
  title: string,
  note: string,
  accent = "current"
): string {
  const displayWidth = 840;
  const displayHeight = 120;
  const scaleX = displayWidth / crop.width;
  const scaleY = displayHeight / crop.height;
  return `
    <article class="panel ${accent}">
      <div class="panel-title">${title}</div>
      <div class="viewport">
        <img src="${source.data}" alt="" style="width:${source.width * scaleX}px;height:${source.height * scaleY}px;left:${-crop.x * scaleX}px;top:${-crop.y * scaleY}px">
        <span class="safe-line"></span>
      </div>
      <div class="panel-note">${note}</div>
    </article>`;
}

function buildHtml(): string {
  const { motion: referenceMotionPath, static: referenceStaticPath } = referencePaths();

  const referenceMotion: SourceImage = { data: imageData(referenceMotionPath), width: 1774, height: 887 };
  const referenceStatic: SourceImage = { data: imageData(referenceStaticPath), width: 941, height: 1672 };
  const current = (name: string): SourceImage => ({
    data: imageData(path.join(outputDir, name)),
    width: 941,
    height: 1672
  });

  const referenceRows = [109, 329, 549, 768];
  const currentFrames = [
    ["wide-mockup-2652ms.png", "2652 ms"],
    ["wide-mockup-3467ms.png", "3467 ms"],
    ["wide-mockup-4198ms.png", "4198 ms"],
    ["wide-mockup-5508ms.png", "5508 ms"]
  ];
  const states = [
    ["F0", "left quarter"],
    ["F1", "left-center"],
    ["F2", "center"],
    ["F3", "right quarter"]
  ];

  const rows = states.map(([frame, position], index) => {
    const reference = cropPanel(
      referenceMotion,
      { x: 0, y: referenceRows[index], width: 1774, height: 80 },
      `REFERENCE / ${frame}`,
      `design study · crest at ${position}`,
      "reference"
    );
    const [filename, time] = currentFrames[index];
    const candidate = cropPanel(
      current(filename),
      { x: 40, y: 212, width: 861, height: 35 },
      `CURRENT / ${time}`,
      `same pass · vertically enlarged · full curve plus white margin retained`,
      "current"
    );
    return `<div class="state-row"><div class="state-label"><strong>${frame}</strong><span>${position}</span></div><div class="pair">${reference}${candidate}</div></div>`;
  }).join("");

  const start = cropPanel(
    current("wide-mockup-0000ms.png"),
    { x: 40, y: 212, width: 861, height: 35 },
    "CURRENT / 0 ms",
    "complete flat baseline · pulse right edge = 45 < visible left = 65",
    "current"
  );
  const end = cropPanel(
    current("wide-mockup-8160ms.png"),
    { x: 40, y: 212, width: 861, height: 35 },
    "CURRENT / 8160 ms",
    "complete flat baseline · pulse left edge = 896 > visible right = 876",
    "current"
  );
  const staticReference = cropPanel(
    referenceStatic,
    { x: 40, y: 212, width: 861, height: 35 },
    "STATIC DESIGN / reference",
    "original concept baseline with center marker",
    "reference"
  );

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Wave design comparison</title>
<style>
  :root{font-family:Arial,"Helvetica Neue",sans-serif;color:#132238;background:#f4f7fa}
  *{box-sizing:border-box}
  body{margin:0;padding:34px 40px 46px}
  main{width:1780px;margin:0 auto}
  h1{font-size:28px;font-weight:600;letter-spacing:1px;margin:0 0 8px}
  .intro{font-size:15px;color:#53627a;margin:0 0 26px;line-height:1.55}
  .legend{display:flex;gap:22px;align-items:center;color:#53627a;font-size:13px;margin-bottom:22px}
  .legend i{display:inline-block;width:34px;height:2px;vertical-align:middle;margin-right:7px;background:#2168e8}
  .legend i.ref{background:#132238}
  .state-row{display:grid;grid-template-columns:110px 1fr;gap:18px;margin-bottom:20px;align-items:start}
  .state-label{padding-top:15px;color:#53627a;text-transform:uppercase;letter-spacing:1.2px;font-size:12px}
  .state-label strong{display:block;color:#132238;font-size:20px;letter-spacing:1px;margin-bottom:5px}
  .state-label span{display:block;line-height:1.35}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .panel{background:#fff;border:1px solid #d6dee8;padding:12px 12px 10px}
  .panel-title{font-size:12px;letter-spacing:1.35px;font-weight:600;margin-bottom:9px;color:#132238}
  .reference .panel-title{color:#53627a}
  .viewport{position:relative;width:840px;height:120px;overflow:hidden;background:#fff}
  .viewport img{position:absolute;max-width:none;display:block}
  .safe-line{position:absolute;left:0;right:0;top:60px;border-top:1px dashed rgba(129,144,164,.38);pointer-events:none}
  .panel-note{font-size:12px;color:#53627a;line-height:1.4;margin-top:9px;min-height:17px}
  h2{font-size:17px;letter-spacing:1.1px;font-weight:600;margin:34px 0 14px}
  .ends{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .method{font-size:13px;color:#53627a;margin-top:28px;border-top:1px solid #d6dee8;padding-top:15px;line-height:1.55}
</style></head><body><main>
<h1>Wave geometry: design study vs rendered SVG</h1>
<p class="intro">All strips are enlarged around the same baseline. The dashed centerline is only a reading guide; the white space above and below is retained to expose clipping.</p>
<div class="legend"><span><i class="ref"></i>reference design study</span><span><i></i>current SVG render</span><span>same baseline · enlarged wave band · white margins retained</span></div>
${rows}
<h2>ENTRY / EXIT CHECK</h2>
<div class="ends">${staticReference}${start}${end}</div>
<p class="method">The current SVG uses a full-height horizontal clip path for the wave span, so the visible line is clipped only on the left/right span boundaries. The top and bottom of the wave are not clipped by that clip path.</p>
</main></body></html>`;
}

async function main(): Promise<void> {
  const references = referencePaths();
  if (!fs.existsSync(references.motion) || !fs.existsSync(references.static)) {
    console.log("Skipped visual collage: optional external reference files are not present.");
    return;
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputHtml, buildHtml(), "utf8");
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(browserLaunchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1860, height: 2200 }, deviceScaleFactor: 1 });
    await page.goto(`file://${outputHtml}`, { waitUntil: "load" });
    await page.screenshot({ path: outputPng, fullPage: true });
  } finally {
    await browser.close();
  }
  console.log(`Generated ${outputPng}`);
}

await main();
