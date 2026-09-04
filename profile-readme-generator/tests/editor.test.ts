import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createEditorServer } from "../src/editor-server.ts";
import { PROJECT_ROOT, loadProfileData, validateProfileData } from "../src/model.ts";

const data = loadProfileData();
const editorHtml = fs.readFileSync(path.join(PROJECT_ROOT, "editor", "index.html"), "utf8");
const editorScript = fs.readFileSync(path.join(PROJECT_ROOT, "editor", "app.js"), "utf8");

assert.match(editorHtml, /id="project-list"/);
assert.match(editorHtml, /id="add-project"/);
assert.match(editorHtml, /id="sync-button"/);
assert.match(editorScript, /data-project-field/);
assert.match(editorScript, /request\("\/api\/profile",\s*\{\s*method:\s*"POST"/s);

const placeholder = structuredClone(data);
placeholder.personalProjects = [{
  title: "Reserved",
  description: "A project row reserved for later",
  accent: "blue",
  placeholder: true
}];
assert.doesNotThrow(() => validateProfileData(placeholder));

const invalidPlaceholder = structuredClone(placeholder);
invalidPlaceholder.personalProjects[0].url = "https://github.com/jstar0";
assert.throws(() => validateProfileData(invalidPlaceholder), /placeholder projects cannot have links/);

const editor = await createEditorServer({ port: 0 });
try {
  const profileResponse = await fetch(`${editor.url}/api/profile`);
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json() as {
    ok: boolean;
    data: typeof data;
    source: { live: boolean; username: string };
  };
  assert.equal(profile.ok, true);
  assert.equal(profile.data.personalProjects.length, data.personalProjects.length);
  assert.equal(profile.source.username, data.dataSource?.username);
  assert.equal(profile.source.live, true);

  const previewResponse = await fetch(`${editor.url}/preview`);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.text();
  assert.match(preview, /Personal project CodexFold/);
  assert.match(preview, /profile-wide-split-header\.svg/);
  assert.doesNotMatch(preview, /loading="lazy"/, "local iframe preview must eagerly load every fragment");
} finally {
  await editor.close();
}

console.log("Editor contract tests passed");
