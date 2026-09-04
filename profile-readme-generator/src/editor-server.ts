import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { syncGithubProfile } from "./github-sync.ts";
import {
  DEFAULT_DATA_PATH,
  PROJECT_ROOT,
  loadProfileData,
  validateProfileData,
  type ProfileData
} from "./model.ts";
import { renderReadmeSnippet } from "./renderer.ts";

const execFileAsync = promisify(execFile);
const EDITOR_ROOT = path.join(PROJECT_ROOT, "editor");
const GENERATED_ROOT = path.join(PROJECT_ROOT, "generated");
const SNAPSHOT_PATH = path.join(path.dirname(DEFAULT_DATA_PATH), "github.snapshot.json");
const MAX_BODY_BYTES = 2_000_000;

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

export interface EditorServer {
  url: string;
  close(): Promise<void>;
}

interface SnapshotRecord {
  schemaVersion?: number;
  username?: string;
  fetchedAt?: string;
  stats?: ProfileData["stats"];
  languages?: ProfileData["languages"];
  contribution?: ProfileData["contribution"];
  contributionCalendar?: { total?: number };
  languageRepositoryCount?: number;
  sources?: Record<string, string>;
}

function send(response: ServerResponse, status: number, body: string, contentType: string): void {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, `${JSON.stringify(value)}\n`, "application/json; charset=utf-8");
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { ok: false, error: message });
}

function readFileIfPresent<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function readSnapshot(): SnapshotRecord | undefined {
  return readFileIfPresent<SnapshotRecord>(SNAPSHOT_PATH);
}

function githubUsernameFromUrl(profileUrl: string | undefined): string | undefined {
  if (!profileUrl) return undefined;
  try {
    const parsed = new URL(profileUrl);
    if (parsed.hostname !== "github.com") return undefined;
    const username = parsed.pathname.split("/").filter(Boolean)[0];
    return username && /^[A-Za-z0-9-]+$/.test(username) ? username : undefined;
  } catch {
    return undefined;
  }
}

function snapshotSummary(data: ProfileData, snapshot: SnapshotRecord | undefined): Record<string, unknown> {
  const source = data.dataSource;
  const live = Boolean(
    snapshot &&
    source &&
    githubUsernameFromUrl(data.profileUrl)?.toLowerCase() === source.username.toLowerCase() &&
    snapshot.username?.toLowerCase() === source.username.toLowerCase() &&
    snapshot.fetchedAt === source.fetchedAt &&
    JSON.stringify(snapshot.stats) === JSON.stringify(data.stats) &&
    JSON.stringify(snapshot.languages) === JSON.stringify(data.languages) &&
    JSON.stringify(snapshot.contribution) === JSON.stringify(data.contribution)
  );
  return {
    live,
    provider: source?.provider ?? null,
    username: source?.username ?? null,
    fetchedAt: source?.fetchedAt ?? null,
    contributionSource: source?.contributionSource ?? null,
    languageScope: source?.languageScope ?? null,
    snapshot: snapshot
      ? {
        schemaVersion: snapshot.schemaVersion ?? null,
        username: snapshot.username ?? null,
        fetchedAt: snapshot.fetchedAt ?? null,
        stats: snapshot.stats ?? null,
        languages: snapshot.languages ?? null,
        contributionTotal: snapshot.contributionCalendar?.total ?? null,
        languageRepositoryCount: snapshot.languageRepositoryCount ?? null,
        sources: snapshot.sources ?? null
      }
      : null
  };
}

function profileResponse(data = loadProfileData()): Record<string, unknown> {
  return {
    ok: true,
    data,
    source: snapshotSummary(data, readSnapshot()),
    generatedAt: new Date().toISOString()
  };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        reject(new Error("request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

async function generateAssets(): Promise<string> {
  const cliPath = path.join(PROJECT_ROOT, "src", "cli.ts");
  const result = await execFileAsync(process.execPath, ["--experimental-strip-types", cliPath], {
    cwd: PROJECT_ROOT,
    maxBuffer: 2_000_000
  });
  return `${result.stdout}${result.stderr}`.trim();
}

function resolveGithubToken(): { token?: string; source: "environment" | "gh" | "none" } {
  const environmentToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (environmentToken) return { token: environmentToken, source: "environment" };
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return token ? { token, source: "gh" } : { source: "none" };
  } catch {
    return { source: "none" };
  }
}

function usernameFromProfile(data: ProfileData): string {
  const username = githubUsernameFromUrl(data.profileUrl);
  if (!username) throw new Error("configure a valid github.com profile URL before syncing");
  return username;
}

function staticFile(response: ServerResponse, root: string, relativePath: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(relativePath)) {
    sendError(response, 400, "invalid file name");
    return;
  }
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendError(response, 404, "file not found");
    return;
  }
  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  fs.createReadStream(filePath).pipe(response);
}

function previewHtml(data: ProfileData): string {
  // The editor preview is an iframe with its own viewport. Eager loading is
  // intentional here so every generated fragment is visible for inspection;
  // the published README keeps its lazy-loading policy unchanged.
  const imageLayer = renderReadmeSnippet(data, { assetPrefix: "/generated/" })
    .replaceAll('loading="lazy"', 'loading="eager"');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>README preview</title><style>
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#132238}main{width:100%;max-width:941px;margin:0 auto}#image-layer{width:100%}#image-layer>div{width:100%;text-align:center}#image-layer>div>a,#image-layer>div>picture{vertical-align:top}img{max-width:100%;height:auto}
</style></head><body><main><section id="image-layer">${imageLayer}</section></main></body></html>`;
}

export function createEditorServer(options: { host?: string; port?: number } = {}): Promise<EditorServer> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4173;
  let mutation = Promise.resolve();

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = mutation.then(job, job);
    mutation = next.then(() => undefined, () => undefined);
    return next;
  }

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${host}`);
      const pathname = requestUrl.pathname;

      if (request.method === "GET" && pathname === "/") {
        staticFile(response, EDITOR_ROOT, "index.html");
        return;
      }
      if (request.method === "GET" && (pathname === "/app.js" || pathname === "/style.css")) {
        staticFile(response, EDITOR_ROOT, pathname.slice(1));
        return;
      }
      if (request.method === "GET" && pathname === "/preview") {
        send(response, 200, previewHtml(loadProfileData()), "text/html; charset=utf-8");
        return;
      }
      if (request.method === "GET" && pathname.startsWith("/generated/")) {
        staticFile(response, GENERATED_ROOT, pathname.slice("/generated/".length));
        return;
      }
      if (request.method === "GET" && pathname.startsWith("/assets/")) {
        staticFile(response, path.join(PROJECT_ROOT, "assets"), pathname.slice("/assets/".length));
        return;
      }
      if (request.method === "GET" && pathname === "/api/profile") {
        sendJson(response, 200, profileResponse());
        return;
      }
      if (request.method === "GET" && pathname === "/api/readme") {
        const readmePath = path.join(GENERATED_ROOT, "README.generated.md");
        send(response, 200, fs.readFileSync(readmePath, "utf8"), "text/markdown; charset=utf-8");
        return;
      }

      if (request.method === "POST" && pathname === "/api/profile") {
        const body = parseJsonBody(await readBody(request));
        const candidate = (body && typeof body === "object" && "data" in body)
          ? (body as { data: unknown }).data
          : body;
        const submitted = validateProfileData(candidate);
        const current = loadProfileData();
        const sameGithubUser = githubUsernameFromUrl(current.profileUrl)?.toLowerCase() === githubUsernameFromUrl(submitted.profileUrl)?.toLowerCase();
        const data = sameGithubUser
          ? submitted
          : (() => {
            const { dataSource: _staleSource, ...withoutStaleSource } = submitted;
            return withoutStaleSource as ProfileData;
          })();
        const result = await enqueue(async () => {
          writeJsonAtomically(DEFAULT_DATA_PATH, data);
          const output = await generateAssets();
          return { data: loadProfileData(), output };
        });
        sendJson(response, 200, { ok: true, ...profileResponse(result.data), output: result.output });
        return;
      }

      if (request.method === "POST" && pathname === "/api/generate") {
        const output = await enqueue(() => generateAssets());
        sendJson(response, 200, { ok: true, output, ...profileResponse() });
        return;
      }

      if (request.method === "POST" && pathname === "/api/sync") {
        const body = parseJsonBody(await readBody(request));
        const requestedUsername = body && typeof body === "object" && "username" in body
          ? String((body as { username?: unknown }).username ?? "")
          : "";
        const result = await enqueue(async () => {
          const current = loadProfileData();
          const username = requestedUsername || usernameFromProfile(current);
          if (!/^[A-Za-z0-9-]+$/.test(username)) throw new Error("invalid GitHub username");
          const auth = resolveGithubToken();
          const snapshot = await syncGithubProfile({
            username,
            dataPath: DEFAULT_DATA_PATH,
            snapshotPath: SNAPSHOT_PATH,
            token: auth.token
          });
          const output = await generateAssets();
          return { snapshot, authSource: auth.source, output, data: loadProfileData() };
        });
        sendJson(response, 200, {
          ok: true,
          authentication: result.authSource === "none" ? "unauthenticated" : result.authSource,
          synced: {
            username: result.snapshot.username,
            fetchedAt: result.snapshot.fetchedAt,
            stats: result.snapshot.stats,
            languages: result.snapshot.languages,
            contributionTotal: result.snapshot.contributionCalendar.total
          },
          output: result.output,
          ...profileResponse(result.data)
        });
        return;
      }

      sendError(response, 404, "route not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendError(response, 400, message);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("editor server did not expose a TCP address"));
        return;
      }
      resolve({
        url: `http://${host}:${address.port}`,
        close: () => new Promise<void>((closeResolve, closeReject) => {
          server.close((error) => error ? closeReject(error) : closeResolve());
        })
      });
    });
  });
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const port = Number(argument("--port") ?? process.env.PORT ?? 4173);
  createEditorServer({ port }).then(({ url }) => {
    console.log(`Profile README editor: ${url}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
