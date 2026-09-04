import assert from "node:assert/strict";
import {
  normalizeGithubSearchItem,
  parseContributionCalendarHtml,
  publicMergedPullRequestQuery,
  summarizeContributionCalendar
} from "../src/github-sync.ts";

const fixture = `
<div class="js-yearly-contributions">
  <h2>12 contributions in the last year</h2>
  <table>
    <tr>
      <td id="day-a" data-date="2026-02-01" data-level="0"></td>
      <tool-tip for="day-a">No contributions on February 1st.</tool-tip>
      <td id="day-b" data-date="2026-02-02" data-level="2"></td>
      <tool-tip for="day-b">4 contributions on February 2nd.</tool-tip>
      <td id="day-c" data-date="2026-09-03" data-level="4"></td>
      <tool-tip for="day-c">8 contributions on September 3rd.</tool-tip>
    </tr>
  </table>
</div>`;

const parsed = parseContributionCalendarHtml(fixture);
assert.equal(parsed.days.length, 3);
assert.deepEqual(parsed.days.map((day) => [day.date, day.count, day.level]), [
  ["2026-02-01", 0, 0],
  ["2026-02-02", 4, 2],
  ["2026-09-03", 8, 4]
]);
assert.equal(parsed.total, 12);

const summary = summarizeContributionCalendar(parsed, new Date("2026-09-04T00:00:00Z"));
assert.deepEqual(summary.months, ["FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP"]);
assert.deepEqual(summary.streams.map((stream) => stream.label), [
  ["Total", "contributions"],
  ["Active", "days"],
  ["Peak", "day"]
]);
assert.equal(summary.streams.length, 3);
assert.ok(summary.streams.every((stream) => stream.values.length === 8));
assert.ok(summary.streams.every((stream) => stream.values.every((value) => value >= 0 && value <= 68)));
assert.equal(summary.streams[0].values.at(-1), 68);
assert.equal(summary.streams[1].values.at(-1), 68);
assert.equal(summary.streams[2].values.at(-1), 68);

const normalized = normalizeGithubSearchItem({
  repository_url: "https://api.github.com/repos/example/project",
  html_url: "https://github.com/example/project/pull/7",
  number: 7,
  title: "A useful change",
  closed_at: "2026-09-03T00:00:00Z",
  body: "caller-controlled content that must not enter the snapshot",
  user: { login: "example" },
  labels: [{ name: "security" }]
});
assert.deepEqual(normalized, {
  repository_url: "https://api.github.com/repos/example/project",
  html_url: "https://github.com/example/project/pull/7",
  number: 7,
  title: "A useful change",
  closed_at: "2026-09-03T00:00:00Z"
});
assert.throws(() => normalizeGithubSearchItem({ ...normalized, number: 0 }), /invalid pull-request number/);

assert.equal(
  publicMergedPullRequestQuery("jstar0"),
  "author:jstar0 type:pr is:merged is:public"
);
assert.equal(
  publicMergedPullRequestQuery("jstar0", "2026-01-01..2026-09-04"),
  "author:jstar0 type:pr is:merged is:public merged:2026-01-01..2026-09-04"
);

console.log("GitHub sync parser tests passed");
