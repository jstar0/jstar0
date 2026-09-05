import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./model.ts";

export type ThemeMode = "light" | "dark";

const lightColors = {
  paper: "#ffffff",
  background: "#ffffff",
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

const darkColors = {
  paper: "#0d1117",
  background: "#0d1117",
  ink: "#f0f6fc",
  muted: "#8b949e",
  faint: "#6e7681",
  rule: "#30363d",
  blue: "#58a6ff",
  cyan: "#39c5cf",
  mint: "#56d364",
  yellow: "#f2cc60",
  orange: "#f0883e"
} as const;

export type ThemeColor = Exclude<keyof typeof lightColors, "paper" | "background">;
type ThemeColors = { [Key in keyof typeof lightColors]: string };
export const themes: Record<ThemeMode, ThemeColors> = { light: lightColors, dark: darkColors };
export let colors: ThemeColors = lightColors;

export function setTheme(mode: ThemeMode): void {
  colors = themes[mode];
}

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

function subsetFontFile(filename: string, directory = path.join(PROJECT_ROOT, "assets", "fonts")): string | undefined {
  const filePath = path.join(directory, filename);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return filePath;
}

function fontFace(family: string, filePath: string | undefined, weight: number): string {
  if (!filePath) return "";
  const encoded = fs.readFileSync(filePath).toString("base64");
  return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${encoded}) format('woff2');font-weight:${weight};font-style:normal;font-display:block;}`;
}

export function embeddedFontCss(subsetKey?: string): string {
  const generatedDirectory = path.join(PROJECT_ROOT, "generated", "font-subsets");
  const fragmentDirectory = subsetKey ? generatedDirectory : undefined;
  const globalDirectory = subsetKey ? generatedDirectory : path.join(PROJECT_ROOT, "assets", "fonts");
  const includeDisplay = !subsetKey || subsetKey.endsWith("-header");
  const display = includeDisplay
    ? subsetFontFile(
      subsetKey ? `${subsetKey}-display.woff2` : "jstar-display-subset.woff2",
      fragmentDirectory
    ) ?? subsetFontFile("jstar-display-subset.woff2", globalDirectory)
    : undefined;
  const sans = subsetFontFile(
    subsetKey ? `${subsetKey}-sans.woff2` : "jstar-sans-subset.woff2",
    fragmentDirectory
  ) ?? subsetFontFile("jstar-sans-subset.woff2", globalDirectory);

  return [
    fontFace("JstarDisplay", display, 500),
    // Keep one body face embedded; heavier weights can be synthesized without another network-sized payload.
    fontFace("JstarSans", sans, 400)
  ].join("");
}
