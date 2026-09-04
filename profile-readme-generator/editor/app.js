const accents = ["blue", "cyan", "mint", "yellow", "orange"];
const state = { data: null, source: null, busy: false };

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function selectedOptions(selected) {
  return accents
    .map((accent) => `<option value="${accent}"${accent === selected ? " selected" : ""}>${accent}</option>`)
    .join("");
}

function field(label, control, className = "") {
  return `<label class="field ${className}"><span class="field-label">${label}</span>${control}</label>`;
}

function textInput(value, attributes = "") {
  return `<input type="text" value="${escapeHtml(value)}" ${attributes}>`;
}

function urlInput(value, attributes = "") {
  return `<input type="url" value="${escapeHtml(value)}" placeholder="https://github.com/..." ${attributes}>`;
}

function renderIdentity(data) {
  const descriptors = [...(data.identity.descriptor || []), "", ""];
  return [
    field("Display name", textInput(data.identity.name, 'data-identity="name" required')),
    field("GitHub profile URL", urlInput(data.profileUrl, 'data-identity="profileUrl" required')),
    field("Descriptor line 1", textInput(descriptors[0], 'data-descriptor-index="0"'), "field-half"),
    field("Descriptor line 2", textInput(descriptors[1], 'data-descriptor-index="1"'), "field-half"),
    field("Introduction", `<textarea data-identity="intro" rows="3" required>${escapeHtml(data.identity.intro)}</textarea>`, "field-wide")
  ].join("");
}

function renderWorkstreams(data) {
  return data.workstreams.map((stream, index) => `
    <article class="repeat-card" data-workstream-index="${index}">
      <div class="repeat-card-heading"><span class="repeat-number">${escapeHtml(stream.index)}</span><span class="repeat-title">Workstream ${String(index + 1).padStart(2, "0")}</span></div>
      <div class="field-grid">
        ${field("Label", textInput(stream.label, 'data-workstream-field="label" required'), "field-wide")}
        ${field("Detail", textInput(stream.detail, 'data-workstream-field="detail" required'), "field-wide")}
        ${field("Accent", `<select data-workstream-field="accent">${selectedOptions(stream.accent)}</select>`)}
      </div>
    </article>`).join("");
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function renderStats(data) {
  const stats = [
    ["Merged PRs", formatNumber(data.stats.mergedPrs)],
    ["Public repositories", formatNumber(data.stats.publicRepositories)],
    [`Merged in ${data.stats.year}`, formatNumber(data.stats.mergedThisYear)],
    ["Repositories over 1k stars", formatNumber(data.stats.repositoriesOver1kStars)],
    ["Contributions / last year", formatNumber(data.stats.contributionsLastYear)]
  ];
  return `${stats.map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join("")}
    <div class="stat stat-date"><span>Snapshot date</span><strong>${escapeHtml(data.stats.asOf)}</strong></div>`;
}

function renderUpstream(data) {
  return data.upstreamExamples.map((item, index) => `
    <article class="repeat-card compact-card" data-upstream-index="${index}">
      <div class="repeat-card-heading"><span class="repeat-number">${String(index + 1).padStart(2, "0")}</span><span class="repeat-title">Upstream example</span><button class="remove-button" type="button" data-action="remove-upstream" data-index="${index}" title="Remove upstream example" aria-label="Remove upstream example">&times;</button></div>
      <div class="field-grid">
        ${field("Repository", textInput(item.repository, 'data-upstream-field="repository" required'), "field-half")}
        ${field("Pull request", textInput(item.pr, 'data-upstream-field="pr" required'), "field-half")}
        ${field("Repository URL", urlInput(item.repositoryUrl, 'data-upstream-field="repositoryUrl"'), "field-half")}
        ${field("Pull request URL", urlInput(item.prUrl, 'data-upstream-field="prUrl"'), "field-half")}
        ${field("Accent", `<select data-upstream-field="accent">${selectedOptions(item.accent)}</select>`)}
      </div>
    </article>`).join("");
}

function renderProjects(data) {
  if (!data.personalProjects.length) {
    return `<div class="empty-state">No personal projects yet. Add the first row below.</div>`;
  }
  return data.personalProjects.map((item, index) => `
    <article class="repeat-card project-card" data-project-index="${index}">
      <div class="repeat-card-heading"><span class="repeat-number">${String(index + 1).padStart(2, "0")}</span><span class="repeat-title">Personal project</span><button class="remove-button" type="button" data-action="remove-project" data-index="${index}" title="Remove personal project" aria-label="Remove personal project">&times;</button></div>
      <div class="field-grid">
        ${field("Title", textInput(item.title, 'data-project-field="title" required'), "field-half")}
        ${field("Accent", `<select data-project-field="accent">${selectedOptions(item.accent || "blue")}</select>`, "field-half")}
        ${field("Description", `<textarea data-project-field="description" rows="2" required>${escapeHtml(item.description)}</textarea>`, "field-wide")}
        ${field("Project URL", urlInput(item.url, 'data-project-field="url"'), "field-wide")}
      </div>
      <label class="check-row"><input type="checkbox" data-project-field="placeholder"${item.placeholder ? " checked" : ""}><span>Reserve this row without a link</span></label>
    </article>`).join("");
}

function renderLanguages(data) {
  return data.languages.map((language) => `
    <div class="language-row"><span class="language-dot" data-accent="${escapeHtml(language.accent)}"></span><span>${escapeHtml(language.name)}</span><strong>${Number(language.percentage).toFixed(2)}%</strong></div>`).join("");
}

function renderSource(source) {
  if (!source) return "<span class=\"source-dot source-dot-muted\"></span><span>Profile data is loading...</span>";
  const label = source.live ? "LIVE GITHUB SNAPSHOT" : "LOCAL CONFIGURATION";
  const detail = source.username
    ? `@${source.username}${source.fetchedAt ? ` / ${new Date(source.fetchedAt).toLocaleString()}` : ""}`
    : "Run Sync GitHub to fetch public data";
  return `<span class="source-dot ${source.live ? "" : "source-dot-muted"}"></span><span><strong>${label}</strong><small>${escapeHtml(detail)}</small></span>`;
}

function render() {
  const data = state.data;
  $("#identity-fields").innerHTML = renderIdentity(data);
  $("#workstream-list").innerHTML = renderWorkstreams(data);
  $("#stats-grid").innerHTML = renderStats(data);
  $("#upstream-list").innerHTML = renderUpstream(data);
  $("#project-list").innerHTML = renderProjects(data);
  $("#language-list").innerHTML = renderLanguages(data);
  $("#source-strip").innerHTML = renderSource(state.source);
  syncPlaceholderControls();
}

function syncPlaceholderControls() {
  document.querySelectorAll("[data-project-index]").forEach((card) => {
    const checkbox = card.querySelector('[data-project-field="placeholder"]');
    const url = card.querySelector('[data-project-field="url"]');
    if (!checkbox || !url) return;
    url.disabled = checkbox.checked;
    url.placeholder = checkbox.checked ? "No URL for a reserved row" : "https://github.com/...";
  });
}

function value(selector, root = document) {
  return root.querySelector(selector)?.value.trim() || "";
}

function collectData() {
  const next = structuredClone(state.data);
  next.identity.name = value('[data-identity="name"]');
  next.profileUrl = value('[data-identity="profileUrl"]') || undefined;
  next.identity.intro = value('[data-identity="intro"]');
  next.identity.descriptor = [0, 1]
    .map((index) => value(`[data-descriptor-index="${index}"]`))
    .filter(Boolean);

  document.querySelectorAll("[data-workstream-index]").forEach((card) => {
    const index = Number(card.dataset.workstreamIndex);
    next.workstreams[index].label = value('[data-workstream-field="label"]', card);
    next.workstreams[index].detail = value('[data-workstream-field="detail"]', card);
    next.workstreams[index].accent = value('[data-workstream-field="accent"]', card);
  });

  document.querySelectorAll("[data-upstream-index]").forEach((card) => {
    const index = Number(card.dataset.upstreamIndex);
    const item = next.upstreamExamples[index];
    item.repository = value('[data-upstream-field="repository"]', card);
    item.pr = value('[data-upstream-field="pr"]', card);
    item.repositoryUrl = value('[data-upstream-field="repositoryUrl"]', card) || undefined;
    item.prUrl = value('[data-upstream-field="prUrl"]', card) || undefined;
    item.accent = value('[data-upstream-field="accent"]', card);
  });

  next.personalProjects = [...document.querySelectorAll("[data-project-index]")].map((card) => {
    const placeholder = Boolean(card.querySelector('[data-project-field="placeholder"]')?.checked);
    const item = {
      title: value('[data-project-field="title"]', card),
      description: value('[data-project-field="description"]', card),
      accent: value('[data-project-field="accent"]', card),
      ...(placeholder ? { placeholder: true } : { url: value('[data-project-field="url"]', card) || undefined })
    };
    return item;
  });
  return next;
}

function captureDraft() {
  if (!state.data) return false;
  state.data = collectData();
  return true;
}

function validateClient(data) {
  if (!data.identity.name || !data.identity.intro || !data.profileUrl) throw new Error("Profile name, URL, and introduction are required.");
  try {
    if (new URL(data.profileUrl).protocol !== "https:") throw new Error();
  } catch {
    throw new Error("GitHub profile URL must be an absolute HTTPS URL.");
  }
  for (const project of data.personalProjects) {
    if (!project.title || !project.description) throw new Error("Every personal project needs a title and description.");
    if (project.placeholder) continue;
    if (!project.url) continue;
    try {
      if (new URL(project.url).protocol !== "https:") throw new Error();
    } catch {
      throw new Error(`Project URL is not a valid HTTPS URL: ${project.title}`);
    }
  }
}

function setStatus(message, tone = "") {
  const status = $("#save-status");
  status.textContent = message;
  status.dataset.tone = tone;
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
  document.body.classList.toggle("is-busy", busy);
}

function reloadPreview() {
  $("#preview-frame").src = `/preview?updated=${Date.now()}`;
  $("#asset-status").textContent = "Generated assets refreshed.";
}

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

async function loadProfile() {
  const payload = await request("/api/profile");
  state.data = payload.data;
  state.source = payload.source;
  render();
  setStatus(state.source.live ? "Live snapshot loaded" : "Local data loaded", state.source.live ? "ok" : "warn");
}

async function saveProfile(event) {
  event.preventDefault();
  if (state.busy) return;
  try {
    const data = collectData();
    validateClient(data);
    setBusy(true);
    setStatus("Saving and generating...", "busy");
    const payload = await request("/api/profile", { method: "POST", body: JSON.stringify({ data }) });
    state.data = payload.data;
    state.source = payload.source;
    render();
    reloadPreview();
    setStatus("Saved and generated", "ok");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(false);
  }
}

async function syncGithub() {
  if (state.busy) return;
  try {
    setBusy(true);
    setStatus("Reading public GitHub data...", "busy");
    const username = state.source?.username || undefined;
    const payload = await request("/api/sync", { method: "POST", body: JSON.stringify(username ? { username } : {}) });
    state.data = payload.data;
    state.source = payload.source;
    render();
    reloadPreview();
    setStatus(`Synced @${payload.synced.username} and regenerated`, "ok");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(false);
  }
}

async function copyReadme() {
  try {
    const response = await fetch("/api/readme");
    const text = await response.text();
    await navigator.clipboard.writeText(text);
    setStatus("Generated README copied", "ok");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not copy README", "error");
  }
}

$("#profile-form").addEventListener("submit", saveProfile);
$("#sync-button").addEventListener("click", syncGithub);
$("#copy-readme").addEventListener("click", copyReadme);
$("#add-project").addEventListener("click", () => {
  if (state.busy || !captureDraft()) return;
  state.data.personalProjects.push({ title: "", description: "", accent: "blue" });
  render();
  const cards = document.querySelectorAll("[data-project-index]");
  cards[ cards.length - 1 ]?.querySelector('[data-project-field="title"]')?.focus();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || state.busy || !captureDraft()) return;
  const index = Number(button.dataset.index);
  if (button.dataset.action === "remove-project") state.data.personalProjects.splice(index, 1);
  if (button.dataset.action === "remove-upstream") state.data.upstreamExamples.splice(index, 1);
  render();
});

document.addEventListener("change", (event) => {
  if (event.target.matches('[data-project-field="placeholder"]')) syncPlaceholderControls();
});

loadProfile().catch((error) => setStatus(error instanceof Error ? error.message : String(error), "error"));
