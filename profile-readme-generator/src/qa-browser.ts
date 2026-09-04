import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function loadPlaywright(): any {
  return require("playwright");
}

function explicitBrowserPath(): string | undefined {
  return [
    process.env.CHROME_PATH,
    process.env.CHROME_BIN
  ].find((value): value is string => typeof value === "string" && fs.existsSync(value));
}

export function browserLaunchOptions(): Record<string, unknown> {
  // Playwright's installed browser is pinned by pnpm-lock.yaml. Only use a
  // system browser when a caller explicitly opts in for local debugging.
  const executablePath = explicitBrowserPath();
  return {
    headless: true,
    ...(executablePath ? { executablePath } : {})
  };
}
