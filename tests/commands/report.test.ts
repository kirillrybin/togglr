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
    await writeCacheEntry(join(dir, "projects.json"), [{ id: 1, name: "Website", color: "#fff", workspaceId: 9 }], new Date("2026-07-26T12:00:00Z"));
    await writeCacheEntry(join(dir, "time_entries.json"), [
      { id: 1, description: "Coding", projectId: 1, workspaceId: 9, start: "2026-07-26T10:00:00Z", stop: "2026-07-26T10:30:00Z", durationSeconds: 1800, tags: [] },
    ], new Date("2026-07-26T12:00:00Z"));
    const ctx: SyncContext = {
      client: { getMe: vi.fn(), createTimeEntry: vi.fn(), stopTimeEntry: vi.fn() } as any,
      cacheDir: dir, ttlSeconds: { projects: 21600, timeEntries: 300 }, budgetPerHour: 25,
      now: () => new Date("2026-07-26T12:00:00Z"),
    };

    const result = await runReport(ctx, "today");

    expect(result.data).toEqual([{ projectId: 1, projectName: "Website", totalSeconds: 1800 }]);
    expect(result.degraded).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports degraded='offline' and still returns cached numbers when the API is unreachable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-report-test-"));
    // Cache written an hour ago so both TTLs are genuinely expired.
    const syncedAt = new Date("2026-07-26T11:00:00Z");
    await writeCacheEntry(join(dir, "projects.json"), [{ id: 1, name: "Website", color: "#fff", workspaceId: 9 }], syncedAt);
    await writeCacheEntry(join(dir, "time_entries.json"), [
      { id: 1, description: "Coding", projectId: 1, workspaceId: 9, start: "2026-07-26T10:00:00Z", stop: "2026-07-26T10:30:00Z", durationSeconds: 1800, tags: [] },
    ], syncedAt);
    const ctx: SyncContext = {
      client: { getMe: vi.fn().mockRejectedValue(new Error("fetch failed")), createTimeEntry: vi.fn(), stopTimeEntry: vi.fn() } as any,
      cacheDir: dir,
      ttlSeconds: { projects: 60, timeEntries: 60 }, // expired → refresh attempted
      budgetPerHour: 25,
      now: () => new Date("2026-07-26T12:00:00Z"),
    };

    const result = await runReport(ctx, "today");

    expect(result.degraded).toBe("offline");
    expect(result.data).toEqual([{ projectId: 1, projectName: "Website", totalSeconds: 1800 }]);
    rmSync(dir, { recursive: true, force: true });
  });
});
