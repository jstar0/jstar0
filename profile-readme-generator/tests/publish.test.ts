import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishProfile } from "../src/publish.ts";
import { PROJECT_ROOT } from "../src/model.ts";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jstar-profile-publish-"));
const destinationDir = path.join(temporaryRoot, "profile");

try {
  const published = publishProfile({ destinationDir, pruneManaged: true });
  assert.equal(published.checked, false);
  assert.ok(published.assets.length > 0);
  assert.equal(fs.existsSync(path.join(destinationDir, "README.md")), true);
  assert.equal(fs.existsSync(path.join(destinationDir, ".profile-readme-assets.json")), true);
  for (const asset of published.assets) {
    assert.equal(fs.existsSync(path.join(destinationDir, "assets", asset)), true, asset);
  }

  const checked = publishProfile({ destinationDir, check: true });
  assert.equal(checked.checked, true);
  assert.deepEqual(checked.assets, published.assets);

  const readmePath = path.join(destinationDir, "README.md");
  fs.appendFileSync(readmePath, "\nchanged\n");
  assert.throws(() => publishProfile({ destinationDir, check: true }), /README\.md is stale/);

  console.log("Publish contract tests passed");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
