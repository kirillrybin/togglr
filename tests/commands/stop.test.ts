import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStop } from "../../src/commands/stop.js";
import { TogglApiError } from "../../src/api/client.js";
import { writeTimer, readTimer } from "../../src/cache/timerState.js";
import { writeCacheEntry, readJson } from "../../src/cache/store.js";
import type { RateLimiterState } from "../../src/cache/rateLimiter.js";
import type { SyncContext } from "../../src/cache/sync.js";
import type { Config } from "../../src/config/config.js";

const config: Config = { apiToken: "t", workspaceId: 9, cacheTtl: { projects: 21600, timeEntries: 300 }, showProjectColors: true };

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
    // The stop mutation consumed a real Toggl request and must be counted.
    const rlState = await readJson<RateLimiterState>(join(dir, "rate_limit.json"));
    expect(rlState?.timestamps).toEqual(["2026-07-26T12:00:00.000Z"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("clears the stale local timer when the remote entry no longer exists (404)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-stop-test-"));
    await writeTimer(dir, {
      entryId: 1, description: "Coding", projectId: 5, workspaceId: 9,
      startedAt: "2026-07-26T11:00:00Z",
    });
    await writeCacheEntry(join(dir, "time_entries.json"), []);
    const stopTimeEntry = vi.fn().mockRejectedValue(new TogglApiError("Toggl API error: 404", 404));
    const ctx: SyncContext = {
      client: { getMe: vi.fn(), createTimeEntry: vi.fn(), stopTimeEntry } as any,
      cacheDir: dir,
      ttlSeconds: { projects: 21600, timeEntries: 300 },
      budgetPerHour: 25,
      now: () => new Date("2026-07-26T12:00:00Z"),
    };

    await expect(runStop(ctx, config)).rejects.toThrow(/no longer exists on Toggl/);

    expect(await readTimer(dir)).toBeNull();
    expect(existsSync(join(dir, "time_entries.json"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("propagates other API errors without clearing local timer state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-stop-test-"));
    await writeTimer(dir, {
      entryId: 1, description: "Coding", projectId: 5, workspaceId: 9,
      startedAt: "2026-07-26T11:00:00Z",
    });
    const stopTimeEntry = vi.fn().mockRejectedValue(new TogglApiError("Toggl API error: 500", 500));
    const ctx: SyncContext = {
      client: { getMe: vi.fn(), createTimeEntry: vi.fn(), stopTimeEntry } as any,
      cacheDir: dir,
      ttlSeconds: { projects: 21600, timeEntries: 300 },
      budgetPerHour: 25,
      now: () => new Date("2026-07-26T12:00:00Z"),
    };

    await expect(runStop(ctx, config)).rejects.toThrow("Toggl API error: 500");

    expect(await readTimer(dir)).not.toBeNull();
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
