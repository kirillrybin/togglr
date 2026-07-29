import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runContinue } from "../../src/commands/continueLast.js";
import { writeCacheEntry } from "../../src/cache/store.js";
import type { SyncContext } from "../../src/cache/sync.js";
import type { Config } from "../../src/config/config.js";

const config: Config = { apiToken: "t", workspaceId: 9, cacheTtl: { projects: 21600, timeEntries: 300 }, showProjectColors: true };

describe("commands/continueLast", () => {
  it("starts a new timer with the same description and project as the most recent entry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-continue-test-"));
    await writeCacheEntry(join(dir, "time_entries.json"), [
      { id: 1, description: "Older", projectId: null, workspaceId: 9, start: "2026-07-26T09:00:00Z", stop: "2026-07-26T09:30:00Z", durationSeconds: 1800, tags: [] },
      { id: 2, description: "Newer", projectId: 5, workspaceId: 9, start: "2026-07-26T11:00:00Z", stop: "2026-07-26T11:15:00Z", durationSeconds: 900, tags: [] },
    ], new Date("2026-07-26T12:00:00Z"));
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
    await writeCacheEntry(join(dir, "time_entries.json"), [], new Date("2026-07-26T12:00:00Z"));
    const ctx: SyncContext = {
      client: { getMe: vi.fn(), createTimeEntry: vi.fn(), stopTimeEntry: vi.fn() } as any,
      cacheDir: dir, ttlSeconds: { projects: 21600, timeEntries: 300 }, budgetPerHour: 25,
      now: () => new Date("2026-07-26T12:00:00Z"),
    };
    await expect(runContinue(ctx, config)).rejects.toThrow("No previous time entry to continue.");
    rmSync(dir, { recursive: true, force: true });
  });
});
