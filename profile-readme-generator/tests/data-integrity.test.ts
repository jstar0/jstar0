import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_DATA_PATH, PROJECT_ROOT, loadProfileData } from "../src/model.ts";
import type { GithubSnapshot } from "../src/github-sync.ts";

const data = loadProfileData(DEFAULT_DATA_PATH);
const snapshotPath = path.join(PROJECT_ROOT, "data", "github.snapshot.json");
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as GithubSnapshot;

assert.equal(data.dataSource?.provider, "github");
assert.equal(data.dataSource?.username, snapshot.username);
assert.equal(data.dataSource?.fetchedAt, snapshot.fetchedAt);
assert.deepEqual(data.stats, snapshot.stats, "profile stats drifted from the checked-in GitHub snapshot");
assert.deepEqual(data.languages, snapshot.languages, "profile languages drifted from the checked-in GitHub snapshot");
assert.deepEqual(data.contribution, snapshot.contribution, "profile contribution summary drifted from the checked-in GitHub snapshot");
assert.equal(snapshot.contributionCalendar.total, data.stats.contributionsLastYear);
assert.ok(snapshot.sources.profile.startsWith("https://api.github.com/users/"));
assert.ok(snapshot.sources.repositories.startsWith("https://api.github.com/users/"));
assert.ok(snapshot.sources.mergedPullRequests.startsWith("https://api.github.com/search/issues"));
assert.ok(new URL(snapshot.sources.mergedPullRequests).searchParams.get("q")?.split(/\s+/).includes("is:public"));
assert.ok(snapshot.sources.contributions.startsWith("https://github.com/users/"));
assert.ok(data.personalProjects.length > 0);
assert.ok(data.personalProjects.every((project) => project.placeholder || project.url?.startsWith("https://github.com/")));

const verifiedPrs = new Set(snapshot.verifiedUpstreamExamples.map((item) => item.prUrl));
assert.ok(data.upstreamExamples.every((item) => item.prUrl && verifiedPrs.has(item.prUrl)));

const expectedSearchKeys = ["closed_at", "html_url", "number", "repository_url", "title"];
for (const item of snapshot.mergedPullRequests.sample) {
  assert.deepEqual(Object.keys(item).sort(), expectedSearchKeys, "snapshot copied fields outside the public data contract");
  assert.ok(item.html_url.startsWith("https://github.com/"));
  assert.ok(item.repository_url.startsWith("https://api.github.com/"));
}

console.log("GitHub snapshot integrity tests passed");
