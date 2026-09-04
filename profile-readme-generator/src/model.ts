import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Accent = "blue" | "cyan" | "mint" | "yellow" | "orange";

export interface UpstreamExample {
  repository: string;
  pr: string;
  accent: Accent;
  repositoryUrl?: string;
  prUrl?: string;
}

export interface PersonalProject {
  title: string;
  description: string;
  accent?: Accent;
  url?: string;
  placeholder?: boolean;
}

export interface ProfileData {
  profileUrl?: string;
  identity: {
    name: string;
    descriptor: string[];
    intro: string;
  };
  workstreams: Array<{
    index: string;
    label: string;
    detail: string;
    accent: Accent;
  }>;
  stats: {
    mergedPrs: number;
    publicRepositories: number;
    mergedThisYear: number;
    repositoriesOver1kStars: number;
    contributionsLastYear?: number;
    year: number;
    asOf: string;
  };
  upstreamExamples: UpstreamExample[];
  personalProjects: PersonalProject[];
  languages: Array<{
    name: string;
    percentage: number;
    accent: Accent;
  }>;
  contribution: {
    months: string[];
    streams: Array<{
      label: string[];
      accent: Accent;
      values: number[];
    }>;
  };
  dataSource?: {
    provider: "github";
    username: string;
    fetchedAt: string;
    contributionSource: string;
    languageScope: string;
  };
}

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_DATA_PATH = path.join(PROJECT_ROOT, "data", "profile.json");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid profile data: ${message}`);
}

function isAccent(value: unknown): value is Accent {
  return ["blue", "cyan", "mint", "yellow", "orange"].includes(String(value));
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || /[\r\n]/.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function assertOptionalUrl(value: unknown, field: string): void {
  if (value !== undefined) assert(isHttpsUrl(value), `${field} must be an absolute HTTPS URL`);
}

export function validateProfileData(value: unknown): ProfileData {
  assert(value !== null && typeof value === "object", "profile data must be an object");
  const data = value as ProfileData;

  assert(data.identity?.name, "identity.name is required");
  assert(data.identity.descriptor?.length, "identity.descriptor must not be empty");
  assert(data.identity.intro, "identity.intro is required");
  assert(data.workstreams?.length === 3, "exactly three workstreams are required");
  assert(data.upstreamExamples?.length <= 8, "keep the selected upstream list concise");
  assert(data.languages?.length > 0, "at least one language is required");
  assert(data.contribution?.months?.length, "contribution.months is required");
  assert(Number.isInteger(data.stats?.year) && data.stats.year >= 2000, "stats.year must be a valid year");
  if (data.stats.contributionsLastYear !== undefined) {
    assert(Number.isInteger(data.stats.contributionsLastYear) && data.stats.contributionsLastYear >= 0,
      "stats.contributionsLastYear must be a non-negative integer");
  }
  assertOptionalUrl(data.profileUrl, "profileUrl");

  if (data.dataSource) {
    assert(data.dataSource.provider === "github", "dataSource.provider must be github");
    assert(data.dataSource.username && data.dataSource.fetchedAt, "dataSource identity is required");
    assert(data.dataSource.contributionSource && data.dataSource.languageScope, "dataSource scope is required");
  }

  for (const stream of data.workstreams) {
    assert(stream.index && stream.label && stream.detail, "workstream fields are required");
    assert(isAccent(stream.accent), `unknown workstream accent: ${stream.accent}`);
  }

  for (const item of data.upstreamExamples) {
    assert(item.repository && item.pr, "upstream example repository and PR are required");
    assert(isAccent(item.accent), `unknown upstream accent: ${item.accent}`);
    assertOptionalUrl(item.repositoryUrl, `upstreamExamples.${item.repository}.repositoryUrl`);
    assertOptionalUrl(item.prUrl, `upstreamExamples.${item.repository}.prUrl`);
  }

  for (const item of data.personalProjects) {
    assert(item.title && item.description, "personal project title and description are required");
    if (item.accent) assert(isAccent(item.accent), `unknown project accent: ${item.accent}`);
    assertOptionalUrl(item.url, `personalProjects.${item.title}.url`);
    if (item.placeholder) assert(item.url === undefined, "placeholder projects cannot have links");
  }

  for (const language of data.languages) {
    assert(language.name && Number.isFinite(language.percentage), "language fields are required");
    assert(language.percentage >= 0, "language percentages cannot be negative");
    assert(isAccent(language.accent), `unknown language accent: ${language.accent}`);
  }

  for (const stream of data.contribution.streams) {
    assert(stream.label?.length && stream.values?.length === data.contribution.months.length,
      "each contribution stream must have one value per month");
    assert(isAccent(stream.accent), `unknown contribution accent: ${stream.accent}`);
  }

  return data;
}

export function loadProfileData(filePath = DEFAULT_DATA_PATH): ProfileData {
  return validateProfileData(JSON.parse(fs.readFileSync(filePath, "utf8")));
}
