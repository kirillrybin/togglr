import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDeleteEntry } from "../../src/commands/deleteEntry.js";
import { writeTimer, readTimer } from "../../src/cache/timerState.js";
import { writeCacheEntry, readJson } from "../../src/cache/store.js";
import { TogglApiError } from "../../src/api/client.js";
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

const config: Config = { apiToken: "t", workspaceId: 9, cacheTtl: { projects: 21600, timeEntries: 300 } };

describe("commands/deleteEntry", () => {
  it("deletes the entry, records spend, and invalidates the entries cache", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-delete-test-"));
    await writeCacheEntry(join(dir, "time_entries.json"), []);
    const deleteTimeEntry = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx(dir, { deleteTimeEntry });

    await runDeleteEntry(ctx, config, 123);

    expect(deleteTimeEntry).toHaveBeenCalledWith(9, 123);
    expect(existsSync(join(dir, "time_entries.json"))).toBe(false);
    const rl = await readJson<RateLimiterState>(join(dir, "rate_limit.json"));
    expect(rl?.timestamps).toEqual(["2026-07-26T12:00:00.000Z"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("clears the active local timer when the deleted entry is the one currently running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-delete-test-"));
    await writeTimer(dir, {
      entryId: 123, description: "Coding", projectId: null, workspaceId: 9,
      startedAt: "2026-07-26T11:00:00Z",
    });
    const deleteTimeEntry = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx(dir, { deleteTimeEntry });

    await runDeleteEntry(ctx, config, 123);

    expect(await readTimer(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves the active local timer untouched when a different entry is deleted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-delete-test-"));
    await writeTimer(dir, {
      entryId: 999, description: "Coding", projectId: null, workspaceId: 9,
      startedAt: "2026-07-26T11:00:00Z",
    });
    const deleteTimeEntry = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx(dir, { deleteTimeEntry });

    await runDeleteEntry(ctx, config, 123);

    expect(await readTimer(dir)).not.toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("treats a 404 (already deleted elsewhere) as success", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-delete-test-"));
    const deleteTimeEntry = vi.fn().mockRejectedValue(new TogglApiError("Toggl API error: 404", 404));
    const ctx = makeCtx(dir, { deleteTimeEntry });

    await expect(runDeleteEntry(ctx, config, 123)).resolves.toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it("propagates other API errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-delete-test-"));
    const deleteTimeEntry = vi.fn().mockRejectedValue(new TogglApiError("Toggl API error: 500", 500));
    const ctx = makeCtx(dir, { deleteTimeEntry });

    await expect(runDeleteEntry(ctx, config, 123)).rejects.toThrow("Toggl API error: 500");
    rmSync(dir, { recursive: true, force: true });
  });
});
