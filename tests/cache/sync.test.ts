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
