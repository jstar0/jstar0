import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./model.ts";

export const colors = {
  paper: "#ffffff",
  ink: "#132238",
  muted: "#53627a",
  faint: "#8190a4",
  rule: "#d6dee8",
  blue: "#2168e8",
  cyan: "#2eacc3",
  mint: "#50a87e",
  yellow: "#f2c82f",
  orange: "#e9781e"
} as const;

export type ThemeColor = keyof typeof colors;

export const fonts = {
  display: "JstarDisplay, 'Bodoni 72', 'Bodoni Moda', Baskerville, Georgia, serif",
  sans: "JstarSans, 'Helvetica Neue', Helvetica, Arial, sans-serif"
} as const;

export const layout = {
  wide: {
    width: 941,
    height: 1604,
    margin: 65,
    right: 876
  },
  narrow: {
    width: 680,
    height: 2140,
    margin: 42,
    right: 638
  },
  githubChromeHeight: 68
} as const;

function findFontFile(packageName: string, matcher: RegExp): string | undefined {
  const directories = [
    path.join(PROJECT_ROOT, "node_modules", packageName, "files")
  ];

  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    const entry = fs.readdirSync(directory).find((name) => matcher.test(name));
    if (entry) return path.join(directory, entry);
  }

  return undefined;
}

function fontFace(family: string, filePath: string | undefined, weight: number): string {
  if (!filePath) return "";
  const encoded = fs.readFileSync(filePath).toString("base64");
  return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${encoded}) format('woff2');font-weight:${weight};font-style:normal;font-display:block;}`;
}

export function embeddedFontCss(): string {
  const display = findFontFile("@fontsource/bodoni-moda", /bodoni-moda-latin-500-normal\.woff2$/);
  const sans = findFontFile("@fontsource/ibm-plex-sans", /ibm-plex-sans-latin-400-normal\.woff2$/);

  return [
    fontFace("JstarDisplay", display, 500),
    // Keep one body face embedded; heavier weights can be synthesized without another network-sized payload.
    fontFace("JstarSans", sans, 400)
  ].join("");
}

export function embeddedAvatarHref(): string {
  const avatarPath = path.join(PROJECT_ROOT, "assets", "reference-jstar-avatar.png");
  if (!fs.existsSync(avatarPath)) return "";
  return `data:image/png;base64,${fs.readFileSync(avatarPath).toString("base64")}`;
}
