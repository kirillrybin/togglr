# togglr CLI/TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js/TypeScript CLI for Toggl Track with quick one-shot
commands (`start`/`stop`/`status`/`continue`/`report`/`list-projects`) and a
default Ink-based TUI dashboard, all constrained by Toggl's 30 req/hour rate
limit via a local file cache with per-entity TTLs.

**Architecture:** A thin `api/` client talks to Toggl API v9. A `cache/`
layer is the *only* thing allowed to decide whether to spend API budget —
everything else (`commands/`, `tui/`) reads through it. `domain/` holds pure
data models and report aggregation logic decoupled from Toggl's raw JSON
shapes. Mutating actions (start/stop/continue) always call the API directly
and are never throttled.

**Tech Stack:** TypeScript (strict, ESM/NodeNext), Node.js ≥ 18 (global
`fetch`), Ink 5 + React 18 for the TUI, Commander for CLI parsing, Vitest +
`ink-testing-library` for tests.

## Global Constraints

- Node.js ≥ 18 (relies on global `fetch`; no `undici`/`node-fetch` dependency).
- Toggl API rate limit: 30 requests/hour. The app must never exceed a
  self-imposed budget of **25 requests/hour** (`DEFAULT_BUDGET_PER_HOUR` in
  `cache/sync.ts`), leaving headroom under Toggl's real limit.
- Mutating commands (`start`, `stop`, `continue`) always call the API
  directly and are **never** subject to the rate-limit budget check —
  only read-refresh calls are throttled.
- Cache files live under `~/.cache/togglr/`; config lives under
  `~/.config/togglr/config.json` with file mode `600`.
- TTLs: `projects` = 21600s (6h), `timeEntries` = 300s (5min), both
  overridable via `config.json`'s `cacheTtl`.
- All filesystem-touching code must accept an injectable root directory (no
  hardcoded `os.homedir()` calls inside logic used by tests) so tests run
  against temp directories, never the real user config/cache.
- ESM throughout: relative imports use explicit `.js` extensions (NodeNext
  resolution), even though source files are `.ts`.

---

## File Structure

```
package.json
tsconfig.json
vitest.config.ts
.gitignore
src/
  api/
    types.ts        — raw Toggl API v9 response shapes
    client.ts        — TogglApiClient interface, TogglClient, TogglApiError
  domain/
    models.ts         — Project, TimeEntry, Timer (app-level types)
    mappers.ts         — raw API shape -> domain model mapping
    report.ts          — ProjectSummary, aggregateReport()
  cache/
    paths.ts           — getCacheDir(), getConfigDir()
    store.ts           — readJson/writeJson, CacheEntry<T>, readCacheEntry/writeCacheEntry, isStale
    rateLimiter.ts      — RateLimiterState, pruneOld, canSpend, recordRequest
    sync.ts             — SyncContext, DEFAULT_BUDGET_PER_HOUR, refreshAll, getProjects, getTimeEntries
    timerState.ts        — readTimer, writeTimer
  config/
    config.ts            — Config type, readConfig, writeConfig, DEFAULT_TTL
    ensureConfig.ts        — ensureConfig() interactive first-run token prompt
  commands/
    start.ts               — createTimer, runStart
    stop.ts                  — runStop
    status.ts                 — runStatus, formatDuration
    listProjects.ts            — runListProjects
    continueLast.ts             — runContinue
    report.ts                    — resolveRange, runReport
  tui/
    Dashboard.tsx                 — presentational dashboard component
    App.tsx                        — container: data loading, keybindings
  bootstrap.ts                      — buildContext()
  cli.ts                             — Commander wiring + entry point
tests/
  api/client.test.ts
  domain/mappers.test.ts
  domain/report.test.ts
  cache/store.test.ts
  cache/rateLimiter.test.ts
  cache/sync.test.ts
  cache/timerState.test.ts
  config/config.test.ts
  config/ensureConfig.test.ts
  commands/start.test.ts
  commands/stop.test.ts
  commands/status.test.ts
  commands/continueLast.test.ts
  commands/report.test.ts
  tui/Dashboard.test.tsx
```

---

### Task 1: Project scaffolding + Toggl API client

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/api/types.ts`
- Create: `src/api/client.ts`
- Test: `tests/api/client.test.ts`

**Interfaces:**
- Produces: `TogglApiError` (class, `.status: number`), `TogglMeResponse`,
  `TogglProjectRaw`, `TogglTimeEntryRaw`, `TogglApiClient` interface,
  `TogglClient` class implementing `TogglApiClient`.

- [ ] **Step 1: Create project scaffolding files**

`package.json`:
```json
{
  "name": "togglr",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "bin": { "toggl": "./dist/cli.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "ink": "^5.0.1",
    "ink-text-input": "^6.0.0",
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "ink-testing-library": "^3.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react",
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

`.gitignore`:
```
node_modules/
dist/
*.log
```

Run: `npm install`

- [ ] **Step 2: Write the failing test for TogglClient**

`tests/api/client.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TogglClient, TogglApiError } from "../../src/api/client.js";

describe("TogglClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("sends Basic auth header built from the API token", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 1, default_workspace_id: 42 }),
    });
    const client = new TogglClient("mytoken");
    await client.getMe(false);
    const [, init] = (fetch as any).mock.calls[0];
    const expected = "Basic " + Buffer.from("mytoken:api_token").toString("base64");
    expect(init.headers.Authorization).toBe(expected);
  });

  it("appends with_related_data=true when requested", async () => {
    (fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const client = new TogglClient("mytoken");
    await client.getMe(true);
    const [url] = (fetch as any).mock.calls[0];
    expect(url).toContain("with_related_data=true");
  });

  it("throws TogglApiError with status 401 on invalid token", async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const client = new TogglClient("bad");
    await expect(client.getMe(false)).rejects.toMatchObject({ status: 401 });
    await expect(client.getMe(false)).rejects.toBeInstanceOf(TogglApiError);
  });

  it("throws TogglApiError with status 429 when rate limited", async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const client = new TogglClient("t");
    await expect(client.getMe(false)).rejects.toMatchObject({ status: 429 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/api/client.test.ts`
Expected: FAIL — `Cannot find module '../../src/api/client.js'`

- [ ] **Step 4: Implement api/types.ts and api/client.ts**

`src/api/types.ts`:
```ts
export interface TogglProjectRaw {
  id: number;
  name: string;
  color: string;
  workspace_id: number;
}

export interface TogglTimeEntryRaw {
  id: number;
  description: string;
  project_id: number | null;
  workspace_id: number;
  start: string;
  stop: string | null;
  duration: number;
  tags: string[] | null;
}

export interface TogglMeResponse {
  id: number;
  default_workspace_id: number;
  projects?: TogglProjectRaw[];
  time_entries?: TogglTimeEntryRaw[];
}
```

`src/api/client.ts`:
```ts
import type { TogglMeResponse, TogglTimeEntryRaw } from "./types.js";

export class TogglApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "TogglApiError";
  }
}

export interface CreateTimeEntryData {
  description: string;
  project_id?: number;
  tags?: string[];
}

export interface TogglApiClient {
  getMe(withRelatedData: boolean): Promise<TogglMeResponse>;
  createTimeEntry(workspaceId: number, data: CreateTimeEntryData): Promise<TogglTimeEntryRaw>;
  stopTimeEntry(workspaceId: number, entryId: number): Promise<TogglTimeEntryRaw>;
}

export class TogglClient implements TogglApiClient {
  constructor(
    private token: string,
    private baseUrl = "https://api.track.toggl.com/api/v9"
  ) {}

  private authHeader(): string {
    return "Basic " + Buffer.from(`${this.token}:api_token`).toString("base64");
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new TogglApiError("Invalid or expired API token", 401);
    if (res.status === 429) throw new TogglApiError("Rate limited by Toggl", 429);
    if (!res.ok) throw new TogglApiError(`Toggl API error: ${res.status}`, res.status);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  getMe(withRelatedData: boolean): Promise<TogglMeResponse> {
    return this.request("GET", `/me${withRelatedData ? "?with_related_data=true" : ""}`);
  }

  createTimeEntry(workspaceId: number, data: CreateTimeEntryData): Promise<TogglTimeEntryRaw> {
    return this.request("POST", `/workspaces/${workspaceId}/time_entries`, {
      ...data,
      workspace_id: workspaceId,
      start: new Date().toISOString(),
      duration: -1,
      created_with: "togglr",
    });
  }

  stopTimeEntry(workspaceId: number, entryId: number): Promise<TogglTimeEntryRaw> {
    return this.request("PATCH", `/workspaces/${workspaceId}/time_entries/${entryId}/stop`);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/api/client.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/api tests/api package-lock.json
git commit -m "feat: scaffold project and add Toggl API client"
```

---

### Task 2: Domain models and API mappers

**Files:**
- Create: `src/domain/models.ts`
- Create: `src/domain/mappers.ts`
- Test: `tests/domain/mappers.test.ts`

**Interfaces:**
- Consumes: `TogglProjectRaw`, `TogglTimeEntryRaw` (Task 1, `src/api/types.ts`)
- Produces: `Project { id, name, color, workspaceId }`, `TimeEntry { id,
  description, projectId, workspaceId, start, stop, durationSeconds, tags }`,
  `Timer { entryId, description, projectId, workspaceId, startedAt }`,
  `mapProject`, `mapProjects`, `mapTimeEntry`, `mapTimeEntries`.

- [ ] **Step 1: Write the failing test**

`tests/domain/mappers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mapProject, mapTimeEntry } from "../../src/domain/mappers.js";

describe("mapProject", () => {
  it("converts snake_case fields to camelCase", () => {
    const result = mapProject({ id: 1, name: "Website", color: "#fff", workspace_id: 9 });
    expect(result).toEqual({ id: 1, name: "Website", color: "#fff", workspaceId: 9 });
  });
});

describe("mapTimeEntry", () => {
  it("sets durationSeconds to the raw duration when stopped", () => {
    const result = mapTimeEntry({
      id: 1, description: "Coding", project_id: 5, workspace_id: 9,
      start: "2026-07-26T10:00:00Z", stop: "2026-07-26T10:30:00Z", duration: 1800, tags: ["a"],
    });
    expect(result.durationSeconds).toBe(1800);
    expect(result.tags).toEqual(["a"]);
  });

  it("sets durationSeconds to null when still running (stop is null)", () => {
    const result = mapTimeEntry({
      id: 1, description: "Coding", project_id: null, workspace_id: 9,
      start: "2026-07-26T10:00:00Z", stop: null, duration: -1721981000, tags: null,
    });
    expect(result.durationSeconds).toBeNull();
    expect(result.tags).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/mappers.test.ts`
Expected: FAIL — `Cannot find module '../../src/domain/mappers.js'`

- [ ] **Step 3: Implement domain/models.ts and domain/mappers.ts**

`src/domain/models.ts`:
```ts
export interface Project {
  id: number;
  name: string;
  color: string;
  workspaceId: number;
}

export interface TimeEntry {
  id: number;
  description: string;
  projectId: number | null;
  workspaceId: number;
  start: string;
  stop: string | null;
  durationSeconds: number | null;
  tags: string[];
}

export interface Timer {
  entryId: number;
  description: string;
  projectId: number | null;
  workspaceId: number;
  startedAt: string;
}
```

`src/domain/mappers.ts`:
```ts
import type { TogglProjectRaw, TogglTimeEntryRaw } from "../api/types.js";
import type { Project, TimeEntry } from "./models.js";

export function mapProject(raw: TogglProjectRaw): Project {
  return { id: raw.id, name: raw.name, color: raw.color, workspaceId: raw.workspace_id };
}

export function mapProjects(raws: TogglProjectRaw[]): Project[] {
  return raws.map(mapProject);
}

export function mapTimeEntry(raw: TogglTimeEntryRaw): TimeEntry {
  return {
    id: raw.id,
    description: raw.description,
    projectId: raw.project_id,
    workspaceId: raw.workspace_id,
    start: raw.start,
    stop: raw.stop,
    durationSeconds: raw.stop === null ? null : raw.duration,
    tags: raw.tags ?? [],
  };
}

export function mapTimeEntries(raws: TogglTimeEntryRaw[]): TimeEntry[] {
  return raws.map(mapTimeEntry);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/mappers.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/models.ts src/domain/mappers.ts tests/domain/mappers.test.ts
git commit -m "feat: add domain models and API response mappers"
```

---

### Task 3: Generic cache store with TTL

**Files:**
- Create: `src/cache/paths.ts`
- Create: `src/cache/store.ts`
- Test: `tests/cache/store.test.ts`

**Interfaces:**
- Produces: `getCacheDir(root?)`, `getConfigDir(root?)`, `CacheEntry<T> {
  lastSyncedAt: string; data: T }`, `readJson<T>(filePath)`,
  `writeJson<T>(filePath, data)`, `readCacheEntry<T>(filePath)`,
  `writeCacheEntry<T>(filePath, data, now?)`, `isStale(entry, ttlSeconds,
  now?)`.

- [ ] **Step 1: Write the failing test**

`tests/cache/store.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readJson, writeJson, readCacheEntry, writeCacheEntry, isStale,
} from "../../src/cache/store.js";

describe("cache/store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "togglr-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null reading a file that does not exist", async () => {
    expect(await readJson(join(dir, "missing.json"))).toBeNull();
  });

  it("round-trips arbitrary JSON data", async () => {
    const file = join(dir, "sub", "data.json");
    await writeJson(file, { a: 1 });
    expect(await readJson(file)).toEqual({ a: 1 });
  });

  it("wraps data with lastSyncedAt in a CacheEntry", async () => {
    const file = join(dir, "entry.json");
    const now = new Date("2026-07-26T10:00:00Z");
    await writeCacheEntry(file, [1, 2, 3], now);
    const entry = await readCacheEntry<number[]>(file);
    expect(entry).toEqual({ lastSyncedAt: now.toISOString(), data: [1, 2, 3] });
  });

  it("isStale is true when no entry exists", () => {
    expect(isStale(null, 300)).toBe(true);
  });

  it("isStale is false within the TTL window and true after it", () => {
    const entry = { lastSyncedAt: "2026-07-26T10:00:00Z", data: null };
    expect(isStale(entry, 300, new Date("2026-07-26T10:04:00Z"))).toBe(false);
    expect(isStale(entry, 300, new Date("2026-07-26T10:06:00Z"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cache/store.test.ts`
Expected: FAIL — `Cannot find module '../../src/cache/store.js'`

- [ ] **Step 3: Implement cache/paths.ts and cache/store.ts**

`src/cache/paths.ts`:
```ts
import os from "node:os";
import path from "node:path";

export function getCacheDir(root?: string): string {
  return root ?? path.join(os.homedir(), ".cache", "togglr");
}

export function getConfigDir(root?: string): string {
  return root ?? path.join(os.homedir(), ".config", "togglr");
}
```

`src/cache/store.ts`:
```ts
import fs from "node:fs/promises";
import path from "node:path";

export interface CacheEntry<T> {
  lastSyncedAt: string;
  data: T;
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function readCacheEntry<T>(filePath: string): Promise<CacheEntry<T> | null> {
  return readJson<CacheEntry<T>>(filePath);
}

export async function writeCacheEntry<T>(
  filePath: string,
  data: T,
  now: Date = new Date()
): Promise<void> {
  const entry: CacheEntry<T> = { lastSyncedAt: now.toISOString(), data };
  await writeJson(filePath, entry);
}

export function isStale(
  entry: CacheEntry<unknown> | null,
  ttlSeconds: number,
  now: Date = new Date()
): boolean {
  if (!entry) return true;
  const ageSeconds = (now.getTime() - new Date(entry.lastSyncedAt).getTime()) / 1000;
  return ageSeconds > ttlSeconds;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cache/store.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/cache/paths.ts src/cache/store.ts tests/cache/store.test.ts
git commit -m "feat: add generic TTL-aware JSON cache store"
```

---

### Task 4: Rate limiter (rolling-hour request budget)

**Files:**
- Create: `src/cache/rateLimiter.ts`
- Test: `tests/cache/rateLimiter.test.ts`

**Interfaces:**
- Produces: `RateLimiterState { timestamps: string[] }`, `pruneOld(state,
  now)`, `canSpend(state, now, budgetPerHour)`, `recordRequest(state, now)`.

- [ ] **Step 1: Write the failing test**

`tests/cache/rateLimiter.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { pruneOld, canSpend, recordRequest, type RateLimiterState } from "../../src/cache/rateLimiter.js";

describe("rateLimiter", () => {
  it("prunes timestamps older than one hour", () => {
    const now = new Date("2026-07-26T12:00:00Z");
    const state: RateLimiterState = {
      timestamps: [
        "2026-07-26T10:30:00Z",
        "2026-07-26T11:30:00Z",
        "2026-07-26T11:59:00Z",
      ],
    };
    const pruned = pruneOld(state, now);
    expect(pruned.timestamps).toEqual(["2026-07-26T11:30:00Z", "2026-07-26T11:59:00Z"]);
  });

  it("canSpend is false once the budget is reached within the window", () => {
    const now = new Date("2026-07-26T12:00:00Z");
    const state: RateLimiterState = {
      timestamps: Array.from({ length: 5 }, () => "2026-07-26T11:50:00Z"),
    };
    expect(canSpend(state, now, 5)).toBe(false);
    expect(canSpend(state, now, 6)).toBe(true);
  });

  it("recordRequest appends a pruned timestamp for now", () => {
    const now = new Date("2026-07-26T12:00:00Z");
    const state: RateLimiterState = { timestamps: ["2020-01-01T00:00:00Z"] };
    const updated = recordRequest(state, now);
    expect(updated.timestamps).toEqual([now.toISOString()]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cache/rateLimiter.test.ts`
Expected: FAIL — `Cannot find module '../../src/cache/rateLimiter.js'`

- [ ] **Step 3: Implement cache/rateLimiter.ts**

`src/cache/rateLimiter.ts`:
```ts
export interface RateLimiterState {
  timestamps: string[];
}

const WINDOW_MS = 60 * 60 * 1000;

export function pruneOld(state: RateLimiterState, now: Date): RateLimiterState {
  const cutoff = now.getTime() - WINDOW_MS;
  return { timestamps: state.timestamps.filter((ts) => new Date(ts).getTime() > cutoff) };
}

export function canSpend(state: RateLimiterState, now: Date, budgetPerHour: number): boolean {
  return pruneOld(state, now).timestamps.length < budgetPerHour;
}

export function recordRequest(state: RateLimiterState, now: Date): RateLimiterState {
  const pruned = pruneOld(state, now);
  return { timestamps: [...pruned.timestamps, now.toISOString()] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cache/rateLimiter.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/cache/rateLimiter.ts tests/cache/rateLimiter.test.ts
git commit -m "feat: add rolling-hour rate limiter"
```

---

### Task 5: Cache orchestration (sync.ts) — the budget-spending boundary

**Files:**
- Create: `src/cache/sync.ts`
- Test: `tests/cache/sync.test.ts`

**Interfaces:**
- Consumes: `TogglApiClient`, `TogglMeResponse` (Task 1); `Project`,
  `TimeEntry` (Task 2); `mapProjects`, `mapTimeEntries` (Task 2);
  `readCacheEntry`, `writeCacheEntry`, `isStale`, `readJson`, `writeJson`
  (Task 3); `RateLimiterState`, `canSpend`, `recordRequest` (Task 4).
- Produces: `SyncContext { client: TogglApiClient; cacheDir: string;
  ttlSeconds: { projects: number; timeEntries: number }; budgetPerHour:
  number; now: () => Date }`, `DEFAULT_BUDGET_PER_HOUR = 25`,
  `refreshAll(ctx)`, `getProjects(ctx)`, `getTimeEntries(ctx)`.

- [ ] **Step 1: Write the failing test**

`tests/cache/sync.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjects, getTimeEntries, type SyncContext } from "../../src/cache/sync.js";
import type { TogglApiClient } from "../../src/api/client.js";
import type { TogglMeResponse } from "../../src/api/types.js";

function makeCtx(overrides: Partial<SyncContext> & { getMe: () => Promise<TogglMeResponse> }, cacheDir: string): SyncContext {
  const client: TogglApiClient = {
    getMe: overrides.getMe,
    createTimeEntry: vi.fn(),
    stopTimeEntry: vi.fn(),
  };
  return {
    client,
    cacheDir,
    ttlSeconds: { projects: 21600, timeEntries: 300 },
    budgetPerHour: 25,
    now: () => new Date("2026-07-26T12:00:00Z"),
    ...overrides,
  };
}

describe("cache/sync", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "togglr-sync-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("calls the API once and caches both projects and time entries when cache is empty", async () => {
    const getMe = vi.fn().mockResolvedValue({
      id: 1,
      default_workspace_id: 9,
      projects: [{ id: 1, name: "Web", color: "#fff", workspace_id: 9 }],
      time_entries: [{
        id: 1, description: "Coding", project_id: 1, workspace_id: 9,
        start: "2026-07-26T11:00:00Z", stop: "2026-07-26T11:30:00Z", duration: 1800, tags: [],
      }],
    } satisfies TogglMeResponse);
    const ctx = makeCtx({ getMe }, dir);

    const projects = await getProjects(ctx);
    const entries = await getTimeEntries(ctx);

    expect(projects).toEqual([{ id: 1, name: "Web", color: "#fff", workspaceId: 9 }]);
    expect(entries).toHaveLength(1);
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it("does not call the API when cache is fresh", async () => {
    const getMe = vi.fn().mockResolvedValue({ id: 1, default_workspace_id: 9, projects: [], time_entries: [] });
    const ctx = makeCtx({ getMe }, dir);
    await getProjects(ctx);
    await getProjects(ctx);
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it("serves stale cache instead of calling the API when the budget is exhausted", async () => {
    const getMe = vi.fn().mockResolvedValue({
      id: 1, default_workspace_id: 9,
      projects: [{ id: 1, name: "Web", color: "#fff", workspace_id: 9 }],
      time_entries: [],
    });
    let tick = 0;
    const ctx = makeCtx({
      getMe,
      budgetPerHour: 1,
      now: () => new Date(tick === 0 ? "2026-07-26T12:00:00Z" : "2026-07-26T12:00:01Z"),
    }, dir);

    tick = 0;
    await getProjects(ctx); // first call, spends the only unit of budget
    tick = 1;
    // force staleness by using a ttl of 0 seconds on a fresh context copy
    const staleCtx = { ...ctx, ttlSeconds: { projects: 0, timeEntries: 0 } };
    const projects = await getProjects(staleCtx);

    expect(projects).toEqual([{ id: 1, name: "Web", color: "#fff", workspaceId: 9 }]);
    expect(getMe).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cache/sync.test.ts`
Expected: FAIL — `Cannot find module '../../src/cache/sync.js'`

- [ ] **Step 3: Implement cache/sync.ts**

`src/cache/sync.ts`:
```ts
import path from "node:path";
import type { TogglApiClient } from "../api/client.js";
import { mapProjects, mapTimeEntries } from "../domain/mappers.js";
import type { Project, TimeEntry } from "../domain/models.js";
import { readCacheEntry, writeCacheEntry, isStale, readJson, writeJson } from "./store.js";
import { canSpend, recordRequest, type RateLimiterState } from "./rateLimiter.js";

export const DEFAULT_BUDGET_PER_HOUR = 25;

export interface SyncContext {
  client: TogglApiClient;
  cacheDir: string;
  ttlSeconds: { projects: number; timeEntries: number };
  budgetPerHour: number;
  now: () => Date;
}

function projectsFile(ctx: SyncContext): string {
  return path.join(ctx.cacheDir, "projects.json");
}

function timeEntriesFile(ctx: SyncContext): string {
  return path.join(ctx.cacheDir, "time_entries.json");
}

function rateLimitFile(ctx: SyncContext): string {
  return path.join(ctx.cacheDir, "rate_limit.json");
}

export async function refreshAll(
  ctx: SyncContext
): Promise<{ projects: Project[]; timeEntries: TimeEntry[] } | null> {
  const now = ctx.now();
  const rlState = (await readJson<RateLimiterState>(rateLimitFile(ctx))) ?? { timestamps: [] };
  if (!canSpend(rlState, now, ctx.budgetPerHour)) return null;

  const me = await ctx.client.getMe(true);
  await writeJson(rateLimitFile(ctx), recordRequest(rlState, now));

  const projects = mapProjects(me.projects ?? []);
  const timeEntries = mapTimeEntries(me.time_entries ?? []);
  await writeCacheEntry(projectsFile(ctx), projects, now);
  await writeCacheEntry(timeEntriesFile(ctx), timeEntries, now);
  return { projects, timeEntries };
}

export async function getProjects(ctx: SyncContext): Promise<Project[]> {
  const file = projectsFile(ctx);
  const now = ctx.now();
  const cached = await readCacheEntry<Project[]>(file);
  if (cached && !isStale(cached, ctx.ttlSeconds.projects, now)) return cached.data;
  const refreshed = await refreshAll(ctx);
  return refreshed?.projects ?? cached?.data ?? [];
}

export async function getTimeEntries(ctx: SyncContext): Promise<TimeEntry[]> {
  const file = timeEntriesFile(ctx);
  const now = ctx.now();
  const cached = await readCacheEntry<TimeEntry[]>(file);
  if (cached && !isStale(cached, ctx.ttlSeconds.timeEntries, now)) return cached.data;
  const refreshed = await refreshAll(ctx);
  return refreshed?.timeEntries ?? cached?.data ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cache/sync.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/cache/sync.ts tests/cache/sync.test.ts
git commit -m "feat: add cache orchestration with rate-limit-aware refresh"
```

---

### Task 6: Timer state (source of truth, no TTL)

**Files:**
- Create: `src/cache/timerState.ts`
- Test: `tests/cache/timerState.test.ts`

**Interfaces:**
- Consumes: `Timer` (Task 2), `readJson`/`writeJson` (Task 3).
- Produces: `readTimer(cacheDir)`, `writeTimer(cacheDir, timer | null)`.

- [ ] **Step 1: Write the failing test**

`tests/cache/timerState.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTimer, writeTimer } from "../../src/cache/timerState.js";
import type { Timer } from "../../src/domain/models.js";

describe("cache/timerState", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "togglr-timer-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when no timer is running", async () => {
    expect(await readTimer(dir)).toBeNull();
  });

  it("round-trips a running timer", async () => {
    const timer: Timer = {
      entryId: 1, description: "Coding", projectId: 5, workspaceId: 9,
      startedAt: "2026-07-26T10:00:00Z",
    };
    await writeTimer(dir, timer);
    expect(await readTimer(dir)).toEqual(timer);
  });

  it("removes the timer file when writing null", async () => {
    const timer: Timer = {
      entryId: 1, description: "Coding", projectId: null, workspaceId: 9,
      startedAt: "2026-07-26T10:00:00Z",
    };
    await writeTimer(dir, timer);
    await writeTimer(dir, null);
    expect(await readTimer(dir)).toBeNull();
    expect(existsSync(join(dir, "timer.json"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cache/timerState.test.ts`
Expected: FAIL — `Cannot find module '../../src/cache/timerState.js'`

- [ ] **Step 3: Implement cache/timerState.ts**

`src/cache/timerState.ts`:
```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { Timer } from "../domain/models.js";
import { readJson, writeJson } from "./store.js";

function timerFile(cacheDir: string): string {
  return path.join(cacheDir, "timer.json");
}

export async function readTimer(cacheDir: string): Promise<Timer | null> {
  return readJson<Timer>(timerFile(cacheDir));
}

export async function writeTimer(cacheDir: string, timer: Timer | null): Promise<void> {
  if (timer === null) {
    await fs.rm(timerFile(cacheDir), { force: true });
    return;
  }
  await writeJson(timerFile(cacheDir), timer);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cache/timerState.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/cache/timerState.ts tests/cache/timerState.test.ts
git commit -m "feat: add local timer state (source of truth for the active timer)"
```

---

### Task 7: Report aggregation

**Files:**
- Create: `src/domain/report.ts`
- Test: `tests/domain/report.test.ts`

**Interfaces:**
- Consumes: `TimeEntry`, `Project` (Task 2).
- Produces: `ProjectSummary { projectId: number | null; projectName: string;
  totalSeconds: number }`, `aggregateReport(entries, projects, from, to,
  now?)`.

- [ ] **Step 1: Write the failing test**

`tests/domain/report.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { aggregateReport } from "../../src/domain/report.js";
import type { TimeEntry, Project } from "../../src/domain/models.js";

const projects: Project[] = [{ id: 1, name: "Website", color: "#fff", workspaceId: 9 }];

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: 1, description: "Coding", projectId: 1, workspaceId: 9,
    start: "2026-07-26T10:00:00Z", stop: "2026-07-26T10:30:00Z",
    durationSeconds: 1800, tags: [], ...overrides,
  };
}

describe("aggregateReport", () => {
  it("sums durations per project within the date range", () => {
    const entries = [entry({ durationSeconds: 1800 }), entry({ id: 2, durationSeconds: 900 })];
    const from = new Date("2026-07-26T00:00:00Z");
    const to = new Date("2026-07-26T23:59:59Z");
    const result = aggregateReport(entries, projects, from, to);
    expect(result).toEqual([{ projectId: 1, projectName: "Website", totalSeconds: 2700 }]);
  });

  it("excludes entries outside the date range", () => {
    const entries = [entry({ start: "2026-07-20T10:00:00Z" })];
    const from = new Date("2026-07-26T00:00:00Z");
    const to = new Date("2026-07-26T23:59:59Z");
    expect(aggregateReport(entries, projects, from, to)).toEqual([]);
  });

  it("labels entries with no project as 'No project'", () => {
    const entries = [entry({ projectId: null })];
    const from = new Date("2026-07-26T00:00:00Z");
    const to = new Date("2026-07-26T23:59:59Z");
    const result = aggregateReport(entries, projects, from, to);
    expect(result[0]).toMatchObject({ projectId: null, projectName: "No project" });
  });

  it("computes live duration for a still-running entry using `now`", () => {
    const entries = [entry({ stop: null, durationSeconds: null, start: "2026-07-26T10:00:00Z" })];
    const from = new Date("2026-07-26T00:00:00Z");
    const to = new Date("2026-07-26T23:59:59Z");
    const now = new Date("2026-07-26T10:05:00Z");
    const result = aggregateReport(entries, projects, from, to, now);
    expect(result[0].totalSeconds).toBe(300);
  });

  it("sorts results by totalSeconds descending", () => {
    const entries = [
      entry({ id: 1, projectId: 1, durationSeconds: 100 }),
      entry({ id: 2, projectId: null, durationSeconds: 500 }),
    ];
    const from = new Date("2026-07-26T00:00:00Z");
    const to = new Date("2026-07-26T23:59:59Z");
    const result = aggregateReport(entries, projects, from, to);
    expect(result[0].projectId).toBeNull();
    expect(result[1].projectId).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/report.test.ts`
Expected: FAIL — `Cannot find module '../../src/domain/report.js'`

- [ ] **Step 3: Implement domain/report.ts**

`src/domain/report.ts`:
```ts
import type { Project, TimeEntry } from "./models.js";

export interface ProjectSummary {
  projectId: number | null;
  projectName: string;
  totalSeconds: number;
}

export function aggregateReport(
  entries: TimeEntry[],
  projects: Project[],
  from: Date,
  to: Date,
  now: Date = new Date()
): ProjectSummary[] {
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  const totals = new Map<number | null, number>();

  for (const entryItem of entries) {
    const start = new Date(entryItem.start);
    if (start < from || start > to) continue;
    const duration = entryItem.durationSeconds ?? (now.getTime() - start.getTime()) / 1000;
    totals.set(entryItem.projectId, (totals.get(entryItem.projectId) ?? 0) + duration);
  }

  return [...totals.entries()]
    .map(([projectId, totalSeconds]) => ({
      projectId,
      projectName: projectId !== null ? nameById.get(projectId) ?? "Unknown" : "No project",
      totalSeconds,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/report.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/report.ts tests/domain/report.test.ts
git commit -m "feat: add local time-entry report aggregation"
```

---

### Task 8: Config storage and first-run token prompt

**Files:**
- Create: `src/config/config.ts`
- Create: `src/config/ensureConfig.ts`
- Test: `tests/config/config.test.ts`
- Test: `tests/config/ensureConfig.test.ts`

**Interfaces:**
- Consumes: `readJson`/`writeJson` (Task 3), `TogglMeResponse` (Task 1).
- Produces: `Config { apiToken: string; workspaceId: number; cacheTtl: {
  projects: number; timeEntries: number } }`, `DEFAULT_TTL`,
  `readConfig(configDir)`, `writeConfig(configDir, config)`,
  `ensureConfig(configDir, deps?)`.

- [ ] **Step 1: Write the failing tests**

`tests/config/config.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, writeConfig, DEFAULT_TTL } from "../../src/config/config.js";

describe("config/config", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "togglr-config-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when no config file exists", async () => {
    expect(await readConfig(dir)).toBeNull();
  });

  it("round-trips config and writes it with file mode 600", async () => {
    const config = { apiToken: "abc", workspaceId: 1, cacheTtl: DEFAULT_TTL };
    await writeConfig(dir, config);
    expect(await readConfig(dir)).toEqual(config);
    const mode = statSync(join(dir, "config.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
```

`tests/config/ensureConfig.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureConfig } from "../../src/config/ensureConfig.js";
import { readConfig } from "../../src/config/config.js";

describe("ensureConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "togglr-ensure-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the existing config without prompting when one is present", async () => {
    const { writeConfig, DEFAULT_TTL } = await import("../../src/config/config.js");
    const existing = { apiToken: "existing", workspaceId: 7, cacheTtl: DEFAULT_TTL };
    await writeConfig(dir, existing);
    const prompt = vi.fn();
    const result = await ensureConfig(dir, { prompt });
    expect(result).toEqual(existing);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("prompts for a token, fetches the default workspace, and persists config", async () => {
    const prompt = vi.fn().mockResolvedValue("newtoken");
    const getMe = vi.fn().mockResolvedValue({ id: 1, default_workspace_id: 42 });
    const createClient = vi.fn().mockReturnValue({ getMe });

    const result = await ensureConfig(dir, { prompt, createClient });

    expect(result.apiToken).toBe("newtoken");
    expect(result.workspaceId).toBe(42);
    expect(createClient).toHaveBeenCalledWith("newtoken");
    expect(await readConfig(dir)).toEqual(result);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config`
Expected: FAIL — `Cannot find module '../../src/config/config.js'`

- [ ] **Step 3: Implement config/config.ts and config/ensureConfig.ts**

`src/config/config.ts`:
```ts
import fs from "node:fs/promises";
import path from "node:path";
import { readJson } from "../cache/store.js";

export interface Config {
  apiToken: string;
  workspaceId: number;
  cacheTtl: { projects: number; timeEntries: number };
}

export const DEFAULT_TTL = { projects: 21600, timeEntries: 300 };

function configFile(configDir: string): string {
  return path.join(configDir, "config.json");
}

export async function readConfig(configDir: string): Promise<Config | null> {
  return readJson<Config>(configFile(configDir));
}

export async function writeConfig(configDir: string, config: Config): Promise<void> {
  const file = configFile(configDir);
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2), "utf-8");
  await fs.chmod(file, 0o600);
}
```

`src/config/ensureConfig.ts`:
```ts
import readline from "node:readline/promises";
import { TogglClient, type TogglApiClient } from "../api/client.js";
import { readConfig, writeConfig, DEFAULT_TTL, type Config } from "./config.js";

export interface EnsureConfigDeps {
  prompt?: (question: string) => Promise<string>;
  createClient?: (token: string) => Pick<TogglApiClient, "getMe">;
}

async function defaultPrompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

export async function ensureConfig(configDir: string, deps: EnsureConfigDeps = {}): Promise<Config> {
  const existing = await readConfig(configDir);
  if (existing) return existing;

  const prompt = deps.prompt ?? defaultPrompt;
  const createClient = deps.createClient ?? ((token: string) => new TogglClient(token));

  const token = await prompt("Paste your Toggl API token (Profile -> API Token): ");
  const client = createClient(token);
  const me = await client.getMe(false);

  const config: Config = { apiToken: token, workspaceId: me.default_workspace_id, cacheTtl: DEFAULT_TTL };
  await writeConfig(configDir, config);
  return config;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config tests/config
git commit -m "feat: add config storage and first-run token prompt"
```

---

### Task 9: start and stop commands

**Files:**
- Create: `src/commands/start.ts`
- Create: `src/commands/stop.ts`
- Test: `tests/commands/start.test.ts`
- Test: `tests/commands/stop.test.ts`

**Interfaces:**
- Consumes: `SyncContext`, `getProjects` (Task 5); `readTimer`, `writeTimer`
  (Task 6); `Config` (Task 8); `mapTimeEntry` (Task 2).
- Produces: `StartOptions { description: string; projectName?: string }`,
  `createTimer(ctx, config, description, projectId?)`, `runStart(ctx,
  config, opts)`, `runStop(ctx, config)`.

- [ ] **Step 1: Write the failing tests**

`tests/commands/start.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStart, createTimer } from "../../src/commands/start.js";
import { readTimer } from "../../src/cache/timerState.js";
import type { SyncContext } from "../../src/cache/sync.js";
import type { Config } from "../../src/config/config.js";

function makeCtx(cacheDir: string, client: Partial<SyncContext["client"]>): SyncContext {
  return {
    client: { getMe: vi.fn(), createTimeEntry: vi.fn(), stopTimeEntry: vi.fn(), ...client } as any,
    cacheDir,
    ttlSeconds: { projects: 21600, timeEntries: 300 },
    budgetPerHour: 25,
    now: () => new Date("2026-07-26T12:00:00Z"),
  };
}

const config: Config = { apiToken: "t", workspaceId: 9, cacheTtl: { projects: 21600, timeEntries: 300 } };

describe("commands/start", () => {
  it("createTimer creates a time entry and writes the local timer state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-start-test-"));
    const createTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "Coding", project_id: 5, workspace_id: 9,
      start: "2026-07-26T12:00:00Z", stop: null, duration: -1, tags: [],
    });
    const ctx = makeCtx(dir, { createTimeEntry });

    const timer = await createTimer(ctx, config, "Coding", 5);

    expect(timer.entryId).toBe(1);
    expect(await readTimer(dir)).toEqual(timer);
    rmSync(dir, { recursive: true, force: true });
  });

  it("runStart resolves a project name to its id before creating the timer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-start-test-"));
    const createTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "Coding", project_id: 5, workspace_id: 9,
      start: "2026-07-26T12:00:00Z", stop: null, duration: -1, tags: [],
    });
    const getMe = vi.fn().mockResolvedValue({
      id: 1, default_workspace_id: 9,
      projects: [{ id: 5, name: "Website", color: "#fff", workspace_id: 9 }],
      time_entries: [],
    });
    const ctx = makeCtx(dir, { createTimeEntry, getMe });

    await runStart(ctx, config, { description: "Coding", projectName: "Website" });

    expect(createTimeEntry).toHaveBeenCalledWith(9, { description: "Coding", project_id: 5 });
    rmSync(dir, { recursive: true, force: true });
  });

  it("runStart throws when the project name does not match any cached project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-start-test-"));
    const getMe = vi.fn().mockResolvedValue({ id: 1, default_workspace_id: 9, projects: [], time_entries: [] });
    const ctx = makeCtx(dir, { getMe });

    await expect(runStart(ctx, config, { description: "Coding", projectName: "Nope" }))
      .rejects.toThrow("Unknown project: Nope");
    rmSync(dir, { recursive: true, force: true });
  });

  it("createTimer refuses to start a second timer while one is already running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-start-test-"));
    const createTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "First", project_id: null, workspace_id: 9,
      start: "2026-07-26T12:00:00Z", stop: null, duration: -1, tags: [],
    });
    const ctx = makeCtx(dir, { createTimeEntry });
    await createTimer(ctx, config, "First", undefined);
    await expect(createTimer(ctx, config, "Second", undefined))
      .rejects.toThrow(/already running/);
    expect(createTimeEntry).toHaveBeenCalledTimes(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

`tests/commands/stop.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStop } from "../../src/commands/stop.js";
import { writeTimer, readTimer } from "../../src/cache/timerState.js";
import { writeCacheEntry } from "../../src/cache/store.js";
import type { SyncContext } from "../../src/cache/sync.js";
import type { Config } from "../../src/config/config.js";

const config: Config = { apiToken: "t", workspaceId: 9, cacheTtl: { projects: 21600, timeEntries: 300 } };

describe("commands/stop", () => {
  it("stops the running timer, clears local state, and invalidates the entries cache", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-stop-test-"));
    await writeTimer(dir, {
      entryId: 1, description: "Coding", projectId: 5, workspaceId: 9,
      startedAt: "2026-07-26T11:00:00Z",
    });
    await writeCacheEntry(join(dir, "time_entries.json"), []);
    const stopTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "Coding", project_id: 5, workspace_id: 9,
      start: "2026-07-26T11:00:00Z", stop: "2026-07-26T12:00:00Z", duration: 3600, tags: [],
    });
    const ctx: SyncContext = {
      client: { getMe: vi.fn(), createTimeEntry: vi.fn(), stopTimeEntry } as any,
      cacheDir: dir,
      ttlSeconds: { projects: 21600, timeEntries: 300 },
      budgetPerHour: 25,
      now: () => new Date("2026-07-26T12:00:00Z"),
    };

    const entry = await runStop(ctx, config);

    expect(entry.durationSeconds).toBe(3600);
    expect(stopTimeEntry).toHaveBeenCalledWith(9, 1);
    expect(await readTimer(dir)).toBeNull();
    expect(existsSync(join(dir, "time_entries.json"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when no timer is running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-stop-test-"));
    const ctx: SyncContext = {
      client: { getMe: vi.fn(), createTimeEntry: vi.fn(), stopTimeEntry: vi.fn() } as any,
      cacheDir: dir,
      ttlSeconds: { projects: 21600, timeEntries: 300 },
      budgetPerHour: 25,
      now: () => new Date(),
    };
    await expect(runStop(ctx, config)).rejects.toThrow("No timer is currently running.");
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/start.test.ts tests/commands/stop.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement commands/start.ts and commands/stop.ts**

`src/commands/start.ts`:
```ts
import type { SyncContext } from "../cache/sync.js";
import { getProjects } from "../cache/sync.js";
import { readTimer, writeTimer } from "../cache/timerState.js";
import type { Config } from "../config/config.js";
import type { Timer } from "../domain/models.js";

export interface StartOptions {
  description: string;
  projectName?: string;
}

export async function createTimer(
  ctx: SyncContext,
  config: Config,
  description: string,
  projectId: number | null | undefined
): Promise<Timer> {
  const existing = await readTimer(ctx.cacheDir);
  if (existing) {
    throw new Error(`A timer is already running: "${existing.description}". Stop it first.`);
  }
  const raw = await ctx.client.createTimeEntry(config.workspaceId, {
    description,
    project_id: projectId ?? undefined,
  });
  const timer: Timer = {
    entryId: raw.id,
    description: raw.description,
    projectId: raw.project_id,
    workspaceId: raw.workspace_id,
    startedAt: raw.start,
  };
  await writeTimer(ctx.cacheDir, timer);
  return timer;
}

export async function runStart(ctx: SyncContext, config: Config, opts: StartOptions): Promise<Timer> {
  let projectId: number | undefined;
  if (opts.projectName) {
    const projects = await getProjects(ctx);
    const match = projects.find((p) => p.name.toLowerCase() === opts.projectName!.toLowerCase());
    if (!match) throw new Error(`Unknown project: ${opts.projectName}`);
    projectId = match.id;
  }
  return createTimer(ctx, config, opts.description, projectId);
}
```

`src/commands/stop.ts`:
```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { SyncContext } from "../cache/sync.js";
import { readTimer, writeTimer } from "../cache/timerState.js";
import { mapTimeEntry } from "../domain/mappers.js";
import type { TimeEntry } from "../domain/models.js";
import type { Config } from "../config/config.js";

export async function runStop(ctx: SyncContext, config: Config): Promise<TimeEntry> {
  const timer = await readTimer(ctx.cacheDir);
  if (!timer) throw new Error("No timer is currently running.");

  const raw = await ctx.client.stopTimeEntry(config.workspaceId, timer.entryId);
  const entry = mapTimeEntry(raw);

  await writeTimer(ctx.cacheDir, null);
  await fs.rm(path.join(ctx.cacheDir, "time_entries.json"), { force: true });

  return entry;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands/start.test.ts tests/commands/stop.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/commands/start.ts src/commands/stop.ts tests/commands/start.test.ts tests/commands/stop.test.ts
git commit -m "feat: add start and stop commands"
```

---

### Task 10: status and list-projects commands

**Files:**
- Create: `src/commands/status.ts`
- Create: `src/commands/listProjects.ts`
- Test: `tests/commands/status.test.ts`

**Interfaces:**
- Consumes: `SyncContext`, `getProjects` (Task 5); `readTimer` (Task 6).
- Produces: `formatDuration(totalSeconds)`, `runStatus(ctx)`,
  `runListProjects(ctx)`.

- [ ] **Step 1: Write the failing test**

`tests/commands/status.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStatus, formatDuration } from "../../src/commands/status.js";
import { writeTimer } from "../../src/cache/timerState.js";
import type { SyncContext } from "../../src/cache/sync.js";

describe("formatDuration", () => {
  it("formats seconds as HH:MM:SS", () => {
    expect(formatDuration(3661)).toBe("01:01:01");
    expect(formatDuration(59)).toBe("00:00:59");
  });
});

describe("runStatus", () => {
  it("returns 'No timer running.' when nothing is active", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-status-test-"));
    const ctx: SyncContext = {
      client: { getMe: vi.fn(), createTimeEntry: vi.fn(), stopTimeEntry: vi.fn() } as any,
      cacheDir: dir, ttlSeconds: { projects: 21600, timeEntries: 300 }, budgetPerHour: 25,
      now: () => new Date("2026-07-26T12:00:00Z"),
    };
    expect(await runStatus(ctx)).toBe("No timer running.");
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports description and elapsed time for a running timer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-status-test-"));
    await writeTimer(dir, {
      entryId: 1, description: "Coding", projectId: null, workspaceId: 9,
      startedAt: "2026-07-26T11:59:00Z",
    });
    const ctx: SyncContext = {
      client: { getMe: vi.fn(), createTimeEntry: vi.fn(), stopTimeEntry: vi.fn() } as any,
      cacheDir: dir, ttlSeconds: { projects: 21600, timeEntries: 300 }, budgetPerHour: 25,
      now: () => new Date("2026-07-26T12:00:30Z"),
    };
    expect(await runStatus(ctx)).toBe("Coding — 00:01:30");
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/status.test.ts`
Expected: FAIL — `Cannot find module '../../src/commands/status.js'`

- [ ] **Step 3: Implement commands/status.ts and commands/listProjects.ts**

`src/commands/status.ts`:
```ts
import type { SyncContext } from "../cache/sync.js";
import { readTimer } from "../cache/timerState.js";

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export async function runStatus(ctx: SyncContext): Promise<string> {
  const timer = await readTimer(ctx.cacheDir);
  if (!timer) return "No timer running.";
  const elapsedSeconds = Math.floor((ctx.now().getTime() - new Date(timer.startedAt).getTime()) / 1000);
  return `${timer.description} — ${formatDuration(elapsedSeconds)}`;
}
```

`src/commands/listProjects.ts`:
```ts
import type { SyncContext } from "../cache/sync.js";
import { getProjects } from "../cache/sync.js";
import type { Project } from "../domain/models.js";

export async function runListProjects(ctx: SyncContext): Promise<Project[]> {
  return getProjects(ctx);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/status.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/commands/status.ts src/commands/listProjects.ts tests/commands/status.test.ts
git commit -m "feat: add status and list-projects commands"
```

---

### Task 11: continue and report commands

**Files:**
- Create: `src/commands/continueLast.ts`
- Create: `src/commands/report.ts`
- Test: `tests/commands/continueLast.test.ts`
- Test: `tests/commands/report.test.ts`

**Interfaces:**
- Consumes: `createTimer` (Task 9); `getTimeEntries`, `getProjects` (Task 5);
  `aggregateReport` (Task 7).
- Produces: `runContinue(ctx, config)`, `ReportRange = "today" | "week"`,
  `resolveRange(range, now)`, `runReport(ctx, range)`.

- [ ] **Step 1: Write the failing tests**

`tests/commands/continueLast.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runContinue } from "../../src/commands/continueLast.js";
import { writeCacheEntry } from "../../src/cache/store.js";
import type { SyncContext } from "../../src/cache/sync.js";
import type { Config } from "../../src/config/config.js";

const config: Config = { apiToken: "t", workspaceId: 9, cacheTtl: { projects: 21600, timeEntries: 300 } };

describe("commands/continueLast", () => {
  it("starts a new timer with the same description and project as the most recent entry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-continue-test-"));
    await writeCacheEntry(join(dir, "time_entries.json"), [
      { id: 1, description: "Older", projectId: null, workspaceId: 9, start: "2026-07-26T09:00:00Z", stop: "2026-07-26T09:30:00Z", durationSeconds: 1800, tags: [] },
      { id: 2, description: "Newer", projectId: 5, workspaceId: 9, start: "2026-07-26T11:00:00Z", stop: "2026-07-26T11:15:00Z", durationSeconds: 900, tags: [] },
    ]);
    const createTimeEntry = vi.fn().mockResolvedValue({
      id: 3, description: "Newer", project_id: 5, workspace_id: 9,
      start: "2026-07-26T12:00:00Z", stop: null, duration: -1, tags: [],
    });
    const ctx: SyncContext = {
      client: { getMe: vi.fn(), createTimeEntry, stopTimeEntry: vi.fn() } as any,
      cacheDir: dir, ttlSeconds: { projects: 21600, timeEntries: 300 }, budgetPerHour: 25,
      now: () => new Date("2026-07-26T12:00:00Z"),
    };

    const timer = await runContinue(ctx, config);

    expect(createTimeEntry).toHaveBeenCalledWith(9, { description: "Newer", project_id: 5 });
    expect(timer.description).toBe("Newer");
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when there is no previous entry to continue", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-continue-test-"));
    await writeCacheEntry(join(dir, "time_entries.json"), []);
    const ctx: SyncContext = {
      client: { getMe: vi.fn(), createTimeEntry: vi.fn(), stopTimeEntry: vi.fn() } as any,
      cacheDir: dir, ttlSeconds: { projects: 21600, timeEntries: 300 }, budgetPerHour: 25,
      now: () => new Date("2026-07-26T12:00:00Z"),
    };
    await expect(runContinue(ctx, config)).rejects.toThrow("No previous time entry to continue.");
    rmSync(dir, { recursive: true, force: true });
  });
});
```

`tests/commands/report.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReport, resolveRange } from "../../src/commands/report.js";
import { writeCacheEntry } from "../../src/cache/store.js";
import type { SyncContext } from "../../src/cache/sync.js";

describe("resolveRange", () => {
  it("'today' spans from local midnight to now", () => {
    const now = new Date("2026-07-26T15:30:00");
    const { from, to } = resolveRange("today", now);
    expect(from.getHours()).toBe(0);
    expect(to).toEqual(now);
  });

  it("'week' spans from Monday midnight to now", () => {
    // 2026-07-26 is a Sunday
    const now = new Date("2026-07-26T15:30:00");
    const { from } = resolveRange("week", now);
    expect(from.getDay()).toBe(1); // Monday
    expect(from.getDate()).toBe(20);
  });
});

describe("runReport", () => {
  it("aggregates cached time entries and projects for the given range", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-report-test-"));
    await writeCacheEntry(join(dir, "projects.json"), [{ id: 1, name: "Website", color: "#fff", workspaceId: 9 }]);
    await writeCacheEntry(join(dir, "time_entries.json"), [
      { id: 1, description: "Coding", projectId: 1, workspaceId: 9, start: "2026-07-26T10:00:00Z", stop: "2026-07-26T10:30:00Z", durationSeconds: 1800, tags: [] },
    ]);
    const ctx: SyncContext = {
      client: { getMe: vi.fn(), createTimeEntry: vi.fn(), stopTimeEntry: vi.fn() } as any,
      cacheDir: dir, ttlSeconds: { projects: 21600, timeEntries: 300 }, budgetPerHour: 25,
      now: () => new Date("2026-07-26T12:00:00Z"),
    };

    const result = await runReport(ctx, "today");

    expect(result).toEqual([{ projectId: 1, projectName: "Website", totalSeconds: 1800 }]);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/continueLast.test.ts tests/commands/report.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement commands/continueLast.ts and commands/report.ts**

`src/commands/continueLast.ts`:
```ts
import type { SyncContext } from "../cache/sync.js";
import { getTimeEntries } from "../cache/sync.js";
import { createTimer } from "./start.js";
import type { Config } from "../config/config.js";
import type { Timer } from "../domain/models.js";

export async function runContinue(ctx: SyncContext, config: Config): Promise<Timer> {
  const entries = await getTimeEntries(ctx);
  const last = [...entries].sort(
    (a, b) => new Date(b.start).getTime() - new Date(a.start).getTime()
  )[0];
  if (!last) throw new Error("No previous time entry to continue.");
  return createTimer(ctx, config, last.description, last.projectId);
}
```

`src/commands/report.ts`:
```ts
import type { SyncContext } from "../cache/sync.js";
import { getProjects, getTimeEntries } from "../cache/sync.js";
import { aggregateReport, type ProjectSummary } from "../domain/report.js";

export type ReportRange = "today" | "week";

export function resolveRange(range: ReportRange, now: Date): { from: Date; to: Date } {
  const to = now;
  const from = new Date(now);
  if (range === "today") {
    from.setHours(0, 0, 0, 0);
  } else {
    const day = from.getDay();
    const diffToMonday = (day + 6) % 7;
    from.setDate(from.getDate() - diffToMonday);
    from.setHours(0, 0, 0, 0);
  }
  return { from, to };
}

export async function runReport(ctx: SyncContext, range: ReportRange): Promise<ProjectSummary[]> {
  const [entries, projects] = await Promise.all([getTimeEntries(ctx), getProjects(ctx)]);
  const { from, to } = resolveRange(range, ctx.now());
  return aggregateReport(entries, projects, from, to, ctx.now());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands/continueLast.test.ts tests/commands/report.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/commands/continueLast.ts src/commands/report.ts tests/commands/continueLast.test.ts tests/commands/report.test.ts
git commit -m "feat: add continue and report commands"
```

---

### Task 12: CLI wiring (bootstrap + Commander)

**Files:**
- Create: `src/bootstrap.ts`
- Create: `src/cli.ts`
- Test: `tests/bootstrap.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–11.
- Produces: `buildContext()` returning `{ ctx: SyncContext; config: Config }`.

- [ ] **Step 1: Write the failing test**

`tests/bootstrap.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContext } from "../src/bootstrap.js";
import { writeConfig } from "../src/config/config.js";

describe("buildContext", () => {
  let configDir: string;
  let cacheDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "togglr-bootstrap-config-"));
    cacheDir = mkdtempSync(join(tmpdir(), "togglr-bootstrap-cache-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("builds a SyncContext from an existing config without prompting", async () => {
    await writeConfig(configDir, {
      apiToken: "t", workspaceId: 9, cacheTtl: { projects: 21600, timeEntries: 300 },
    });
    const { ctx, config } = await buildContext({ configDir, cacheDir });
    expect(config.workspaceId).toBe(9);
    expect(ctx.cacheDir).toBe(cacheDir);
    expect(ctx.budgetPerHour).toBe(25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bootstrap.test.ts`
Expected: FAIL — `Cannot find module '../src/bootstrap.js'`

- [ ] **Step 3: Implement bootstrap.ts and cli.ts**

`src/bootstrap.ts`:
```ts
import { TogglClient } from "./api/client.js";
import { getCacheDir, getConfigDir } from "./cache/paths.js";
import { DEFAULT_BUDGET_PER_HOUR, type SyncContext } from "./cache/sync.js";
import { ensureConfig } from "./config/ensureConfig.js";
import type { Config } from "./config/config.js";

export interface BootstrapOverrides {
  configDir?: string;
  cacheDir?: string;
}

export async function buildContext(
  overrides: BootstrapOverrides = {}
): Promise<{ ctx: SyncContext; config: Config }> {
  const configDir = getConfigDir(overrides.configDir);
  const cacheDir = getCacheDir(overrides.cacheDir);
  const config = await ensureConfig(configDir);
  const client = new TogglClient(config.apiToken);
  const ctx: SyncContext = {
    client,
    cacheDir,
    ttlSeconds: config.cacheTtl,
    budgetPerHour: DEFAULT_BUDGET_PER_HOUR,
    now: () => new Date(),
  };
  return { ctx, config };
}
```

`src/cli.ts`:
```ts
#!/usr/bin/env node
import { Command } from "commander";
import { buildContext } from "./bootstrap.js";
import { runStart } from "./commands/start.js";
import { runStop } from "./commands/stop.js";
import { runStatus, formatDuration } from "./commands/status.js";
import { runListProjects } from "./commands/listProjects.js";
import { runContinue } from "./commands/continueLast.js";
import { runReport, type ReportRange } from "./commands/report.js";

const program = new Command();
program.name("toggl");

program
  .command("start <description>")
  .option("--project <name>")
  .action(async (description: string, opts: { project?: string }) => {
    const { ctx, config } = await buildContext();
    const timer = await runStart(ctx, config, { description, projectName: opts.project });
    console.log(`Started: ${timer.description}`);
  });

program.command("stop").action(async () => {
  const { ctx, config } = await buildContext();
  const entry = await runStop(ctx, config);
  console.log(`Stopped: ${entry.description}`);
});

program.command("status").action(async () => {
  const { ctx } = await buildContext();
  console.log(await runStatus(ctx));
});

program.command("list-projects").action(async () => {
  const { ctx } = await buildContext();
  const projects = await runListProjects(ctx);
  projects.forEach((p) => console.log(p.name));
});

program.command("continue").action(async () => {
  const { ctx, config } = await buildContext();
  const timer = await runContinue(ctx, config);
  console.log(`Continuing: ${timer.description}`);
});

program
  .command("report [range]")
  .action(async (range: string = "today") => {
    const { ctx } = await buildContext();
    const summaries = await runReport(ctx, range as ReportRange);
    summaries.forEach((s) => console.log(`${s.projectName}: ${formatDuration(Math.round(s.totalSeconds))}`));
  });

async function main() {
  if (process.argv.length <= 2) {
    const { renderDashboard } = await import("./tui/App.js");
    const { ctx, config } = await buildContext();
    renderDashboard(ctx, config);
  } else {
    await program.parseAsync();
  }
}

main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bootstrap.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: all tests pass, no type errors (the `tui/App.js` import in `cli.ts`
will fail typecheck until Task 14 creates it — if so, proceed to Task 13/14
before considering this step fully green, and re-run this command at the end
of Task 14).

- [ ] **Step 6: Commit**

```bash
git add src/bootstrap.ts src/cli.ts tests/bootstrap.test.ts
git commit -m "feat: wire CLI commands with Commander and bootstrap context"
```

---

### Task 13: TUI Dashboard (presentational component)

**Files:**
- Create: `src/tui/Dashboard.tsx`
- Test: `tests/tui/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `Timer`, `TimeEntry` (Task 2), `ProjectSummary` (Task 7),
  `formatDuration` (Task 10), `TextInput` from `ink-text-input`.
- Produces: `RecentEntryView { description: string; totalSeconds: number;
  projectId: number | null }`, `DashboardProps { timer: Timer | null;
  elapsedSeconds: number; todayTotalSeconds: number; weekTotalSeconds:
  number; recentEntries: RecentEntryView[]; stale: boolean; selectedIndex:
  number; inputMode: boolean; inputValue: string; onInputChange: (value:
  string) => void; onInputSubmit: (value: string) => void }`, `Dashboard`
  component (pure/presentational — receives already-loaded data and
  callbacks as props, does not fetch anything or manage state itself).

- [ ] **Step 1: Write the failing test**

`tests/tui/Dashboard.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { Dashboard } from "../../src/tui/Dashboard.js";

const noop = () => {};

describe("Dashboard", () => {
  it("shows 'No timer running' when there is no active timer", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null}
        elapsedSeconds={0}
        todayTotalSeconds={0}
        weekTotalSeconds={0}
        recentEntries={[]}
        stale={false}
        selectedIndex={0}
        inputMode={false}
        inputValue=""
        onInputChange={noop}
        onInputSubmit={noop}
      />
    );
    expect(lastFrame()).toContain("No timer running");
  });

  it("shows the active timer description and elapsed time", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={{ entryId: 1, description: "Coding on togglr", projectId: null, workspaceId: 9, startedAt: "2026-07-26T11:00:00Z" }}
        elapsedSeconds={2537}
        todayTotalSeconds={11520}
        weekTotalSeconds={50700}
        recentEntries={[{ description: "Standup", totalSeconds: 900, projectId: null }]}
        stale={false}
        selectedIndex={0}
        inputMode={false}
        inputValue=""
        onInputChange={noop}
        onInputSubmit={noop}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Coding on togglr");
    expect(frame).toContain("00:42:17");
    expect(frame).toContain("Standup");
  });

  it("shows a stale indicator when the cache could not be refreshed", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={true} selectedIndex={0}
        inputMode={false} inputValue="" onInputChange={noop} onInputSubmit={noop}
      />
    );
    expect(lastFrame()).toContain("stale");
  });

  it("shows an inline prompt with the current input value when in new-timer input mode", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={false} selectedIndex={0}
        inputMode={true} inputValue="Coding" onInputChange={noop} onInputSubmit={noop}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("New timer");
    expect(frame).toContain("Coding");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/Dashboard.test.tsx`
Expected: FAIL — `Cannot find module '../../src/tui/Dashboard.js'`

- [ ] **Step 3: Implement tui/Dashboard.tsx**

`src/tui/Dashboard.tsx`:
```tsx
import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { Timer } from "../domain/models.js";
import { formatDuration } from "../commands/status.js";

export interface RecentEntryView {
  description: string;
  totalSeconds: number;
  projectId: number | null;
}

export interface DashboardProps {
  timer: Timer | null;
  elapsedSeconds: number;
  todayTotalSeconds: number;
  weekTotalSeconds: number;
  recentEntries: RecentEntryView[];
  stale: boolean;
  selectedIndex: number;
  inputMode: boolean;
  inputValue: string;
  onInputChange: (value: string) => void;
  onInputSubmit: (value: string) => void;
}

export function Dashboard(props: DashboardProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Box justifyContent="space-between">
        <Text>
          {props.timer ? `● ${props.timer.description}` : "No timer running"}
        </Text>
        <Text>{props.timer ? formatDuration(props.elapsedSeconds) : ""}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Today: {formatDuration(props.todayTotalSeconds)}  |  Week: {formatDuration(props.weekTotalSeconds)}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text underline>Recent entries</Text>
        {props.recentEntries.length === 0 && <Text dimColor>No recent entries</Text>}
        {props.recentEntries.map((entry, i) => (
          <Text key={i} inverse={i === props.selectedIndex}>
            {entry.description} — {formatDuration(entry.totalSeconds)}
          </Text>
        ))}
      </Box>
      {props.stale && (
        <Box marginTop={1}>
          <Text color="yellow">offline / stale data</Text>
        </Box>
      )}
      {props.inputMode ? (
        <Box marginTop={1}>
          <Text>New timer: </Text>
          <TextInput value={props.inputValue} onChange={props.onInputChange} onSubmit={props.onInputSubmit} />
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>[s] stop  [c] continue  [n] new  [r] refresh  [q] quit</Text>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/Dashboard.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tui/Dashboard.tsx tests/tui/Dashboard.test.tsx
git commit -m "feat: add presentational TUI dashboard component"
```

---

### Task 14: TUI App container (data loading + keybindings) and manual verification

**Files:**
- Create: `src/tui/App.tsx`

**Interfaces:**
- Consumes: `SyncContext`, `getProjects`, `getTimeEntries` (Task 5); `Config`
  (Task 8); `readTimer` (Task 6); `aggregateReport`, `resolveRange` (Task 7,
  11); `runStop` (Task 9); `createTimer` (Task 9); `Dashboard`,
  `RecentEntryView` (Task 13).
- Produces: `renderDashboard(ctx, config)`.

Keybinding semantics: `c` continues whichever entry is currently highlighted
by `j`/`k` (not necessarily the most recent one) by calling `createTimer`
directly with that entry's description and project — this is a TUI-only
behavior distinct from the one-shot `toggl continue` CLI command (Task 11),
which always continues the single most recent entry since there is no
selection concept outside the dashboard. `n` opens an inline text prompt
(description only — project selection in the inline form is out of scope
for MVP; use `toggl start --project` from the shell for that case).

This task has no automated test — per the spec, full TUI interaction
coverage is out of scope for MVP given low ROI relative to effort. It is
verified manually in Step 3.

- [ ] **Step 1: Implement tui/App.tsx**

`src/tui/App.tsx`:
```tsx
import React, { useEffect, useState, useCallback } from "react";
import { render, useInput, useApp } from "ink";
import type { SyncContext } from "../cache/sync.js";
import { getProjects, getTimeEntries } from "../cache/sync.js";
import { readTimer } from "../cache/timerState.js";
import { runStop } from "../commands/stop.js";
import { createTimer } from "../commands/start.js";
import { resolveRange } from "../commands/report.js";
import { aggregateReport } from "../domain/report.js";
import type { Config } from "../config/config.js";
import type { Timer } from "../domain/models.js";
import { Dashboard, type RecentEntryView } from "./Dashboard.js";

const REFRESH_INTERVAL_MS = 30_000;
const TICK_INTERVAL_MS = 1000;

interface LoadedState {
  timer: Timer | null;
  todayTotalSeconds: number;
  weekTotalSeconds: number;
  recentEntries: RecentEntryView[];
  stale: boolean;
}

const EMPTY_STATE: LoadedState = {
  timer: null,
  todayTotalSeconds: 0,
  weekTotalSeconds: 0,
  recentEntries: [],
  stale: false,
};

async function loadState(ctx: SyncContext): Promise<LoadedState> {
  const [timer, entries, projects] = await Promise.all([
    readTimer(ctx.cacheDir),
    getTimeEntries(ctx),
    getProjects(ctx),
  ]);
  const now = ctx.now();
  const today = resolveRange("today", now);
  const week = resolveRange("week", now);
  const todaySummary = aggregateReport(entries, projects, today.from, today.to, now);
  const weekSummary = aggregateReport(entries, projects, week.from, week.to, now);
  const recentEntries: RecentEntryView[] = [...entries]
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())
    .slice(0, 5)
    .map((e) => ({ description: e.description, totalSeconds: e.durationSeconds ?? 0, projectId: e.projectId }));
  return {
    timer,
    todayTotalSeconds: todaySummary.reduce((sum, s) => sum + s.totalSeconds, 0),
    weekTotalSeconds: weekSummary.reduce((sum, s) => sum + s.totalSeconds, 0),
    recentEntries,
    stale: false,
  };
}

function App({ ctx, config }: { ctx: SyncContext; config: Config }): React.ReactElement {
  const { exit } = useApp();
  const [state, setState] = useState<LoadedState | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<"dashboard" | "new-timer">("dashboard");
  const [inputValue, setInputValue] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await loadState(ctx);
      setState(next);
      setSelectedIndex((i) => Math.min(i, Math.max(next.recentEntries.length - 1, 0)));
    } catch {
      setState((prev) => (prev ? { ...prev, stale: true } : prev));
    }
  }, [ctx]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const tick = setInterval(() => {
      if (state?.timer) {
        setElapsedSeconds(Math.floor((ctx.now().getTime() - new Date(state.timer.startedAt).getTime()) / 1000));
      }
    }, TICK_INTERVAL_MS);
    return () => clearInterval(tick);
  }, [state?.timer, ctx]);

  useInput(
    async (input) => {
      if (input === "q") {
        exit();
      } else if (input === "s" && state?.timer) {
        await runStop(ctx, config);
        await refresh();
      } else if (input === "c" && state?.recentEntries[selectedIndex]) {
        const entry = state.recentEntries[selectedIndex];
        await createTimer(ctx, config, entry.description, entry.projectId);
        await refresh();
      } else if (input === "r") {
        await refresh();
      } else if (input === "n") {
        setInputValue("");
        setMode("new-timer");
      } else if (state && state.recentEntries.length > 0) {
        if (input === "j") setSelectedIndex((i) => Math.min(i + 1, state.recentEntries.length - 1));
        if (input === "k") setSelectedIndex((i) => Math.max(i - 1, 0));
      }
    },
    { isActive: mode === "dashboard" }
  );

  const handleNewTimerSubmit = useCallback(
    async (value: string) => {
      setMode("dashboard");
      const description = value.trim();
      if (description) {
        await createTimer(ctx, config, description, undefined);
        await refresh();
      }
    },
    [ctx, config, refresh]
  );

  const view = state ?? EMPTY_STATE;

  return (
    <Dashboard
      timer={view.timer}
      elapsedSeconds={elapsedSeconds}
      todayTotalSeconds={view.todayTotalSeconds}
      weekTotalSeconds={view.weekTotalSeconds}
      recentEntries={view.recentEntries}
      stale={view.stale}
      selectedIndex={selectedIndex}
      inputMode={mode === "new-timer"}
      inputValue={inputValue}
      onInputChange={setInputValue}
      onInputSubmit={handleNewTimerSubmit}
    />
  );
}

export function renderDashboard(ctx: SyncContext, config: Config): void {
  render(<App ctx={ctx} config={config} />);
}
```

- [ ] **Step 2: Build and typecheck the whole project**

Run: `npm run typecheck && npm run build`
Expected: no errors.

- [ ] **Step 3: Manually verify the CLI end-to-end**

Run: `node dist/cli.js` with no arguments (first run prompts for a Toggl API
token — paste a real one from your Toggl profile). Confirm:
- The dashboard renders with "No timer running" and empty recent entries on
  a fresh cache.
- Press `q` to quit.
- Run `node dist/cli.js start "Manual QA"`, then `node dist/cli.js status` —
  confirm it prints the description and an increasing elapsed time on
  repeated calls without making extra API calls (check
  `~/.cache/togglr/rate_limit.json` timestamp count stays low).
- Run `node dist/cli.js stop` and confirm `status` goes back to "No timer
  running."
- Run `node dist/cli.js` again and confirm the dashboard now shows the
  stopped entry under "Recent entries" and a non-zero "Today" total.
- Run `node dist/cli.js continue` and confirm a new timer starts with the
  same description.
- Run `node dist/cli.js report today` and confirm it prints a per-project
  breakdown.
- Launch the dashboard (`node dist/cli.js`), press `n`, type a description,
  press Enter, and confirm a new timer starts and the input closes.
- With more than one recent entry, press `j`/`k` to move the highlight, then
  `c` on a non-first entry, and confirm the timer that starts matches the
  *highlighted* entry's description, not necessarily the most recent one.

- [ ] **Step 4: Run the full automated test suite one more time**

Run: `npx vitest run`
Expected: all tests from Tasks 1–13 still pass.

- [ ] **Step 5: Commit**

```bash
git add src/tui/App.tsx
git commit -m "feat: add TUI dashboard container with live timer and keybindings"
```
