import type { ProfileData } from "./model.ts";
import { computeLayouts, type LayoutCoordinates } from "./layout.ts";
import type { ThemeMode } from "./theme.ts";

export type SplitFragmentKind =
  | "header"
  | "overview"
  | "open-repository"
  | "open-pull-request"
  | "projects-heading"
  | "project"
  | "metrics"
  | "footer";

export interface SplitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SplitFragment extends SplitRect {
  key: string;
  mode: "wide" | "narrow";
  kind: SplitFragmentKind;
  index?: number;
  href?: string;
  label: string;
}

export interface SplitLayout {
  mode: "wide" | "narrow";
  width: number;
  height: number;
  coordinates: LayoutCoordinates;
  fragments: SplitFragment[];
}

function keyPart(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function fragmentFileStem(fragment: Pick<SplitFragment, "mode" | "key">, theme: ThemeMode = "light"): string {
  return `profile-${fragment.mode}${theme === "dark" ? "-dark" : ""}-split-${fragment.key}`;
}

export function splitAssetFilename(
  fragment: Pick<SplitFragment, "mode" | "key">,
  variant: "motion" | "static",
  extension: "svg" | "png",
  theme: ThemeMode = "light"
): string {
  const suffix = variant === "static" ? "-static" : "";
  return `${fragmentFileStem(fragment, theme)}${suffix}.${extension}`;
}

export function splitFragmentHasMotion(fragment: Pick<SplitFragment, "kind">): boolean {
  return fragment.kind === "header" || fragment.kind === "metrics";
}

function addFullWidthFragment(
  fragments: SplitFragment[],
  coordinates: LayoutCoordinates,
  key: string,
  kind: SplitFragmentKind,
  y: number,
  height: number,
  label: string,
  href?: string,
  index?: number
): void {
  if (height <= 0) return;
  fragments.push({
    key,
    mode: coordinates.mode,
    kind,
    index,
    href,
    label,
    x: 0,
    y,
    width: coordinates.width,
    height
  });
}

function buildSplitLayout(data: ProfileData, mode: "wide" | "narrow"): SplitLayout {
  const coordinates = computeLayouts(data)[mode];
  const fragments: SplitFragment[] = [];
  const headerBottom = mode === "wide" ? 200 : 210;
  const openRowsBottom = coordinates.openRowsTop + data.upstreamExamples.length * coordinates.openRowHeight;
  const projectsBottom = coordinates.projectsRowsTop + data.personalProjects.length * coordinates.projectRowHeight;
  const splitX = mode === "wide" ? 470 : Math.floor(coordinates.width / 2);

  addFullWidthFragment(
    fragments,
    coordinates,
    "header",
    "header",
    0,
    headerBottom,
    "Profile identity",
    data.profileUrl
  );
  addFullWidthFragment(
    fragments,
    coordinates,
    "overview",
    "overview",
    headerBottom,
    coordinates.openRowsTop - headerBottom,
    "What I work on and open-source summary"
  );

  data.upstreamExamples.forEach((item, index) => {
    const y = coordinates.openRowsTop + index * coordinates.openRowHeight;
    const rowKey = keyPart(index);
    const leftWidth = splitX;
    const rightWidth = coordinates.width - splitX;
    fragments.push({
      key: `open-${rowKey}-repo`,
      mode,
      kind: "open-repository",
      index,
      href: item.repositoryUrl,
      label: `Repository ${item.repository}`,
      x: 0,
      y,
      width: leftWidth,
      height: coordinates.openRowHeight
    });
    fragments.push({
      key: `open-${rowKey}-pr`,
      mode,
      kind: "open-pull-request",
      index,
      href: item.prUrl,
      label: `Pull request ${item.repository} ${item.pr}`,
      x: splitX,
      y,
      width: rightWidth,
      height: coordinates.openRowHeight
    });
  });

  addFullWidthFragment(
    fragments,
    coordinates,
    "projects-heading",
    "projects-heading",
    openRowsBottom,
    coordinates.projectsRowsTop - openRowsBottom,
    "Personal projects heading"
  );

  data.personalProjects.forEach((item, index) => {
    const y = coordinates.projectsRowsTop + index * coordinates.projectRowHeight;
    addFullWidthFragment(
      fragments,
      coordinates,
      `project-${keyPart(index)}`,
      "project",
      y,
      coordinates.projectRowHeight,
      `Personal project ${item.title}`,
      item.placeholder ? undefined : item.url,
      index
    );
  });

  addFullWidthFragment(
    fragments,
    coordinates,
    "metrics",
    "metrics",
    projectsBottom,
    coordinates.footerY - projectsBottom,
    "Language and contribution metrics"
  );
  addFullWidthFragment(
    fragments,
    coordinates,
    "footer",
    "footer",
    coordinates.footerY,
    coordinates.height - coordinates.footerY,
    "Generated profile footer"
  );

  return {
    mode,
    width: coordinates.width,
    height: coordinates.height,
    coordinates,
    fragments
  };
}

export function computeSplitLayouts(data: ProfileData): { wide: SplitLayout; narrow: SplitLayout } {
  return {
    wide: buildSplitLayout(data, "wide"),
    narrow: buildSplitLayout(data, "narrow")
  };
}
