import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEditEntry } from "../../src/commands/editEntry.js";
import { readJson } from "../../src/cache/store.js";
import type { RateLimiterState } from "../../src/cache/rateLimiter.js";
import type { SyncContext } from "../../src/cache/sync.js";
import type { Config } from "../../src/config/config.js";

function makeCtx(cacheDir: string, client: Partial<SyncContext["client"]>): SyncContext {
  return {
    client: { getMe: vi.fn(), createTimeEntry: vi.fn(), createCompletedTimeEntry: vi.fn(), updateTimeEntry: vi.fn(), stopTimeEntry: vi.fn(), deleteTimeEntry: vi.fn(), ...client } as any,
    cacheDir,
    ttlSeconds: { projects: 21600, timeEntries: 300 },
    budgetPerHour: 25,
    now: () => new Date("2026-07-26T15:00:00Z"),
  };
}

const config: Config = { apiToken: "t", workspaceId: 9, cacheTtl: { projects: 21600, timeEntries: 300 } };

describe("commands/editEntry", () => {
  it("updates only the description, invalidates the entries cache, and records spend", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-edit-test-"));
    const updateTimeEntry = vi.fn().mockResolvedValue({
      id: 5, description: "Renamed", project_id: null, workspace_id: 9,
      start: "2026-07-26T09:00:00.000Z", stop: "2026-07-26T09:15:00.000Z", duration: 900, tags: [],
    });
    const ctx = makeCtx(dir, { updateTimeEntry });

    const entry = await runEditEntry(ctx, config, 5, { description: "Renamed" });

    expect(updateTimeEntry).toHaveBeenCalledWith(9, 5, { description: "Renamed" });
    expect(entry.description).toBe("Renamed");
    expect(existsSync(join(dir, "time_entries.json"))).toBe(false);
    const rl = await readJson<RateLimiterState>(join(dir, "rate_limit.json"));
    expect(rl?.timestamps).toEqual(["2026-07-26T15:00:00.000Z"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("recomputes start/stop/duration when both start and end are given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-edit-test-"));
    const updateTimeEntry = vi.fn().mockResolvedValue({
      id: 5, description: "x", project_id: null, workspace_id: 9,
      start: "2026-07-26T09:00:00.000Z", stop: "2026-07-26T09:30:00.000Z", duration: 1800, tags: [],
    });
    const ctx = makeCtx(dir, { updateTimeEntry });

    await runEditEntry(ctx, config, 5, { start: "09:00", end: "09:30" });

    const [, , data] = updateTimeEntry.mock.calls[0];
    expect(new Date(data.start).getHours()).toBe(9);
    expect(new Date(data.start).getMinutes()).toBe(0);
    expect(new Date(data.stop).getMinutes()).toBe(30);
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a project name to its id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-edit-test-"));
    const updateTimeEntry = vi.fn().mockResolvedValue({
      id: 5, description: "x", project_id: 7, workspace_id: 9,
      start: "2026-07-26T09:00:00.000Z", stop: "2026-07-26T09:15:00.000Z", duration: 900, tags: [],
    });
    const getMe = vi.fn().mockResolvedValue({
      id: 1, default_workspace_id: 9,
      projects: [{ id: 7, name: "Website", color: "#fff", workspace_id: 9 }],
      time_entries: [],
    });
    const ctx = makeCtx(dir, { updateTimeEntry, getMe });

    await runEditEntry(ctx, config, 5, { projectName: "Website" });

    const [, , data] = updateTimeEntry.mock.calls[0];
    expect(data.project_id).toBe(7);
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when the project name does not match any cached project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-edit-test-"));
    const getMe = vi.fn().mockResolvedValue({ id: 1, default_workspace_id: 9, projects: [], time_entries: [] });
    const ctx = makeCtx(dir, { getMe });

    await expect(runEditEntry(ctx, config, 5, { projectName: "Nope" }))
      .rejects.toThrow("Unknown project: Nope");
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when only one of start/end is given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-edit-test-"));
    const ctx = makeCtx(dir, {});

    await expect(runEditEntry(ctx, config, 5, { start: "09:00" }))
      .rejects.toThrow(/Both --start and --end/);
    await expect(runEditEntry(ctx, config, 5, { end: "09:00" }))
      .rejects.toThrow(/Both --start and --end/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when the end time is not after the start time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-edit-test-"));
    const ctx = makeCtx(dir, {});

    await expect(runEditEntry(ctx, config, 5, { start: "10:00", end: "09:00" }))
      .rejects.toThrow(/End time .* must be after start time/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when nothing to edit was given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-edit-test-"));
    const ctx = makeCtx(dir, {});

    await expect(runEditEntry(ctx, config, 5, {})).rejects.toThrow(/Nothing to edit/);
    rmSync(dir, { recursive: true, force: true });
  });
});
