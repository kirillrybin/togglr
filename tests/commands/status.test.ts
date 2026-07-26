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
