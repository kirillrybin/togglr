import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjects, getTimeEntries, recordSpend, type SyncContext } from "../../src/cache/sync.js";
import { readJson } from "../../src/cache/store.js";
import { readTimer, writeTimer } from "../../src/cache/timerState.js";
import type { RateLimiterState } from "../../src/cache/rateLimiter.js";
import type { TogglApiClient } from "../../src/api/client.js";
import type { TogglMeResponse } from "../../src/api/types.js";

function makeCtx(overrides: Partial<SyncContext> & { getMe: () => Promise<TogglMeResponse> }, cacheDir: string): SyncContext {
  const client: TogglApiClient = {
    getMe: overrides.getMe,
    createTimeEntry: vi.fn(),
    createCompletedTimeEntry: vi.fn(),
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

    expect(projects.data).toEqual([{ id: 1, name: "Web", color: "#fff", workspaceId: 9 }]);
    expect(projects.degraded).toBeNull();
    expect(entries.data).toHaveLength(1);
    expect(entries.degraded).toBeNull();
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

    expect(projects.data).toEqual([{ id: 1, name: "Web", color: "#fff", workspaceId: 9 }]);
    expect(projects.degraded).toBe("throttled");
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it("calls the API exactly once when getProjects and getTimeEntries are invoked concurrently on a cold cache", async () => {
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

    // Mirrors the real usage pattern in report.ts and the TUI's loadState:
    // both getters called concurrently against a cold cache.
    const [entries, projects] = await Promise.all([getTimeEntries(ctx), getProjects(ctx)]);

    expect(projects.data).toEqual([{ id: 1, name: "Web", color: "#fff", workspaceId: 9 }]);
    expect(entries.data).toHaveLength(1);
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it("falls back to cached data with degraded='offline' when the API call rejects", async () => {
    const getMe = vi.fn()
      .mockResolvedValueOnce({
        id: 1, default_workspace_id: 9,
        projects: [{ id: 1, name: "Web", color: "#fff", workspace_id: 9 }],
        time_entries: [{
          id: 1, description: "Coding", project_id: 1, workspace_id: 9,
          start: "2026-07-26T11:00:00Z", stop: "2026-07-26T11:30:00Z", duration: 1800, tags: [],
        }],
      } satisfies TogglMeResponse)
      .mockRejectedValue(new Error("fetch failed"));
    const ctx = makeCtx({ getMe }, dir);

    // Warm the cache from a successful call…
    await getProjects(ctx);
    // …then go "offline" and read once the cache has genuinely aged out.
    const staleCtx = {
      ...ctx,
      ttlSeconds: { projects: 0, timeEntries: 0 },
      now: () => new Date("2026-07-26T12:00:05Z"),
    };
    const projects = await getProjects(staleCtx);
    const entries = await getTimeEntries(staleCtx);

    expect(projects.degraded).toBe("offline");
    expect(projects.data).toEqual([{ id: 1, name: "Web", color: "#fff", workspaceId: 9 }]);
    expect(entries.degraded).toBe("offline");
    expect(entries.data).toHaveLength(1);
  });

  it("returns degraded='offline' with empty data (never throws) when the API rejects on a cold cache", async () => {
    const getMe = vi.fn().mockRejectedValue(new Error("ENOTFOUND api.track.toggl.com"));
    const ctx = makeCtx({ getMe }, dir);

    const projects = await getProjects(ctx);
    const entries = await getTimeEntries(ctx);

    expect(projects).toEqual({ data: [], degraded: "offline" });
    expect(entries).toEqual({ data: [], degraded: "offline" });
  });

  it("counts a failed API call against the rolling-hour budget", async () => {
    const getMe = vi.fn().mockRejectedValue(new Error("boom"));
    const ctx = makeCtx({ getMe }, dir);

    await getProjects(ctx);

    const state = await readJson<RateLimiterState>(join(dir, "rate_limit.json"));
    expect(state?.timestamps).toHaveLength(1);
  });

  it("force:true bypasses both the TTL freshness check and the exhausted budget", async () => {
    const getMe = vi.fn().mockResolvedValue({
      id: 1, default_workspace_id: 9,
      projects: [{ id: 1, name: "Web", color: "#fff", workspace_id: 9 }],
      time_entries: [],
    });
    // budgetPerHour: 1 means the very first (cold-cache) call exhausts the budget.
    const ctx = makeCtx({ getMe, budgetPerHour: 1 }, dir);

    await getProjects(ctx); // cold cache, spends the only budget unit
    expect(getMe).toHaveBeenCalledTimes(1);

    // A normal read is now served from a fresh cache without calling.
    const normal = await getProjects(ctx);
    expect(normal.degraded).toBeNull();
    expect(getMe).toHaveBeenCalledTimes(1);

    // Forced read hits the API despite BOTH the fresh cache and the spent budget.
    const forced = await getProjects(ctx, { force: true });
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(forced.degraded).toBeNull();

    // …and the forced spend is still recorded.
    const state = await readJson<RateLimiterState>(join(dir, "rate_limit.json"));
    expect(state?.timestamps).toHaveLength(2);
  });

  it("clears a stale local timer when a real refresh shows nothing running remotely (e.g. stopped/deleted elsewhere)", async () => {
    await writeTimer(dir, {
      entryId: 999, description: "Stale", projectId: null, workspaceId: 9,
      startedAt: "2026-07-26T09:00:00Z",
    });
    const getMe = vi.fn().mockResolvedValue({
      id: 1, default_workspace_id: 9, projects: [],
      time_entries: [{
        id: 999, description: "Stale", project_id: null, workspace_id: 9,
        start: "2026-07-26T09:00:00Z", stop: "2026-07-26T09:30:00Z", duration: 1800, tags: [],
      }],
    } satisfies TogglMeResponse);
    const ctx = makeCtx({ getMe }, dir);

    await getTimeEntries(ctx);

    expect(await readTimer(dir)).toBeNull();
  });

  it("adopts a timer started through another client on a real refresh", async () => {
    const getMe = vi.fn().mockResolvedValue({
      id: 1, default_workspace_id: 9, projects: [],
      time_entries: [{
        id: 42, description: "Started on phone", project_id: null, workspace_id: 9,
        start: "2026-07-26T11:55:00Z", stop: null, duration: -1721981000, tags: [],
      }],
    } satisfies TogglMeResponse);
    const ctx = makeCtx({ getMe }, dir);

    await getTimeEntries(ctx);

    expect(await readTimer(dir)).toEqual({
      entryId: 42, description: "Started on phone", projectId: null, workspaceId: 9,
      startedAt: "2026-07-26T11:55:00Z",
    });
  });

  it("recordSpend appends a timestamp to rate_limit.json", async () => {
    const getMe = vi.fn();
    const ctx = makeCtx({ getMe }, dir);

    await recordSpend(ctx);
    await recordSpend(ctx);

    const state = await readJson<RateLimiterState>(join(dir, "rate_limit.json"));
    expect(state?.timestamps).toEqual([
      "2026-07-26T12:00:00.000Z",
      "2026-07-26T12:00:00.000Z",
    ]);
    expect(getMe).not.toHaveBeenCalled();
  });
});
