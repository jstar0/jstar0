import assert from "node:assert/strict";
import { loadProfileData } from "../src/model.ts";
import { computeLayouts } from "../src/layout.ts";

const fixture = loadProfileData();
const baseline = computeLayouts(fixture);

assert.equal(baseline.wide.width, 941);
assert.equal(baseline.wide.height, 1604);
assert.equal(baseline.narrow.width, 680);
assert.equal(baseline.narrow.height, 2140);
assert.equal(baseline.wide.metricsTitleY, 1141);
assert.equal(baseline.narrow.metricsTitleY, 1345);

const expanded = structuredClone(fixture);
expanded.upstreamExamples.push(
  { repository: "example/upstream-one", pr: "#1", accent: "blue" },
  { repository: "example/upstream-two", pr: "#2", accent: "cyan" }
);
expanded.personalProjects.push(
  { title: "new project", description: "new description" },
  { title: "another project", description: "another description" }
);
const expandedLayout = computeLayouts(expanded);

assert.equal(expandedLayout.wide.metricsTitleY - baseline.wide.metricsTitleY, 2 * 42 + 2 * 44);
assert.equal(expandedLayout.narrow.metricsTitleY - baseline.narrow.metricsTitleY, 2 * 56 + 2 * 52);
assert.ok(expandedLayout.wide.height > baseline.wide.height);
assert.ok(expandedLayout.narrow.height > baseline.narrow.height);

console.log("layout tests passed");
