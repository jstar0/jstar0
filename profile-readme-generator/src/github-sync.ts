import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Accent, ProfileData, UpstreamExample } from "./model.ts";
import { DEFAULT_DATA_PATH, loadProfileData, PROJECT_ROOT, validateProfileData } from "./model.ts";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "jstar-profile-readme-generator";
const GITHUB_API_VERSION = "2022-11-28";
const REQUEST_TIMEOUT_MS = 30_000;
const LANGUAGE_CONCURRENCY = 8;
const REPOSITORY_CONCURRENCY = 8;
const MONTH_COUNT = 8;
const RIDGELINE_MAX = 68;

interface GithubUser {
  login: string;
  public_repos: number;
}

interface GithubRepository {
  full_name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  languages_url: string;
}

interface GithubSearchItem {
  repository_url: string;
  html_url: string;
  number: number;
  title: string;
  closed_at: string | null;
}

interface GithubSearchResponse {
  total_count: number;
  items: GithubSearchItem[];
}

interface GithubPullRequest {
  merged: boolean;
  merged_at: string | null;
  html_url: string;
}

interface ContributionDay {
  date: string;
  count: number;
  level?: number;
}

export interface ParsedContributionCalendar {
  days: ContributionDay[];
  total: number;
}

export interface ContributionSummary {
  months: string[];
  streams: ProfileData["contribution"]["streams"];
  total: number;
  days: ContributionDay[];
}

export interface GithubSnapshot {
  schemaVersion: 1;
  username: string;
  fetchedAt: string;
  sources: {
    profile: string;
    repositories: string;
    mergedPullRequests: string;
    contributions: string;
    languageScope: string;
  };
  stats: ProfileData["stats"];
  languages: ProfileData["languages"];
  contribution: ProfileData["contribution"];
  contributionCalendar: {
    total: number;
    days: ContributionDay[];
  };
  languageRepositoryCount: number;
  mergedPullRequests: {
    total: number;
    thisYear: number;
    repositoriesOver1kStars: number;
    sample: GithubSearchItem[];
  };
  verifiedUpstreamExamples: Array<UpstreamExample & { mergedAt: string | null }>;
}

interface GraphqlContributionResponse {
  user: {
    contributionsCollection: {
      contributionCalendar: {
        totalContributions: number;
        weeks: Array<{
          contributionDays: Array<{
            date: string;
            contributionCount: number;
          }>;
        }>;
      };
    };
  } | null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readAttribute(attributes: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attributes);
  return match?.[1] ?? match?.[2];
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .trim();
}

/**
 * Parse GitHub's public contribution fragment. The endpoint exposes the same
 * calendar that a signed-out visitor can see, including a tooltip per day.
 * Keeping this parser isolated makes changes to GitHub's markup easy to test.
 */
export function parseContributionCalendarHtml(html: string): ParsedContributionCalendar {
  const tooltips = new Map<string, string>();
  const tooltipPattern = /<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/gi;
  let match: RegExpExecArray | null;
  while ((match = tooltipPattern.exec(html))) {
    const target = readAttribute(match[1], "for") ?? readAttribute(match[1], "id");
    if (target) tooltips.set(target, decodeHtml(match[2]));
  }

  const days: ContributionDay[] = [];
  const cellPattern = /<td\b([^>]*)>/gi;
  while ((match = cellPattern.exec(html))) {
    const attributes = match[1];
    const date = readAttribute(attributes, "data-date");
    if (!date) continue;

    const id = readAttribute(attributes, "id");
    const tooltip = id ? tooltips.get(id) ?? "" : "";
    const countMatch = /([\d,]+)\s+contribution/i.exec(tooltip);
    if (!countMatch && !/^No contributions/i.test(tooltip)) {
      throw new Error(`Could not read the contribution count for ${date}`);
    }

    days.push({
      date,
      count: countMatch ? Number(countMatch[1].replaceAll(",", "")) : 0,
      level: Number(readAttribute(attributes, "data-level") ?? 0)
    });
  }

  if (days.length === 0) throw new Error("GitHub contribution calendar did not contain any day cells");
  const totalMatch = /([\d,]+)\s+contributions?\s+in\s+the\s+last\s+year/i.exec(decodeHtml(html));
  const total = totalMatch
    ? Number(totalMatch[1].replaceAll(",", ""))
    : days.reduce((sum, day) => sum + day.count, 0);
  return { days, total };
}

function monthLabel(date: Date): string {
  return ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][date.getUTCMonth()];
}

function normalizeSeries(values: number[]): number[] {
  const maximum = Math.max(1, ...values);
  return values.map((value) => Math.round((value / maximum) * RIDGELINE_MAX));
}

export function summarizeContributionCalendar(
  calendar: ParsedContributionCalendar,
  now = new Date()
): ContributionSummary {
  const monthStarts = Array.from({ length: MONTH_COUNT }, (_, index) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTH_COUNT + index + 1, 1))
  );
  const keys = monthStarts.map((date) => date.toISOString().slice(0, 7));
  const totals = new Map(keys.map((key) => [key, 0]));
  const activeDays = new Map(keys.map((key) => [key, 0]));
  const peakDays = new Map(keys.map((key) => [key, 0]));

  for (const day of calendar.days) {
    const key = day.date.slice(0, 7);
    if (!totals.has(key)) continue;
    totals.set(key, (totals.get(key) ?? 0) + day.count);
    if (day.count > 0) activeDays.set(key, (activeDays.get(key) ?? 0) + 1);
    peakDays.set(key, Math.max(peakDays.get(key) ?? 0, day.count));
  }

  const totalValues = keys.map((key) => totals.get(key) ?? 0);
  const activeValues = keys.map((key) => activeDays.get(key) ?? 0);
  const peakValues = keys.map((key) => peakDays.get(key) ?? 0);

  return {
    months: monthStarts.map(monthLabel),
    streams: [
      { label: ["Total", "contributions"], accent: "blue", values: normalizeSeries(totalValues) },
      { label: ["Active", "days"], accent: "cyan", values: normalizeSeries(activeValues) },
      { label: ["Peak", "day"], accent: "mint", values: normalizeSeries(peakValues) }
    ],
    total: calendar.total,
    days: calendar.days
  };
}

class GithubClient {
  private readonly headers: Record<string, string>;
  public readonly token?: string;

  constructor(token?: string) {
    this.token = token;
    this.headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  async text(url: string, headers: Record<string, string> = this.headers): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`GitHub request failed (${response.status}) ${url}: ${body.slice(0, 240)}`);
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = { ...this.headers, ...(init.headers as Record<string, string> | undefined) };
    const body = await this.text(url, headers);
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error(`GitHub returned non-JSON data for ${url}`);
    }
  }

  async graphql<T>(query: string, variables: Record<string, string>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${GITHUB_API}/graphql`, {
        method: "POST",
        headers: { ...this.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`GitHub GraphQL request failed (${response.status}): ${body.slice(0, 240)}`);
      const parsed = JSON.parse(body) as { data?: T; errors?: Array<{ message: string }> };
      if (parsed.errors?.length) throw new Error(`GitHub GraphQL error: ${parsed.errors.map((error) => error.message).join("; ")}`);
      if (!parsed.data) throw new Error("GitHub GraphQL response did not contain data");
      return parsed.data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function fetchRepositories(client: GithubClient, username: string): Promise<GithubRepository[]> {
  const repositories: GithubRepository[] = [];
  for (let page = 1; ; page += 1) {
    const current = await client.json<GithubRepository[]>(
      `${GITHUB_API}/users/${encodeURIComponent(username)}/repos?type=owner&per_page=100&page=${page}&sort=updated`
    );
    repositories.push(...current);
    if (current.length < 100) return repositories;
  }
}

async function fetchSearchItems(client: GithubClient, query: string): Promise<{ total: number; items: GithubSearchItem[] }> {
  const items: GithubSearchItem[] = [];
  let total = 0;
  for (let page = 1; page <= 10; page += 1) {
    const response = await client.json<GithubSearchResponse>(
      `${GITHUB_API}/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`
    );
    total = response.total_count;
    const normalizedItems = response.items.map(normalizeGithubSearchItem);
    items.push(...normalizedItems);
    if (normalizedItems.length < 100 || items.length >= Math.min(total, 1000)) break;
    await sleep(80);
  }
  return { total, items };
}

/**
 * Keep the checked-in snapshot limited to the fields used by the generator.
 * GitHub's search response also contains PR bodies, labels, user profiles,
 * and other caller-controlled content that should not be copied into this
 * public repository.
 */
export function normalizeGithubSearchItem(value: unknown): GithubSearchItem {
  if (value === null || typeof value !== "object") {
    throw new Error("GitHub search returned an invalid pull-request item");
  }
  const item = value as Record<string, unknown>;
  const requiredStrings = ["repository_url", "html_url", "title"];
  if (requiredStrings.some((field) => typeof item[field] !== "string" || item[field] === "")) {
    throw new Error("GitHub search returned an incomplete pull-request item");
  }
  if (!String(item.repository_url).startsWith("https://") || !String(item.html_url).startsWith("https://")) {
    throw new Error("GitHub search returned a non-HTTPS pull-request URL");
  }
  if (!Number.isInteger(item.number) || Number(item.number) <= 0) {
    throw new Error("GitHub search returned an invalid pull-request number");
  }
  if (item.closed_at !== undefined && item.closed_at !== null && typeof item.closed_at !== "string") {
    throw new Error("GitHub search returned an invalid pull-request close time");
  }
  return {
    repository_url: String(item.repository_url),
    html_url: String(item.html_url),
    number: Number(item.number),
    title: String(item.title),
    closed_at: item.closed_at === undefined ? null : item.closed_at as string | null
  };
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()));
  return results;
}

function languageAccent(name: string, index: number): Accent {
  const known: Record<string, Accent> = {
    TypeScript: "blue",
    JavaScript: "yellow",
    Go: "cyan",
    Python: "mint",
    Rust: "orange",
    Java: "orange",
    "C++": "orange",
    Swift: "cyan",
    Shell: "mint"
  };
  return known[name] ?? (["blue", "cyan", "mint", "orange"] as Accent[])[index % 4];
}

async function collectLanguages(
  client: GithubClient,
  repositories: GithubRepository[]
): Promise<{ languages: ProfileData["languages"]; repositoryCount: number }> {
  const candidates = repositories.filter((repository) => !repository.fork && !repository.archived);
  const totals = new Map<string, number>();
  await mapConcurrent(candidates, LANGUAGE_CONCURRENCY, async (repository) => {
    const values = await client.json<Record<string, number>>(repository.languages_url);
    for (const [name, bytes] of Object.entries(values)) totals.set(name, (totals.get(name) ?? 0) + bytes);
    return undefined;
  });

  const entries = [...totals.entries()].sort((left, right) => right[1] - left[1]);
  const top = entries.slice(0, 3);
  const otherBytes = entries.slice(3).reduce((sum, [, bytes]) => sum + bytes, 0);
  if (otherBytes > 0) top.push(["Other", otherBytes]);
  const totalBytes = top.reduce((sum, [, bytes]) => sum + bytes, 0);
  const rawPercentages = top.map(([, bytes]) => bytes / Math.max(1, totalBytes) * 100);
  const percentages = rawPercentages.map((value, index) =>
    index === rawPercentages.length - 1
      ? Number((100 - rawPercentages.slice(0, -1).reduce((sum, entry) => sum + Number(entry.toFixed(2)), 0)).toFixed(2))
      : Number(value.toFixed(2))
  );
  const languages = top.map(([name], index) => ({
    name,
    percentage: percentages[index],
    accent: name === "Other" ? "orange" as const : languageAccent(name, index)
  }));
  return { languages, repositoryCount: candidates.length };
}

async function fetchContributions(client: GithubClient, username: string): Promise<ContributionSummary> {
  const publicUrl = `https://github.com/users/${encodeURIComponent(username)}/contributions`;
  try {
    const html = await client.text(publicUrl, {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 jstar-profile-readme-generator"
    });
    return summarizeContributionCalendar(parseContributionCalendarHtml(html));
  } catch (error) {
    if (!client.token) {
      throw new Error(`Could not read the public contribution calendar. Set GITHUB_TOKEN for GraphQL fallback. ${error instanceof Error ? error.message : String(error)}`);
    }
    const query = `
      query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              totalContributions
              weeks { contributionDays { date contributionCount } }
            }
          }
        }
      }
    `;
    const to = new Date();
    const from = new Date(to.getTime() - 366 * 24 * 60 * 60 * 1000);
    const response = await client.graphql<GraphqlContributionResponse>(query, {
      login: username,
      from: from.toISOString(),
      to: to.toISOString()
    });
    const calendar = response.user?.contributionsCollection.contributionCalendar;
    if (!calendar) throw new Error(`GitHub did not return a contribution calendar for ${username}`);
    return summarizeContributionCalendar({
      total: calendar.totalContributions,
      days: calendar.weeks.flatMap((week) => week.contributionDays.map((day) => ({ date: day.date, count: day.contributionCount })))
    }, to);
  }
}

function formatAsOf(date: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(date.getUTCDate()).padStart(2, "0")} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function apiPullRequestUrl(prUrl: string): string {
  const parsed = new URL(prUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parsed.hostname !== "github.com" || parts.length !== 4 || parts[2] !== "pull") {
    throw new Error(`Unsupported pull request URL: ${prUrl}`);
  }
  return `${GITHUB_API}/repos/${parts[0]}/${parts[1]}/pulls/${parts[3]}`;
}

async function verifyUpstreamExamples(client: GithubClient, examples: UpstreamExample[]): Promise<GithubSnapshot["verifiedUpstreamExamples"]> {
  return mapConcurrent(examples, 5, async (example) => {
    if (!example.prUrl) throw new Error(`Missing PR URL for ${example.repository}`);
    const pullRequest = await client.json<GithubPullRequest>(apiPullRequestUrl(example.prUrl));
    if (!pullRequest.merged) throw new Error(`Selected upstream PR is not merged: ${example.prUrl}`);
    return { ...example, mergedAt: pullRequest.merged_at };
  });
}

function getArgument(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function resolveToken(useGhAuth: boolean): { token?: string; source: "environment" | "gh" | "none" } {
  const environmentToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (environmentToken) return { token: environmentToken, source: "environment" };
  if (!useGhAuth) return { source: "none" };
  try {
    const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return token ? { token, source: "gh" } : { source: "none" };
  } catch {
    return { source: "none" };
  }
}

function usernameFromProfileUrl(profileUrl: string | undefined): string | undefined {
  if (!profileUrl) return undefined;
  const parsed = new URL(profileUrl);
  if (parsed.hostname !== "github.com") return undefined;
  return parsed.pathname.split("/").filter(Boolean)[0];
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

export async function syncGithubProfile(options: {
  username: string;
  dataPath?: string;
  snapshotPath?: string;
  token?: string;
}): Promise<GithubSnapshot> {
  const dataPath = options.dataPath ?? DEFAULT_DATA_PATH;
  const snapshotPath = options.snapshotPath ?? path.join(path.dirname(dataPath), "github.snapshot.json");
  const current = loadProfileData(dataPath);
  const client = new GithubClient(options.token);
  const fetchedAt = new Date();
  const profile = await client.json<GithubUser>(`${GITHUB_API}/users/${encodeURIComponent(options.username)}`);
  if (profile.login.toLowerCase() !== options.username.toLowerCase()) throw new Error(`GitHub returned a different user: ${profile.login}`);

  const repositories = await fetchRepositories(client, options.username);
  const languageResult = await collectLanguages(client, repositories);
  const allMerged = await fetchSearchItems(client, `author:${options.username} type:pr is:merged`);
  const year = fetchedAt.getUTCFullYear();
  const today = fetchedAt.toISOString().slice(0, 10);
  const mergedThisYear = await fetchSearchItems(client, `author:${options.username} type:pr is:merged merged:${year}-01-01..${today}`);
  const repositoryUrls = [...new Set(allMerged.items.map((item) => item.repository_url))];
  const repositoryDetails = await mapConcurrent(repositoryUrls, REPOSITORY_CONCURRENCY, async (url) => {
    try {
      return await client.json<GithubRepository>(url);
    } catch (error) {
      if (error instanceof Error && error.message.includes("(404)")) return undefined;
      throw error;
    }
  });
  const repositoriesOver1kStars = repositoryDetails.filter((repository): repository is GithubRepository =>
    Boolean(repository && repository.stargazers_count >= 1000)
  ).length;
  const contribution = await fetchContributions(client, options.username);
  const verifiedUpstreamExamples = await verifyUpstreamExamples(client, current.upstreamExamples);

  const stats: ProfileData["stats"] = {
    ...current.stats,
    mergedPrs: allMerged.total,
    publicRepositories: profile.public_repos,
    mergedThisYear: mergedThisYear.total,
    repositoriesOver1kStars,
    contributionsLastYear: contribution.total,
    year,
    asOf: formatAsOf(fetchedAt)
  };
  const profileData = JSON.parse(fs.readFileSync(dataPath, "utf8")) as Record<string, unknown>;
  const nextProfileData = {
    ...profileData,
    stats,
    languages: languageResult.languages,
    contribution: {
      months: contribution.months,
      streams: contribution.streams
    },
    dataSource: {
      provider: "github" as const,
      username: options.username,
      fetchedAt: fetchedAt.toISOString(),
      contributionSource: "public contribution calendar",
      languageScope: "active owned public repositories"
    }
  };
  validateProfileData(nextProfileData);
  writeJson(dataPath, nextProfileData);

  const snapshot: GithubSnapshot = {
    schemaVersion: 1,
    username: options.username,
    fetchedAt: fetchedAt.toISOString(),
    sources: {
      profile: `${GITHUB_API}/users/${options.username}`,
      repositories: `${GITHUB_API}/users/${options.username}/repos?type=owner&per_page=100`,
      mergedPullRequests: `${GITHUB_API}/search/issues?q=author:${options.username}+type:pr+is:merged`,
      contributions: `https://github.com/users/${options.username}/contributions`,
      languageScope: "active owned public repositories"
    },
    stats,
    languages: languageResult.languages,
    contribution: {
      months: contribution.months,
      streams: contribution.streams
    },
    contributionCalendar: { total: contribution.total, days: contribution.days },
    languageRepositoryCount: languageResult.repositoryCount,
    mergedPullRequests: {
      total: allMerged.total,
      thisYear: mergedThisYear.total,
      repositoriesOver1kStars,
      sample: allMerged.items.slice(0, 12)
    },
    verifiedUpstreamExamples
  };
  writeJson(snapshotPath, snapshot);
  return snapshot;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dataPath = path.resolve(getArgument(args, "--data") ?? DEFAULT_DATA_PATH);
  const snapshotPath = path.resolve(getArgument(args, "--snapshot") ?? path.join(path.dirname(dataPath), "github.snapshot.json"));
  const current = loadProfileData(dataPath);
  const username = getArgument(args, "--username") ?? usernameFromProfileUrl(current.profileUrl);
  if (!username) throw new Error("Pass --username <github-login> or configure a github.com profileUrl in the data file");
  const auth = resolveToken(args.includes("--use-gh-auth"));
  const snapshot = await syncGithubProfile({ username, dataPath, snapshotPath, token: auth.token });

  console.log(`Synced public GitHub data for @${snapshot.username}`);
  console.log(`Authentication: ${auth.source === "none" ? "unauthenticated" : auth.source}`);
  console.log(`Stats: ${snapshot.stats.mergedPrs} merged PRs / ${snapshot.stats.publicRepositories} public repositories / ${snapshot.stats.contributionsLastYear ?? 0} contributions in the last year`);
  console.log(`Languages: ${snapshot.languages.map((language) => `${language.name} ${language.percentage.toFixed(2)}%`).join(" / ")}`);
  console.log(`Personal projects preserved: edit ${path.relative(PROJECT_ROOT, dataPath)} -> personalProjects`);
  console.log(`Wrote ${path.relative(PROJECT_ROOT, snapshotPath)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
