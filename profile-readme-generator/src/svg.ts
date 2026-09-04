import { colors, embeddedFontCss, fonts, type ThemeColor } from "./theme.ts";

export type AttrValue = string | number | undefined | null;

export function escapeXml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function attributes(values: Record<string, AttrValue>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
}

export function element(name: string, attrs: Record<string, AttrValue> = {}, content = ""): string {
  return `<${name}${attributes(attrs)}>${content}</${name}>`;
}

export function anchor(
  href: string,
  content: string,
  options: Record<string, AttrValue> = {}
): string {
  return element("a", {
    href,
    "xlink:href": href,
    ...options
  }, content);
}

export function selfClosing(name: string, attrs: Record<string, AttrValue> = {}): string {
  return `<${name}${attributes(attrs)}/>`;
}

export function group(content: string, attrs: Record<string, AttrValue> = {}): string {
  return element("g", attrs, content);
}

export function text(
  value: string,
  x: number,
  y: number,
  options: Record<string, AttrValue> = {}
): string {
  return element("text", {
    x,
    y,
    fill: options.fill ?? colors.ink,
    "font-family": options["font-family"] ?? fonts.sans,
    "font-size": options["font-size"] ?? 14,
    "font-weight": options["font-weight"] ?? 400,
    "letter-spacing": options["letter-spacing"],
    "textLength": options["textLength"],
    "lengthAdjust": options["lengthAdjust"],
    "text-anchor": options["text-anchor"],
    "dominant-baseline": options["dominant-baseline"] ?? "alphabetic",
    "text-decoration": options["text-decoration"],
    opacity: options.opacity,
    class: options.class
  }, escapeXml(value));
}

export function multilineText(
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  options: Record<string, AttrValue> = {}
): string {
  const tspans = lines.map((line, index) => element("tspan", {
    x,
    dy: index === 0 ? 0 : lineHeight
  }, escapeXml(line))).join("");

  return element("text", {
    x,
    y,
    fill: options.fill ?? colors.ink,
    "font-family": options["font-family"] ?? fonts.sans,
    "font-size": options["font-size"] ?? 14,
    "font-weight": options["font-weight"] ?? 400,
    "letter-spacing": options["letter-spacing"],
    "text-anchor": options["text-anchor"],
    "dominant-baseline": options["dominant-baseline"] ?? "alphabetic",
    opacity: options.opacity,
    class: options.class
  }, tspans);
}

export function line(x1: number, y1: number, x2: number, y2: number, options: Record<string, AttrValue> = {}): string {
  return selfClosing("line", {
    x1,
    y1,
    x2,
    y2,
    stroke: options.stroke ?? colors.rule,
    "stroke-width": options["stroke-width"] ?? 1,
    "stroke-linecap": options["stroke-linecap"] ?? "round",
    "stroke-dasharray": options["stroke-dasharray"],
    opacity: options.opacity,
    class: options.class
  });
}

export function rect(x: number, y: number, width: number, height: number, options: Record<string, AttrValue> = {}): string {
  return selfClosing("rect", {
    x,
    y,
    width,
    height,
    rx: options.rx,
    ry: options.ry,
    fill: options.fill,
    stroke: options.stroke,
    "stroke-width": options["stroke-width"],
    opacity: options.opacity,
    class: options.class
  });
}

export function circle(cx: number, cy: number, radius: number, options: Record<string, AttrValue> = {}): string {
  return selfClosing("circle", {
    cx,
    cy,
    r: radius,
    fill: options.fill,
    stroke: options.stroke,
    "stroke-width": options["stroke-width"],
    opacity: options.opacity,
    class: options.class
  });
}

export function path(d: string, options: Record<string, AttrValue> = {}): string {
  return selfClosing("path", {
    d,
    fill: options.fill,
    stroke: options.stroke,
    "stroke-width": options["stroke-width"],
    "stroke-linecap": options["stroke-linecap"],
    "stroke-linejoin": options["stroke-linejoin"],
    "clip-path": options["clip-path"],
    opacity: options.opacity,
    class: options.class,
    transform: options.transform
  });
}

export function color(accent: ThemeColor): string {
  return colors[accent];
}

export function wrapText(value: string, maxChars: number): string[] {
  if (value.length <= maxChars) return [value];

  const words = value.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

export function fitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function documentStyles(motion: boolean): string {
  const animation = motion ? `
    .motion-wave-fallback { display: none; }
    .motion-wave-live { display: inline; }
    @keyframes jstarRidgeTopSettle {
      0% { opacity: .72; transform: translateY(-1.25px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes jstarRidgeDepthSettle {
      0% { opacity: .58; transform: translateY(-1.75px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes jstarRidgeTintSettle {
      0% { opacity: .2; transform: translateY(-1.25px); }
      100% { opacity: 0; transform: translateY(0); }
    }
    .motion-ridge-top,
    .motion-ridge-depth,
    .motion-ridge-tint {
      transform-box: fill-box;
      transform-origin: center;
    }
    .motion-ridge-top {
      animation: jstarRidgeTopSettle .78s cubic-bezier(.22, .61, .36, 1) both;
    }
    .motion-ridge-depth {
      animation: jstarRidgeDepthSettle .9s cubic-bezier(.22, .61, .36, 1) both;
    }
    .motion-ridge-tint {
      animation: jstarRidgeTintSettle .78s cubic-bezier(.22, .61, .36, 1) both;
    }
    .motion-ridge-row-1 { animation-delay: .08s; }
    .motion-ridge-row-2 { animation-delay: .16s; }
    @media (prefers-reduced-motion: reduce) {
      .motion-wave-live { display: none !important; }
      .motion-wave-fallback { display: inline !important; }
      .motion-ridge-top,
      .motion-ridge-depth,
      .motion-ridge-tint {
        animation: none !important;
        transform: none !important;
      }
      .motion-ridge-tint { opacity: 0 !important; }
    }
  ` : "";

  return [
    embeddedFontCss(),
    "svg { shape-rendering: geometricPrecision; text-rendering: geometricPrecision; }",
    "text { font-kerning: normal; }",
    animation.trim()
  ].filter(Boolean).join("\n");
}

export function svgDocument(options: {
  width: number;
  height: number;
  viewBox?: { x: number; y: number; width: number; height: number };
  body: string;
  title: string;
  description: string;
  motion: boolean;
}): string {
  const viewBox = options.viewBox ?? { x: 0, y: 0, width: options.width, height: options.height };
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${options.width}" height="${options.height}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}" role="img" aria-labelledby="svg-title svg-description">`,
    element("title", { id: "svg-title" }, options.title),
    element("desc", { id: "svg-description" }, options.description),
    element("style", {}, documentStyles(options.motion)),
    options.body,
    `</svg>`
  ].join("\n");
}
