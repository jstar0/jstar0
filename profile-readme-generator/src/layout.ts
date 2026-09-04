import type { ProfileData } from "./model.ts";
import { layout as canvas } from "./theme.ts";

export interface LayoutCoordinates {
  mode: "wide" | "narrow";
  width: number;
  height: number;
  margin: number;
  right: number;
  openTitleY: number;
  openRowsTop: number;
  openRowHeight: number;
  projectsTitleY: number;
  projectsRowsTop: number;
  projectRowHeight: number;
  metricsTitleY: number;
  metricsTop: number;
  metricsDividerBottom: number;
  languageTitleY: number;
  languageBarY: number;
  languageBarHeight: number;
  languageRowsY: number;
  languageRowHeight: number;
  languageNoteY: number;
  contributionTitleY: number;
  contributionSubtitleY: number;
  contributionTop: number;
  footerY: number;
}

function wideCoordinates(data: ProfileData): LayoutCoordinates {
  const openRowsBottom = 639 + data.upstreamExamples.length * 42;
  const projectsTitleY = openRowsBottom + 61;
  const projectsRowsTop = projectsTitleY + 9;
  const projectsBottom = projectsRowsTop + data.personalProjects.length * 44;
  const metricsTitleY = projectsBottom + 46;
  const metricsTop = metricsTitleY + 26;
  const footerY = metricsTitleY + 398;

  return {
    mode: "wide",
    width: canvas.wide.width,
    height: Math.max(canvas.wide.height, footerY + 65),
    margin: canvas.wide.margin,
    right: canvas.wide.right,
    openTitleY: 538,
    openRowsTop: 639,
    openRowHeight: 42,
    projectsTitleY,
    projectsRowsTop,
    projectRowHeight: 44,
    metricsTitleY,
    metricsTop,
    metricsDividerBottom: metricsTitleY + 320,
    languageTitleY: metricsTitleY + 41,
    languageBarY: metricsTitleY + 72,
    languageBarHeight: 16,
    languageRowsY: metricsTitleY + 107,
    languageRowHeight: 44,
    languageNoteY: metricsTitleY + 311,
    contributionTitleY: metricsTitleY + 27,
    contributionSubtitleY: metricsTitleY + 51,
    contributionTop: metricsTitleY + 51,
    footerY
  };
}

function narrowCoordinates(data: ProfileData): LayoutCoordinates {
  const openRowsBottom = 731 + data.upstreamExamples.length * 56;
  const projectsTitleY = openRowsBottom + 51;
  const projectsRowsTop = projectsTitleY + 21;
  const projectsBottom = projectsRowsTop + data.personalProjects.length * 52;
  const metricsTitleY = projectsBottom + 54;
  const footerY = metricsTitleY + 695;

  return {
    mode: "narrow",
    width: canvas.narrow.width,
    height: Math.max(canvas.narrow.height, footerY + 100),
    margin: canvas.narrow.margin,
    right: canvas.narrow.right,
    openTitleY: 610,
    openRowsTop: 731,
    openRowHeight: 56,
    projectsTitleY,
    projectsRowsTop,
    projectRowHeight: 52,
    metricsTitleY,
    metricsTop: metricsTitleY,
    metricsDividerBottom: metricsTitleY + 460,
    languageTitleY: metricsTitleY + 35,
    languageBarY: metricsTitleY + 61,
    languageBarHeight: 18,
    languageRowsY: metricsTitleY + 88,
    languageRowHeight: 38,
    languageNoteY: metricsTitleY + 260,
    contributionTitleY: metricsTitleY + 340,
    contributionSubtitleY: metricsTitleY + 365,
    contributionTop: metricsTitleY + 375,
    footerY
  };
}

export function computeLayouts(data: ProfileData): { wide: LayoutCoordinates; narrow: LayoutCoordinates } {
  return {
    wide: wideCoordinates(data),
    narrow: narrowCoordinates(data)
  };
}
