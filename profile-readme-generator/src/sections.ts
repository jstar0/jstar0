import type { ProfileData } from "./model.ts";
import type { LayoutCoordinates } from "./layout.ts";
import { colors, embeddedAvatarHref, fonts, layout, type ThemeColor } from "./theme.ts";
import {
  anchor,
  circle,
  color,
  element,
  fitText,
  group,
  line,
  multilineText,
  path,
  rect,
  selfClosing,
  text,
  wrapText
} from "./svg.ts";

const wide = layout.wide;
const narrow = layout.narrow;
const avatarHref = embeddedAvatarHref();

interface WaveFrame {
  centerX: number;
  crestHeight: number;
  troughHeight: number;
}

interface WaveMotionSpec {
  frames: WaveFrame[];
  allFrames: WaveFrame[];
  keyTimes: string;
  scale: number;
}

// The offscreen entry and exit add travel distance. Keep the pass deliberately
// slow enough to read as a quiet signal instead of a quick UI sweep.
const WAVE_DURATION = "8.16s";
const WAVE_LEAD_DISTANCE = 160;
const WAVE_TAIL_DISTANCE = 220;
const WAVE_OFFSCREEN_GAP = 20;
const WAVE_SHAPE_LEAD_DISTANCE = 105;
const WAVE_SHAPE_TROUGH_OFFSET = 96;
const WAVE_SHAPE_TAIL_DISTANCE = 210;
const WAVE_REFERENCE_WIDTH = wide.right - wide.margin;
const WAVE_CENTER_FRACTIONS = [
  WAVE_LEAD_DISTANCE / WAVE_REFERENCE_WIDTH,
  0.349,
  0.485,
  1 - WAVE_TAIL_DISTANCE / WAVE_REFERENCE_WIDTH
] as const;

const headingStyle = {
  "font-size": 20,
  "font-weight": 600,
  "letter-spacing": 2.1,
  fill: colors.ink
};

const eyebrowStyle = {
  "font-size": 13,
  "font-weight": 500,
  "letter-spacing": 1.45,
  fill: colors.muted
};

const bodyStyle = {
  "font-size": 15,
  "font-weight": 400,
  fill: colors.muted
};

const wideBodyStyle = {
  ...bodyStyle,
  "letter-spacing": 0.55
};

const wideEyebrowStyle = {
  ...eyebrowStyle,
  "letter-spacing": 1.1
};

function waveMotionSpec(startX: number, endX: number, wideMode: boolean): WaveMotionSpec {
  const width = endX - startX;
  const scale = wideMode ? 1 : width / (wide.right - wide.margin);
  const crestHeights = wideMode ? [4.2, 5.7, 7.0, 6.5] : [3.2, 4.2, 5.15, 4.8];
  const troughHeights = wideMode ? [1.8, 1.0, 0.65, 0.45] : [1.35, 0.75, 0.48, 0.34];
  const frames = WAVE_CENTER_FRACTIONS.map((fraction, index) => ({
    centerX: startX + width * fraction,
    crestHeight: crestHeights[index],
    troughHeight: troughHeights[index]
  }));
  const allFrames = [
    {
      // The whole pulse is left of the visible span; this frame is a true
      // straight baseline, not a clipped or compressed bump.
      centerX: startX - (WAVE_TAIL_DISTANCE + WAVE_OFFSCREEN_GAP) * scale,
      crestHeight: 0,
      troughHeight: 0
    },
    ...frames,
    {
      // Keep the entire pulse right of the visible span before looping.
      centerX: endX + (WAVE_LEAD_DISTANCE + WAVE_OFFSCREEN_GAP) * scale,
      crestHeight: 0,
      troughHeight: 0
    }
  ];
  const firstCenter = allFrames[0].centerX;
  const lastCenter = allFrames[allFrames.length - 1].centerX;
  const keyTimes = allFrames
    .map((frame) => motionTime((frame.centerX - firstCenter) / (lastCenter - firstCenter)))
    .join(";");

  return { frames, allFrames, keyTimes, scale };
}

function waveGradientWindow(centerX: number, scale: number): { x1: number; x2: number } {
  return {
    // Keep the color field on the same moving pulse as the geometry. This
    // prevents color from appearing before the pulse enters the span.
    x1: centerX - WAVE_SHAPE_LEAD_DISTANCE * scale,
    x2: centerX + WAVE_SHAPE_TAIL_DISTANCE * scale
  };
}

function waveAnimationAttributes(keyTimes: string) {
  return {
    begin: "0s",
    dur: WAVE_DURATION,
    repeatCount: "indefinite",
    calcMode: "linear",
    keyTimes
  };
}

function renderWaveGradient(
  id: string,
  centerX: number,
  spec: WaveMotionSpec,
  motion: boolean
): string {
  const initialWindow = waveGradientWindow(centerX, spec.scale);
  const animatedWindows = spec.allFrames.map((frame) => waveGradientWindow(frame.centerX, spec.scale));
  const animations = motion
    ? [
      selfClosing("animate", {
        attributeName: "x1",
        values: animatedWindows.map((window) => svgNumber(window.x1)).join(";"),
        ...waveAnimationAttributes(spec.keyTimes)
      }),
      selfClosing("animate", {
        attributeName: "x2",
        values: animatedWindows.map((window) => svgNumber(window.x2)).join(";"),
        ...waveAnimationAttributes(spec.keyTimes)
      })
    ]
    : [];

  return element("linearGradient", {
    id,
    x1: svgNumber(initialWindow.x1),
    y1: 0,
    x2: svgNumber(initialWindow.x2),
    y2: 0,
    gradientUnits: "userSpaceOnUse"
  }, [
    // The gradient is the complete stroke. Keeping the edge stops opaque ink
    // avoids needing a second baseline underneath the moving accent.
    selfClosing("stop", { offset: "0%", "stop-color": colors.ink }),
    selfClosing("stop", { offset: "14%", "stop-color": colors.ink }),
    selfClosing("stop", { offset: "28%", "stop-color": colors.blue }),
    selfClosing("stop", { offset: "46%", "stop-color": colors.blue }),
    selfClosing("stop", { offset: "60%", "stop-color": colors.cyan }),
    selfClosing("stop", { offset: "73%", "stop-color": colors.mint }),
    selfClosing("stop", { offset: "84%", "stop-color": colors.mint }),
    selfClosing("stop", { offset: "100%", "stop-color": colors.ink }),
    ...animations
  ].join(""));
}

export function renderDefs(coordinates: LayoutCoordinates, motion = false): string {
  const clipId = coordinates.mode === "wide" ? "language-clip-wide" : "language-clip-narrow";
  const wideMode = coordinates.mode === "wide";
  const waveSpec = waveMotionSpec(coordinates.margin, coordinates.right, wideMode);
  const waveGradientId = `wave-accent-line-${coordinates.mode}`;
  return element("defs", {}, [
    avatarHref
      ? selfClosing("image", {
        id: "jstar-avatar-image",
        x: 0,
        y: 0,
        width: 128,
        height: 128,
        href: avatarHref,
        "xlink:href": avatarHref,
        preserveAspectRatio: "none"
      })
      : "",
    element("linearGradient", { id: "avatar-ring", x1: "0%", y1: "0%", x2: "0%", y2: "100%" }, [
      selfClosing("stop", { offset: "0%", "stop-color": colors.blue }),
      selfClosing("stop", { offset: "52%", "stop-color": colors.cyan }),
      selfClosing("stop", { offset: "100%", "stop-color": colors.mint })
    ].join("")),
    element("linearGradient", { id: "avatar-fill", x1: "0%", y1: "0%", x2: "0%", y2: "100%" }, [
      selfClosing("stop", { offset: "0%", "stop-color": colors.blue }),
      selfClosing("stop", { offset: "54%", "stop-color": colors.cyan }),
      selfClosing("stop", { offset: "100%", "stop-color": colors.mint })
    ].join("")),
    element("linearGradient", { id: "accent-line", x1: "0%", y1: "0%", x2: "100%", y2: "0%" }, [
      selfClosing("stop", { offset: "0%", "stop-color": colors.blue }),
      selfClosing("stop", { offset: "52%", "stop-color": colors.cyan }),
      selfClosing("stop", { offset: "100%", "stop-color": colors.mint })
    ].join("")),
    renderWaveGradient(waveGradientId, waveSpec.frames[2].centerX, waveSpec, false),
    element("clipPath", { id: `wave-span-${coordinates.mode}` }, rect(
      coordinates.margin,
      0,
      coordinates.right - coordinates.margin,
      coordinates.height
    )),
    motion
      ? renderWaveGradient(`${waveGradientId}-motion`, waveSpec.allFrames[0].centerX, waveSpec, true)
      : "",
    element("linearGradient", { id: "language-bar", x1: "0%", y1: "0%", x2: "100%", y2: "0%" }, [
      selfClosing("stop", { offset: "0%", "stop-color": colors.blue }),
      selfClosing("stop", { offset: "77.64%", "stop-color": colors.blue }),
      selfClosing("stop", { offset: "77.64%", "stop-color": colors.yellow }),
      selfClosing("stop", { offset: "87.98%", "stop-color": colors.yellow }),
      selfClosing("stop", { offset: "87.98%", "stop-color": colors.cyan }),
      selfClosing("stop", { offset: "97.8%", "stop-color": colors.cyan }),
      selfClosing("stop", { offset: "97.8%", "stop-color": colors.orange }),
      selfClosing("stop", { offset: "100%", "stop-color": colors.orange })
    ].join("")),
    element("clipPath", { id: clipId }, rect(
      coordinates.margin,
      coordinates.languageBarY,
      coordinates.mode === "wide" ? 339 : 596,
      coordinates.languageBarHeight,
      { rx: coordinates.languageBarHeight / 2, ry: coordinates.languageBarHeight / 2 }
    ))
  ].join(""));
}

function accentColor(accent: ThemeColor): string {
  return color(accent);
}

function linkedSvgContent(href: string | undefined, label: string, content: string): string {
  return href ? anchor(href, content, { "aria-label": label }) : content;
}

function sectionHeading(label: string, x: number, y: number, style: Parameters<typeof text>[3] = headingStyle): string {
  return text(label, x, y, style);
}

function avatar(x: number, y: number, size: number): string {
  const scale = size / 100;
  const star = "M50 10 L63 40 L95 42 L71 61 L80 92 L50 75 L20 92 L29 61 L5 42 L37 40 Z";
  const upperBand = "M14 57 C34 53 57 42 85 26 L76 40 C54 53 34 62 14 66 Z";
  const lowerBand = "M27 69 C44 65 63 56 78 46 L71 56 C57 67 42 73 27 77 Z";

  const artwork = avatarHref
    ? selfClosing("use", {
      href: "#jstar-avatar-image",
      "xlink:href": "#jstar-avatar-image",
      transform: `scale(${size / 128})`
    })
    : [
      circle(50, 50, 46, { fill: "none", stroke: "url(#avatar-ring)", "stroke-width": 3.2 }),
      path(star, { fill: "url(#avatar-fill)", "stroke": "none" }),
      path(upperBand, { fill: colors.paper, opacity: 0.96 }),
      path(lowerBand, { fill: colors.paper, opacity: 0.96 })
    ].join("");

  return group(artwork, { transform: `translate(${x} ${y}) scale(${avatarHref ? 1 : scale})` });
}

function repoGlyph(x: number, y: number, accent: ThemeColor, index: number): string {
  const fill = accentColor(accent);
  if (index === 0) {
    return group([
      circle(x - 2, y - 2, 7.5, { fill: "none", stroke: colors.ink, "stroke-width": 2 }),
      line(x + 3, y + 3, x + 10, y + 10, { stroke: colors.ink, "stroke-width": 2 })
    ].join(""));
  }

  if (index === 1) {
    return group([
      path(`M${x} ${y - 10} L${x + 9} ${y - 4} L${x} ${y + 1} L${x - 9} ${y - 4} Z`, {
        fill: "none", stroke: colors.ink, "stroke-width": 1.8
      }),
      path(`M${x - 9} ${y - 4} L${x - 9} ${y + 5} L${x} ${y + 10} L${x + 9} ${y + 5} L${x + 9} ${y - 4}` , {
        fill: "none", stroke: colors.ink, "stroke-width": 1.8
      }),
      line(x, y + 1, x, y + 10, { stroke: colors.ink, "stroke-width": 1.5 })
    ].join(""));
  }

  if (index === 2) {
    return group([
      rect(x - 9, y - 9, 8, 8, { fill: "#f25022" }),
      rect(x + 1, y - 9, 8, 8, { fill: "#7fba00" }),
      rect(x - 9, y + 1, 8, 8, { fill: "#00a4ef" }),
      rect(x + 1, y + 1, 8, 8, { fill: "#ffb900" })
    ].join(""));
  }

  if (index === 3) {
    return group([
      path(`M${x - 10} ${y + 5} L${x - 3} ${y - 8} L${x + 2} ${y - 3} L${x - 5} ${y + 9} Z`, {
        fill: colors.blue
      }),
      path(`M${x + 1} ${y - 8} L${x + 10} ${y - 3} L${x + 4} ${y + 5} L${x - 1} ${y + 1} Z`, {
        fill: colors.orange
      })
    ].join(""));
  }

  // A compact six-loop mark keeps the OpenAI row recognizable at README scale.
  return group([
    path(`M${x} ${y - 10} C${x + 5} ${y - 10} ${x + 8} ${y - 6} ${x + 8} ${y - 2} C${x + 8} ${y + 2} ${x + 5} ${y + 5} ${x + 2} ${y + 6} L${x - 3} ${y + 9} C${x - 7} ${y + 11} ${x - 11} ${y + 8} ${x - 11} ${y + 4} C${x - 11} ${y} ${x - 8} ${y - 3} ${x - 4} ${y - 3}`, {
      fill: "none", stroke: colors.ink, "stroke-width": 1.7
    }),
    path(`M${x + 9} ${y - 1} C${x + 9} ${y + 4} ${x + 6} ${y + 7} ${x + 2} ${y + 7} C${x - 2} ${y + 7} ${x - 5} ${y + 4} ${x - 6} ${y + 1} L${x - 9} ${y - 4} C${x - 11} ${y - 8} ${x - 8} ${y - 11} ${x - 4} ${y - 11} C${x} ${y - 11} ${x + 3} ${y - 8} ${x + 3} ${y - 4}`, {
      fill: "none", stroke: colors.ink, "stroke-width": 1.7
    }),
    path(`M${x - 4} ${y - 9} C${x} ${y - 7} ${x + 2} ${y - 4} ${x + 1} ${y} C${x} ${y + 4} ${x - 3} ${y + 6} ${x - 6} ${y + 6} L${x - 11} ${y + 5} C${x - 15} ${y + 4} ${x - 16} ${y} ${x - 14} ${y - 3} C${x - 12} ${y - 6} ${x - 8} ${y - 7} ${x - 4} ${y - 6}`, {
      fill: "none", stroke: colors.ink, "stroke-width": 1.7
    })
  ].join(""));
}

function projectRowWide(
  item: ProfileData["personalProjects"][number],
  index: number,
  top: number,
  showRule: boolean
): string {
  const baseline = top + 29;
  const titleColor = item.placeholder ? colors.muted : colors.blue;
  const combined = `${item.title} / ${item.description}`;
  const row = [
    text(String(index + 1).padStart(2, "0"), wide.margin, baseline, {
      "font-size": 15,
      "font-weight": 500,
      fill: colors.blue
    }),
    line(123, top + 11, 123, top + 40, { stroke: colors.rule }),
    item.placeholder
      ? text(combined, 148, baseline, {
        "font-size": 14.2,
        "font-weight": 400,
        "letter-spacing": 0.2,
        fill: colors.muted
      })
      : [
        text(item.title, 148, baseline, {
          "font-size": 14,
          "font-weight": 500,
          fill: titleColor
        }),
        text(item.description, 330, baseline, {
          "font-size": 13.5,
          "font-weight": 400,
          fill: colors.muted
        })
      ].join(""),
    showRule ? line(wide.margin, top + 44, wide.right, top + 44, { stroke: colors.rule }) : ""
  ].join("");

  return linkedSvgContent(item.url, `Open ${item.title}`, row);
}

function projectRowNarrow(
  item: ProfileData["personalProjects"][number],
  index: number,
  top: number
): string {
  const baseline = top + 25;
  const title = item.placeholder ? `${item.title} / ${item.description}` : `${item.title} / ${item.description}`;
  const row = [
    text(String(index + 1).padStart(2, "0"), narrow.margin, baseline, {
      "font-size": 14,
      "font-weight": 500,
      fill: colors.blue
    }),
    line(93, top + 9, 93, top + 35, { stroke: colors.rule }),
    text(fitText(title, 66), 118, baseline, {
      "font-size": 13.5,
      "font-weight": item.placeholder ? 400 : 500,
      fill: item.placeholder ? colors.muted : colors.blue
    }),
    line(narrow.margin, top + 52, narrow.right, top + 52, { stroke: colors.rule })
  ].join("");

  return linkedSvgContent(item.url, `Open ${item.title}`, row);
}

function svgNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function motionTime(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function wavePath(
  startX: number,
  endX: number,
  y: number,
  centerX: number,
  scale: number,
  crestHeight: number,
  troughHeight: number
): string {
  const strokeStart = startX - (WAVE_LEAD_DISTANCE + WAVE_TAIL_DISTANCE + WAVE_OFFSCREEN_GAP) * scale;
  const strokeEnd = endX + (WAVE_LEAD_DISTANCE + WAVE_TAIL_DISTANCE + WAVE_OFFSCREEN_GAP) * scale;
  const leadStart = centerX - WAVE_SHAPE_LEAD_DISTANCE * scale;
  const trough = centerX + WAVE_SHAPE_TROUGH_OFFSET * scale;
  const tail = centerX + WAVE_SHAPE_TAIL_DISTANCE * scale;
  const riseSpan = centerX - leadStart;
  const recoverySpan = tail - trough;

  // The three cubic spans share horizontal tangents at the crest, trough,
  // and both baseline joins. That keeps the static silhouette smooth before
  // any animation or browser rasterization is involved.
  return [
    `M${svgNumber(strokeStart)} ${svgNumber(y)}`,
    `L${svgNumber(leadStart)} ${svgNumber(y)}`,
    `C${svgNumber(leadStart + riseSpan * 0.61)} ${svgNumber(y)} ${svgNumber(centerX - riseSpan * 0.394)} ${svgNumber(y - crestHeight)} ${svgNumber(centerX)} ${svgNumber(y - crestHeight)}`,
    `C${svgNumber(centerX + WAVE_SHAPE_TROUGH_OFFSET * scale * 0.313)} ${svgNumber(y - crestHeight)} ${svgNumber(trough - WAVE_SHAPE_TROUGH_OFFSET * scale * 0.374)} ${svgNumber(y + troughHeight)} ${svgNumber(trough)} ${svgNumber(y + troughHeight)}`,
    `C${svgNumber(trough + recoverySpan * 0.824)} ${svgNumber(y + troughHeight)} ${svgNumber(tail - recoverySpan * 0.882)} ${svgNumber(y)} ${svgNumber(tail)} ${svgNumber(y)}`,
    `L${svgNumber(strokeEnd)} ${svgNumber(y)}`
  ].join(" ");
}

function renderWaveBaseline(
  startX: number,
  endX: number,
  y: number,
  motion: boolean
): string {
  const wideMode = startX === 65;
  const waveSpec = waveMotionSpec(startX, endX, wideMode);
  const staticFrame = waveSpec.frames[2];
  const staticPath = wavePath(
    startX,
    endX,
    y,
    staticFrame.centerX,
    waveSpec.scale,
    staticFrame.crestHeight,
    staticFrame.troughHeight
  );
  const framePaths = waveSpec.allFrames.map((frame) => wavePath(
    startX,
    endX,
    y,
    frame.centerX,
    waveSpec.scale,
    frame.crestHeight,
    frame.troughHeight
  ));
  const staticGradientId = `wave-accent-line-${wideMode ? "wide" : "narrow"}`;
  const motionGradientId = `${staticGradientId}-motion`;

  const staticLayer = group([
    path(staticPath, {
      fill: "none",
      stroke: `url(#${staticGradientId})`,
      "stroke-width": 1.35,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "clip-path": `url(#wave-span-${wideMode ? "wide" : "narrow"})`,
      class: "wave-static-path"
    })
  ].join(""));

  if (!motion) return staticLayer;

  const animatePath = (values: string[]) => selfClosing("animate", {
    attributeName: "d",
    values: values.join(";"),
    ...waveAnimationAttributes(waveSpec.keyTimes),
    class: "motion-wave-animation"
  });
  const liveLayer = group([
    element("path", {
      d: framePaths[0],
      fill: "none",
      stroke: `url(#${motionGradientId})`,
      "stroke-width": 1.35,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "clip-path": `url(#wave-span-${wideMode ? "wide" : "narrow"})`,
      class: "motion-wave-path"
    }, animatePath(framePaths))
  ].join(""));

  return group([
    group(staticLayer, { class: "motion-wave-fallback", display: "none" }),
    group(liveLayer, { class: "motion-wave-live" })
  ].join(""));
}

export function renderHeaderWide(data: ProfileData, motion: boolean): string {
  const identity = [
    avatar(61, 30, 114),
    text(data.identity.name, 225, 116, {
      "font-family": fonts.display,
      "font-size": 89,
      "font-weight": 500,
      "textLength": 321,
      "lengthAdjust": "spacingAndGlyphs",
      fill: colors.ink
    })
  ].join("");

  return [
    linkedSvgContent(data.profileUrl, `Open ${data.identity.name} GitHub profile`, identity),
    data.identity.descriptor.map((descriptor, index) => text(descriptor, 603, index === 0 ? 83 : 110, {
      "font-size": 13.5,
      "font-weight": 500,
      "letter-spacing": 1.55,
      "textLength": index === 0 ? 269 : 221,
      "lengthAdjust": "spacingAndGlyphs",
      fill: colors.muted
    })).join(""),
    renderWaveBaseline(65, 876, 159, motion)
  ].join("");
}

export function renderHeaderNarrow(data: ProfileData, motion: boolean): string {
  const identity = [
    avatar(42, 32, 88),
    text(data.identity.name, 162, 93, {
      "font-family": fonts.display,
      "font-size": 62,
      "font-weight": 500,
      "letter-spacing": 1,
      fill: colors.ink
    })
  ].join("");

  return [
    linkedSvgContent(data.profileUrl, `Open ${data.identity.name} GitHub profile`, identity),
    multilineText(data.identity.descriptor, 162, 119, 20, {
      "font-size": 11.5,
      "font-weight": 500,
      "letter-spacing": 1.1,
      fill: colors.muted
    }),
    renderWaveBaseline(narrow.margin, narrow.right, 170, motion)
  ].join("");
}

export function renderWorkWide(data: ProfileData): string {
  const top = 276;
  const rowHeight = 67;
  const rows = data.workstreams.map((stream, index) => {
    const rowTop = top + index * rowHeight;
    const baseline = rowTop + 36;
    return [
      text(stream.index, wide.margin, baseline, {
        "font-size": 20,
        "font-weight": 500,
        fill: accentColor(stream.accent)
      }),
      line(123, rowTop + 18, 123, rowTop + 49, { stroke: colors.muted }),
      text(stream.label, 160, baseline, {
        "font-size": 15.5,
        "font-weight": 600,
        "letter-spacing": 0.45,
        fill: colors.ink
      }),
      text(stream.detail, 504, baseline, {
        "font-size": 13.5,
        "font-weight": 400,
        "letter-spacing": 0.65,
        fill: colors.muted
      }),
      index < data.workstreams.length - 1
        ? line(wide.margin, rowTop + 58, wide.right, rowTop + 58, { stroke: colors.rule })
        : ""
    ].join("");
  }).join("");

  return [
    sectionHeading("WHAT I WORK ON", 66, 220, {
      ...headingStyle,
      "textLength": 185,
      "lengthAdjust": "spacingAndGlyphs"
    }),
    text(data.identity.intro, wide.margin, 254, wideBodyStyle),
    rows
  ].join("");
}

export function renderWorkNarrow(data: ProfileData): string {
  const introLines = wrapText(data.identity.intro, 66);
  const intro = multilineText(introLines, narrow.margin, 254, 20, bodyStyle);
  const top = 300 + (introLines.length - 1) * 20;
  const rowHeight = 84;
  const rows = data.workstreams.map((stream, index) => {
    const rowTop = top + index * rowHeight;
    const baseline = rowTop + 27;
    const details = wrapText(stream.detail, 57);
    return [
      text(stream.index, narrow.margin, baseline, {
        "font-size": 18,
        "font-weight": 500,
        fill: accentColor(stream.accent)
      }),
      line(93, rowTop + 10, 93, rowTop + 65, { stroke: colors.muted }),
      text(stream.label, 118, baseline, {
        "font-size": 15,
        "font-weight": 600,
        "letter-spacing": 0.25,
        fill: colors.ink
      }),
      multilineText(details, 118, rowTop + 53, 17, {
        "font-size": 12.8,
        "font-weight": 400,
        fill: colors.muted
      }),
      line(narrow.margin, rowTop + rowHeight, narrow.right, rowTop + rowHeight, { stroke: colors.rule })
    ].join("");
  }).join("");

  return [sectionHeading("WHAT I WORK ON", narrow.margin, 220), intro, rows].join("");
}

export function renderOpenSourceWide(data: ProfileData, coordinates: LayoutCoordinates): string {
  const rowsTop = coordinates.openRowsTop;
  const rowHeight = coordinates.openRowHeight;
  const rows = data.upstreamExamples.map((item, index) => {
    const rowTop = rowsTop + index * rowHeight;
    const baseline = rowTop + 25;
    const repository = linkedSvgContent(item.repositoryUrl, `Open ${item.repository}`, [
      repoGlyph(77, rowTop + 21, item.accent, index),
      text(item.repository, 117, baseline, {
        "font-size": 14.5,
        "font-weight": 500,
        "letter-spacing": 0.8,
        fill: colors.blue,
        "text-decoration": "underline"
      })
    ].join(""));
    const pullRequest = linkedSvgContent(item.prUrl, `Open ${item.repository} ${item.pr}`, text(item.pr, 536, baseline, {
      "font-size": 14,
      "font-weight": 400,
      fill: colors.muted
    }));
    return [
      repository,
      pullRequest,
      line(wide.margin, rowTop + rowHeight, wide.right, rowTop + rowHeight, { stroke: colors.rule })
    ].join("");
  }).join("");

  return [
    sectionHeading("OPEN-SOURCE RECORD", wide.margin, coordinates.openTitleY, {
      ...headingStyle,
      "textLength": 252,
      "lengthAdjust": "spacingAndGlyphs"
    }),
    text(`${data.stats.mergedPrs} merged PRs \u00b7 ${data.stats.publicRepositories} public repositories`, wide.margin, 570, {
      "font-size": 14.5,
      "font-weight": 400,
      "letter-spacing": 0.35,
      fill: colors.muted
    }),
    circle(393, 566, 3.5, { fill: colors.cyan }),
    text(`As of ${data.stats.asOf}`, 414, 570, {
      "font-size": 14.5,
      "letter-spacing": 0.35,
      fill: colors.muted
    }),
    text(`${data.stats.mergedThisYear} merged in ${data.stats.year}`, wide.margin, 608, {
      "font-size": 14.5,
      "letter-spacing": 0.2,
      fill: colors.muted
    }),
    line(389, 592, 389, 615, { stroke: colors.rule }),
    text(`${data.stats.repositoriesOver1kStars} in repositories with 1k+ stars`, 413, 608, {
      "font-size": 14,
      fill: colors.muted
    }),
    line(wide.margin, 634, wide.right, 634, { stroke: colors.rule }),
    rows
  ].join("");
}

export function renderOpenSourceNarrow(data: ProfileData, coordinates: LayoutCoordinates): string {
  const rowsTop = coordinates.openRowsTop;
  const rowHeight = coordinates.openRowHeight;
  const rows = data.upstreamExamples.map((item, index) => {
    const rowTop = rowsTop + index * rowHeight;
    const baseline = rowTop + 25;
    const repository = linkedSvgContent(item.repositoryUrl, `Open ${item.repository}`, [
      repoGlyph(54, rowTop + 21, item.accent, index),
      text(fitText(item.repository, 37), 82, baseline, {
        "font-size": 13.2,
        "font-weight": 500,
        fill: colors.blue,
        "text-decoration": "underline"
      })
    ].join(""));
    const pullRequest = linkedSvgContent(item.prUrl, `Open ${item.repository} ${item.pr}`, text(item.pr, narrow.right, baseline, {
      "font-size": 13,
      "font-weight": 400,
      fill: colors.muted,
      "text-anchor": "end"
    }));
    return [
      repository,
      pullRequest,
      line(narrow.margin, rowTop + rowHeight, narrow.right, rowTop + rowHeight, { stroke: colors.rule })
    ].join("");
  }).join("");

  return [
    sectionHeading("OPEN-SOURCE RECORD", narrow.margin, coordinates.openTitleY),
    text(`${data.stats.mergedPrs} merged PRs \u00b7 ${data.stats.publicRepositories} public repositories`, narrow.margin, 645, {
      "font-size": 13.5,
      fill: colors.muted
    }),
    text(`${data.stats.mergedThisYear} merged in ${data.stats.year} \u00b7 ${data.stats.repositoriesOver1kStars} in repositories with 1k+ stars`, narrow.margin, 672, {
      "font-size": 13.5,
      fill: colors.muted
    }),
    text(`As of ${data.stats.asOf}`, narrow.margin, 699, { "font-size": 13.5, fill: colors.muted }),
    line(narrow.margin, 715, narrow.right, 715, { stroke: colors.rule }),
    rows
  ].join("");
}

export function renderProjectsWide(data: ProfileData, coordinates: LayoutCoordinates): string {
  const top = coordinates.projectsRowsTop;
  return [
    sectionHeading("PERSONAL PROJECTS", 66, coordinates.projectsTitleY, {
      ...headingStyle,
      "textLength": 227,
      "lengthAdjust": "spacingAndGlyphs"
    }),
    data.personalProjects.map((item, index) => projectRowWide(
      item,
      index,
      top + index * coordinates.projectRowHeight,
      index < data.personalProjects.length - 1
    )).join("")
  ].join("");
}

export function renderProjectsNarrow(data: ProfileData, coordinates: LayoutCoordinates): string {
  const top = coordinates.projectsRowsTop;
  return [
    sectionHeading("PERSONAL PROJECTS", narrow.margin, coordinates.projectsTitleY),
    data.personalProjects.map((item, index) => projectRowNarrow(item, index, top + index * coordinates.projectRowHeight)).join("")
  ].join("");
}

function renderLanguageBar(x: number, y: number, width: number, height: number, clipId: string, data: ProfileData): string {
  let cursor = x;
  const total = data.languages.reduce((sum, language) => sum + language.percentage, 0) || 100;
  const segments = data.languages.map((language, index) => {
    const segmentWidth = width * language.percentage / total;
    const segment = rect(cursor, y, segmentWidth + (index === data.languages.length - 1 ? 0 : 0.4), height, {
      fill: accentColor(language.accent)
    });
    cursor += segmentWidth;
    return segment;
  }).join("");

  return group([
    rect(x, y, width, height, { fill: colors.rule, rx: height / 2, ry: height / 2 }),
    element("g", { "clip-path": `url(#${clipId})` }, segments)
  ].join(""));
}

function renderLanguageRows(data: ProfileData, x: number, y: number, width: number, rowHeight: number): string {
  return data.languages.map((language, index) => {
    const rowTop = y + index * rowHeight;
    const baseline = rowTop + 26;
    return [
      circle(x + 5, rowTop + 20, 5.5, { fill: accentColor(language.accent) }),
      text(language.name, x + 24, baseline, { "font-size": 13.5, fill: colors.muted }),
      text(`${language.percentage.toFixed(2)}%`, x + width, baseline, {
        "font-size": 13.5,
        fill: colors.muted,
        "text-anchor": "end"
      }),
      index < data.languages.length - 1
        ? line(x, rowTop + rowHeight - 2, x + width, rowTop + rowHeight - 2, { stroke: colors.rule })
        : ""
    ].join("");
  }).join("");
}

function contributionSubtitle(data: ProfileData): string {
  if (data.stats.contributionsLastYear === undefined) return "Contribution intensity by workstream over time";
  return `${data.stats.contributionsLastYear.toLocaleString("en-US")} contributions in the last year · monthly activity`;
}

interface RidgePoint {
  x: number;
  y: number;
}

function ridgeLine(points: RidgePoint[]): string {
  return points.map((point, index) =>
    `${index === 0 ? "M" : "L"}${svgNumber(point.x)} ${svgNumber(point.y)}`
  ).join(" ");
}

function ridgeArea(points: RidgePoint[], baseline: number): string {
  const first = points[0];
  const last = points[points.length - 1];
  return [
    ridgeLine(points),
    `L${svgNumber(last.x)} ${svgNumber(baseline)}`,
    `L${svgNumber(first.x)} ${svgNumber(baseline)}`,
    "Z"
  ].join(" ");
}

function offsetRidge(points: RidgePoint[], offset: number): RidgePoint[] {
  return points.map((point) => ({ x: point.x, y: point.y + offset }));
}

function ridgeLegendMark(cx: number, baseline: number, height: number, opacity: number): string {
  const halfWidth = 7;
  const chevron = (y: number, ridgeHeight: number): string =>
    `M${svgNumber(cx - halfWidth)} ${svgNumber(y)} L${svgNumber(cx)} ${svgNumber(y - ridgeHeight)} L${svgNumber(cx + halfWidth)} ${svgNumber(y)}`;

  return group([
    path(chevron(baseline + 2, Math.max(1, height - 1.5)), {
      fill: "none",
      stroke: colors.blue,
      "stroke-width": 1.05,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      opacity: opacity * 0.42
    }),
    path(chevron(baseline, height), {
      fill: "none",
      stroke: colors.blue,
      "stroke-width": 1.2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      opacity
    })
  ].join(""));
}

function renderContributionField(
  data: ProfileData,
  x: number,
  top: number,
  chartRight: number,
  narrowMode: boolean,
  motion: boolean
): string {
  const labelWidth = narrowMode ? 116 : 89;
  const chartLeft = x + labelWidth;
  const chartWidth = chartRight - chartLeft;
  const step = chartWidth / Math.max(1, data.contribution.months.length - 1);
  const monthBaseline = top + (narrowMode ? 37 : 36);
  const firstRow = top + (narrowMode ? 84 : 85);
  const rowGap = narrowMode ? 60 : 77.5;
  const gridBottom = firstRow + (data.contribution.streams.length - 1) * rowGap + 12;

  const grid = [
    ...data.contribution.months.map((month, index) => {
      const cx = chartLeft + index * step;
      return [
        line(cx, monthBaseline + 12, cx, gridBottom, {
          stroke: colors.rule,
          "stroke-dasharray": "1 3",
          opacity: 0.75
        }),
        text(month, cx, monthBaseline, {
          "font-size": 10.5,
          "font-weight": 500,
          fill: colors.muted,
          "text-anchor": "middle"
        })
      ].join("");
    }),
    ...data.contribution.streams.map((stream, streamIndex) => {
      const y = firstRow + streamIndex * rowGap;
      const labels = stream.label;
      const labelY = y - (labels.length - 1) * 7;
      const amplitude = narrowMode ? 19 : 30;
      const minimumHeight = narrowMode ? 3 : 4;
      const points = stream.values.map((value, index): RidgePoint => {
        const intensity = Math.min(68, Math.max(0, value)) / 68;
        return {
          x: chartLeft + index * step,
          y: y - (minimumHeight + intensity * (amplitude - minimumHeight))
        };
      });
      const depthOffset = narrowMode ? 2.8 : 4.2;
      const contourOffset = narrowMode ? 1.4 : 2.1;
      const depthPoints = offsetRidge(points, depthOffset);
      const contourPoints = offsetRidge(points, contourOffset);
      const rowClass = motion ? `motion-ridge-row-${streamIndex}` : undefined;
      const accent = accentColor(stream.accent);

      const depthLayer = group([
        path(ridgeArea(depthPoints, y + depthOffset), {
          fill: accent,
          opacity: narrowMode ? 0.07 : 0.08
        }),
        path(ridgeLine(depthPoints), {
          fill: "none",
          stroke: accent,
          "stroke-width": narrowMode ? 0.8 : 0.95,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          opacity: 0.3
        }),
        path(ridgeLine(contourPoints), {
          fill: "none",
          stroke: accent,
          "stroke-width": narrowMode ? 0.65 : 0.8,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          opacity: 0.2
        })
      ].join(""), {
        class: motion ? `motion-ridge-depth ${rowClass ?? ""}`.trim() : undefined
      });

      const topLayer = group([
        path(ridgeArea(points, y), {
          fill: accent,
          opacity: narrowMode ? 0.17 : 0.18
        }),
        path(ridgeLine(points), {
          fill: "none",
          stroke: accent,
          "stroke-width": narrowMode ? 1 : 1.15,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          opacity: 0.94
        }),
        path(ridgeLine(offsetRidge(points, narrowMode ? 0.9 : 1.15)), {
          fill: "none",
          stroke: colors.paper,
          "stroke-width": narrowMode ? 0.6 : 0.7,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          opacity: motion ? 0.2 : 0,
          class: motion ? `motion-ridge-tint ${rowClass ?? ""}`.trim() : undefined
        })
      ].join(""), {
        class: motion ? `motion-ridge-top ${rowClass ?? ""}`.trim() : undefined
      });

      return [
        multilineText(labels, x, labelY, 14, {
          "font-size": narrowMode ? 10.5 : 10.5,
          "font-weight": 500,
          fill: colors.ink
        }),
        line(x, y, chartRight, y, { stroke: colors.rule, opacity: narrowMode ? undefined : 0.32 }),
        depthLayer,
        topLayer
      ].join("");
    })
  ].join("");

  const legendY = gridBottom + (narrowMode ? 43 : 61);
  const legendLabelX = narrowMode ? chartLeft : chartLeft - 18;
  const legendMarkStart = chartLeft + 37;
  const legendStep = narrowMode ? 28 : 27.5;
  const legendHeights = narrowMode ? [3, 4.5, 6, 7.5, 9, 10.5] : [2.5, 4, 5.5, 7, 8.5, 10, 11.5];
  const legendOpacities = narrowMode ? [0.28, 0.4, 0.52, 0.65, 0.82, 1] : [0.24, 0.34, 0.46, 0.58, 0.7, 0.84, 1];
  const legendMarks = legendHeights.map((height, index) =>
    ridgeLegendMark(legendMarkStart + index * legendStep, legendY - 1, height, legendOpacities[index])
  ).join("");
  const higherX = narrowMode ? chartLeft + 214 : chartLeft + 232;

  return [
    grid,
    text("Lower", legendLabelX, legendY, { "font-size": 10.5, fill: colors.muted }),
    legendMarks,
    text("Higher", higherX, legendY, { "font-size": 10.5, fill: colors.muted })
  ].join("");
}

export function renderMetricsWide(data: ProfileData, motion: boolean, coordinates: LayoutCoordinates): string {
  const leftX = 65;
  const leftWidth = 339;
  const rightX = 460;
  return [
    sectionHeading("JSTAR PROFILE METRICS", wide.margin, coordinates.metricsTitleY - 1, {
      ...headingStyle,
      "font-size": 18,
      "letter-spacing": 1.6,
      "textLength": 236,
      "lengthAdjust": "spacingAndGlyphs"
    }),
    line(425, coordinates.metricsTop, 425, coordinates.metricsDividerBottom, { stroke: colors.rule }),
    text("LANGUAGE COMPOSITION", leftX, coordinates.languageTitleY, wideEyebrowStyle),
    renderLanguageBar(leftX, coordinates.languageBarY, leftWidth, coordinates.languageBarHeight, "language-clip-wide", data),
    renderLanguageRows(data, leftX, coordinates.languageRowsY, leftWidth, coordinates.languageRowHeight),
    text("Based on lines of code across active owned repositories", leftX, coordinates.languageNoteY - 2, {
      "font-size": 10.5,
      "letter-spacing": 0.75,
      fill: colors.muted
    }),
    text("CONTRIBUTION FIELD", rightX, coordinates.contributionTitleY, wideEyebrowStyle),
    text(contributionSubtitle(data), rightX, coordinates.contributionSubtitleY, {
      "font-size": 11.5,
      "letter-spacing": 0.35,
      fill: colors.muted
    }),
    renderContributionField(data, 442, coordinates.contributionTop, 853, false, motion)
  ].join("");
}

export function renderMetricsNarrow(data: ProfileData, motion: boolean, coordinates: LayoutCoordinates): string {
  return [
    sectionHeading("JSTAR PROFILE METRICS", narrow.margin, coordinates.metricsTitleY),
    text("LANGUAGE COMPOSITION", narrow.margin, coordinates.languageTitleY, eyebrowStyle),
    renderLanguageBar(narrow.margin, coordinates.languageBarY, 596, coordinates.languageBarHeight, "language-clip-narrow", data),
    renderLanguageRows(data, narrow.margin, coordinates.languageRowsY, 596, coordinates.languageRowHeight),
    text("Based on lines of code across active owned repositories", narrow.margin, coordinates.languageNoteY, {
      "font-size": 10.5,
      fill: colors.muted
    }),
    text("CONTRIBUTION FIELD", narrow.margin, coordinates.contributionTitleY, eyebrowStyle),
    text(contributionSubtitle(data), narrow.margin, coordinates.contributionSubtitleY, {
      "font-size": 11.5,
      fill: colors.muted
    }),
    renderContributionField(data, narrow.margin, coordinates.contributionTop, narrow.right, true, motion)
  ].join("");
}

export function renderFooter(coordinates: LayoutCoordinates): string {
  const x = coordinates.margin;
  return [
    line(x, coordinates.footerY, coordinates.right, coordinates.footerY, { stroke: colors.rule }),
    avatar(x, coordinates.footerY + 20, 28),
    text("JSTAR PROFILE METRICS / GENERATED SNAPSHOT", x + 40, coordinates.footerY + 39, {
      "font-size": 11,
      "font-weight": 500,
      "letter-spacing": 1.25,
      fill: colors.muted
    })
  ].join("");
}

export function renderWideContent(data: ProfileData, motion: boolean, coordinates: LayoutCoordinates): string {
  return [
    renderHeaderWide(data, motion),
    renderWorkWide(data),
    renderOpenSourceWide(data, coordinates),
    renderProjectsWide(data, coordinates),
    renderMetricsWide(data, motion, coordinates),
    renderFooter(coordinates)
  ].join("");
}

export function renderNarrowContent(data: ProfileData, motion: boolean, coordinates: LayoutCoordinates): string {
  return [
    renderHeaderNarrow(data, motion),
    renderWorkNarrow(data),
    renderOpenSourceNarrow(data, coordinates),
    renderProjectsNarrow(data, coordinates),
    renderMetricsNarrow(data, motion, coordinates),
    renderFooter(coordinates)
  ].join("");
}

export function renderGithubChrome(height: number): string {
  const pencil = "M895 39 L908 26 L914 32 L901 45 L895 46 Z M903 28 L909 34";
  const githubMark = "M31 23 C24 23 19 28 19 35 C19 40 22 44 26 45 C27 45 27 44 27 43 L27 40 C23 41 22 38 22 38 C21 36 20 36 20 36 C19 35 20 35 20 35 C22 35 23 37 23 37 C24 39 26 39 27 38 C27 37 28 36 28 36 C25 36 22 35 22 31 C22 30 23 29 24 28 C24 27 24 26 24 25 C24 25 26 25 28 27 C30 26 33 26 35 27 C37 25 39 25 39 25 C40 26 40 27 40 28 C41 29 42 30 42 31 C42 35 39 36 36 36 C37 37 37 39 37 40 L37 44 C37 45 38 45 39 45 C43 43 46 40 46 35 C46 28 41 23 31 23 Z";
  return [
    rect(3, 3, 935, height - 6, { rx: 9, ry: 9, fill: colors.paper, stroke: colors.rule, "stroke-width": 1 }),
    path(githubMark, { fill: colors.ink }),
    text("README.md", 72, 43, { "font-size": 14, "font-weight": 500, fill: colors.ink }),
    path(pencil, { fill: "none", stroke: colors.muted, "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round" })
  ].join("");
}
