import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReport, resolveRange, parseReportDate, formatReportCsv } from "../../src/commands/report.js";
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

  it("accepts an explicit {from, to} range instead of a preset keyword", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-report-test-"));
    await writeCacheEntry(join(dir, "projects.json"), [{ id: 1, name: "Website", color: "#fff", workspaceId: 9 }], new Date("2026-07-26T12:00:00Z"));
    await writeCacheEntry(join(dir, "time_entries.json"), [
      { id: 1, description: "Coding", projectId: 1, workspaceId: 9, start: "2026-07-10T10:00:00Z", stop: "2026-07-10T10:30:00Z", durationSeconds: 1800, tags: [] },
      { id: 2, description: "Coding", projectId: 1, workspaceId: 9, start: "2026-07-26T10:00:00Z", stop: "2026-07-26T10:30:00Z", durationSeconds: 1800, tags: [] },
    ], new Date("2026-07-26T12:00:00Z"));
    const ctx: SyncContext = {
      client: { getMe: vi.fn(), createTimeEntry: vi.fn(), stopTimeEntry: vi.fn() } as any,
      cacheDir: dir, ttlSeconds: { projects: 21600, timeEntries: 300 }, budgetPerHour: 25,
      now: () => new Date("2026-07-26T12:00:00Z"),
    };

    const result = await runReport(ctx, { from: new Date("2026-07-09T00:00:00Z"), to: new Date("2026-07-11T00:00:00Z") });

    // Only the July 10 entry falls inside the custom range.
    expect(result.data).toEqual([{ projectId: 1, projectName: "Website", totalSeconds: 1800 }]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("parseReportDate", () => {
  it("parses a valid YYYY-MM-DD date at local midnight", () => {
    const date = parseReportDate("--from", "2026-07-26");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(6);
    expect(date.getDate()).toBe(26);
    expect(date.getHours()).toBe(0);
  });

  it("rejects malformed input", () => {
    expect(() => parseReportDate("--from", "07-26-2026")).toThrow(/Invalid --from date/);
    expect(() => parseReportDate("--from", "not-a-date")).toThrow(/Invalid --from date/);
  });

  it("rejects a calendar date that doesn't exist", () => {
    expect(() => parseReportDate("--to", "2026-02-30")).toThrow(/Invalid --to date/);
  });
});

describe("formatReportCsv", () => {
  it("formats a header and one row per project with duration and raw seconds", () => {
    const csv = formatReportCsv([
      { projectId: 1, projectName: "Website", totalSeconds: 3661 },
      { projectId: null, projectName: "No project", totalSeconds: 30 },
    ]);
    expect(csv).toBe(
      "project,duration,seconds\n" +
      "Website,01:01:01,3661\n" +
      "No project,00:00:30,30"
    );
  });

  it("quotes and escapes project names containing commas or quotes", () => {
    const csv = formatReportCsv([{ projectId: 1, projectName: 'Client, "VIP"', totalSeconds: 60 }]);
    expect(csv).toContain('"Client, ""VIP"""');
  });

  it("still prints just the header for an empty report", () => {
    expect(formatReportCsv([])).toBe("project,duration,seconds");
  });
});
