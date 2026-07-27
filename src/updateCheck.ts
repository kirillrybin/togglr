import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readJson, writeJson } from "./cache/store.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day
const FETCH_TIMEOUT_MS = 1500;
const REGISTRY_URL = "https://registry.npmjs.org/@kirillrybin%2Ftogglr/latest";

interface UpdateCheckState {
  lastCheckedAt: string;
  latestVersion: string | null;
}

function stateFile(cacheDir: string): string {
  return path.join(cacheDir, "update_check.json");
}

export function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Checks npm for a newer published version, at most once every 24h (result
 * cached in cacheDir), and calls `notice(current, latest)` if one is found.
 * Never throws — a failed/slow network check just means no notice this run.
 */
export async function checkForUpdate(
  cacheDir: string,
  currentVersion: string,
  now: Date = new Date(),
  notice: (current: string, latest: string) => void = defaultNotice
): Promise<void> {
  try {
    const state = await readJson<UpdateCheckState>(stateFile(cacheDir));
    const isStale = !state || now.getTime() - new Date(state.lastCheckedAt).getTime() > CHECK_INTERVAL_MS;

    let latestVersion = state?.latestVersion ?? null;
    if (isStale) {
      latestVersion = (await fetchLatestVersion()) ?? latestVersion;
      await writeJson(stateFile(cacheDir), { lastCheckedAt: now.toISOString(), latestVersion });
    }

    if (latestVersion && isNewer(latestVersion, currentVersion)) {
      notice(currentVersion, latestVersion);
    }
  } catch {
    // An update check is a nice-to-have; never let it affect the actual command.
  }
}

function defaultNotice(current: string, latest: string): void {
  console.error(`\nUpdate available: ${current} → ${latest}`);
  console.error(`Run: npm install -g @kirillrybin/togglr\n`);
}

// package.json ships alongside dist/ in the published tarball (npm always
// includes it), one directory up from this compiled file.
export async function getCurrentVersion(): Promise<string> {
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8")) as { version: string };
  return pkg.version;
}
