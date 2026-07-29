import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUndoDelete } from "../../src/commands/undoDelete.js";
import { writeTimer, readTimer } from "../../src/cache/timerState.js";
import { writeCacheEntry, readJson } from "../../src/cache/store.js";
import type { RateLimiterState } from "../../src/cache/rateLimiter.js";
import type { SyncContext } from "../../src/cache/sync.js";
import type { Config } from "../../src/config/config.js";

function makeCtx(cacheDir: string, client: Partial<SyncContext["client"]>): SyncContext {
  return {
    client: { getMe: vi.fn(), createTimeEntry: vi.fn(), createCompletedTimeEntry: vi.fn(), stopTimeEntry: vi.fn(), deleteTimeEntry: vi.fn(), ...client } as any,
    cacheDir,
    ttlSeconds: { projects: 21600, timeEntries: 300 },
    budgetPerHour: 25,
    now: () => new Date("2026-07-26T12:00:00Z"),
  };
}

const config: Config = { apiToken: "t", workspaceId: 9, cacheTtl: { projects: 21600, timeEntries: 300 }, showProjectColors: true };

describe("commands/undoDelete", () => {
  it("recreates a completed entry with its original description/project/tags/start/stop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-undo-test-"));
    await writeCacheEntry(join(dir, "time_entries.json"), []);
    const createCompletedTimeEntry = vi.fn().mockResolvedValue({
      id: 42, description: "Coding", project_id: 5, workspace_id: 9,
      start: "2026-07-26T09:00:00.000Z", stop: "2026-07-26T09:30:00.000Z", duration: 1800, tags: ["urgent"],
    });
    const ctx = makeCtx(dir, { createCompletedTimeEntry });

    const entry = await runUndoDelete(ctx, config, {
      description: "Coding", projectId: 5, start: "2026-07-26T09:00:00.000Z", stop: "2026-07-26T09:30:00.000Z", tags: ["urgent"],
    });

    expect(createCompletedTimeEntry).toHaveBeenCalledWith(9, {
      description: "Coding", project_id: 5, tags: ["urgent"],
      start: "2026-07-26T09:00:00.000Z", stop: "2026-07-26T09:30:00.000Z",
    });
    expect(entry.id).toBe(42);
    expect(existsSync(join(dir, "time_entries.json"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("recreates a running entry as a new running timer and writes timer.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-undo-test-"));
    const createTimeEntry = vi.fn().mockResolvedValue({
      id: 43, description: "Meeting", project_id: null, workspace_id: 9,
      start: "2026-07-26T12:00:00.000Z", stop: null, duration: -1, tags: [],
    });
    const ctx = makeCtx(dir, { createTimeEntry });

    await runUndoDelete(ctx, config, {
      description: "Meeting", projectId: null, start: "2026-07-26T08:00:00.000Z", stop: null, tags: [],
    });

    expect(createTimeEntry).toHaveBeenCalledWith(9, {
      description: "Meeting", project_id: undefined, tags: [], start: "2026-07-26T08:00:00.000Z",
    });
    expect(await readTimer(dir)).toEqual({
      entryId: 43, description: "Meeting", projectId: null, workspaceId: 9, startedAt: "2026-07-26T12:00:00.000Z",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to restore a running entry when a different timer is already running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-undo-test-"));
    await writeTimer(dir, {
      entryId: 999, description: "Other", projectId: null, workspaceId: 9, startedAt: "2026-07-26T11:00:00Z",
    });
    const createTimeEntry = vi.fn();
    const ctx = makeCtx(dir, { createTimeEntry });

    await expect(
      runUndoDelete(ctx, config, { description: "Meeting", projectId: null, start: "2026-07-26T08:00:00.000Z", stop: null, tags: [] })
    ).rejects.toThrow(/already running/);
    expect(createTimeEntry).not.toHaveBeenCalled();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records API spend", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-undo-test-"));
    const createCompletedTimeEntry = vi.fn().mockResolvedValue({
      id: 42, description: "Coding", project_id: null, workspace_id: 9,
      start: "2026-07-26T09:00:00.000Z", stop: "2026-07-26T09:30:00.000Z", duration: 1800, tags: [],
    });
    const ctx = makeCtx(dir, { createCompletedTimeEntry });

    await runUndoDelete(ctx, config, {
      description: "Coding", projectId: null, start: "2026-07-26T09:00:00.000Z", stop: "2026-07-26T09:30:00.000Z", tags: [],
    });

    const rl = await readJson<RateLimiterState>(join(dir, "rate_limit.json"));
    expect(rl?.timestamps).toEqual(["2026-07-26T12:00:00.000Z"]);
    rmSync(dir, { recursive: true, force: true });
  });
});
