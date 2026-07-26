import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAdd, parseTimeToday } from "../../src/commands/add.js";
import { writeCacheEntry } from "../../src/cache/store.js";
import type { SyncContext } from "../../src/cache/sync.js";
import type { Config } from "../../src/config/config.js";

function makeCtx(cacheDir: string, client: Partial<SyncContext["client"]>): SyncContext {
  return {
    client: { getMe: vi.fn(), createTimeEntry: vi.fn(), createCompletedTimeEntry: vi.fn(), stopTimeEntry: vi.fn(), ...client } as any,
    cacheDir,
    ttlSeconds: { projects: 21600, timeEntries: 300 },
    budgetPerHour: 25,
    now: () => new Date("2026-07-26T15:00:00Z"),
  };
}

const config: Config = { apiToken: "t", workspaceId: 9, cacheTtl: { projects: 21600, timeEntries: 300 } };

describe("parseTimeToday", () => {
  it("parses HH:MM against the reference date's day, in local time", () => {
    const reference = new Date("2026-07-26T15:00:00Z");
    const result = parseTimeToday("09:30", reference);
    expect(result.getFullYear()).toBe(reference.getFullYear());
    expect(result.getMonth()).toBe(reference.getMonth());
    expect(result.getDate()).toBe(reference.getDate());
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(0);
  });

  it("throws on a malformed time string", () => {
    expect(() => parseTimeToday("9am", new Date())).toThrow(/Invalid time/);
    expect(() => parseTimeToday("25:00", new Date())).toThrow(/Invalid time/);
    expect(() => parseTimeToday("12:60", new Date())).toThrow(/Invalid time/);
  });
});

describe("commands/add", () => {
  it("creates a completed time entry from start/end HH:MM and invalidates the entries cache", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-add-test-"));
    await writeCacheEntry(join(dir, "time_entries.json"), []);
    const createCompletedTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "Manual entry", project_id: null, workspace_id: 9,
      start: "2026-07-26T09:00:00.000Z", stop: "2026-07-26T11:30:00.000Z", duration: 9000, tags: [],
    });
    const ctx = makeCtx(dir, { createCompletedTimeEntry });

    const entry = await runAdd(ctx, config, { description: "Manual entry", start: "09:00", end: "11:30" });

    expect(createCompletedTimeEntry).toHaveBeenCalledTimes(1);
    const [workspaceId, data] = createCompletedTimeEntry.mock.calls[0];
    expect(workspaceId).toBe(9);
    expect(data.description).toBe("Manual entry");
    expect(new Date(data.start).getHours()).toBe(9);
    expect(new Date(data.stop).getHours()).toBe(11);
    expect(entry.durationSeconds).toBe(9000);
    expect(existsSync(join(dir, "time_entries.json"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a project name to its id before creating the entry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-add-test-"));
    const createCompletedTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "Manual entry", project_id: 5, workspace_id: 9,
      start: "2026-07-26T09:00:00.000Z", stop: "2026-07-26T10:00:00.000Z", duration: 3600, tags: [],
    });
    const getMe = vi.fn().mockResolvedValue({
      id: 1, default_workspace_id: 9,
      projects: [{ id: 5, name: "Website", color: "#fff", workspace_id: 9 }],
      time_entries: [],
    });
    const ctx = makeCtx(dir, { createCompletedTimeEntry, getMe });

    await runAdd(ctx, config, { description: "Manual entry", projectName: "Website", start: "09:00", end: "10:00" });

    const [, data] = createCompletedTimeEntry.mock.calls[0];
    expect(data.project_id).toBe(5);
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when the project name does not match any cached project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-add-test-"));
    const getMe = vi.fn().mockResolvedValue({ id: 1, default_workspace_id: 9, projects: [], time_entries: [] });
    const ctx = makeCtx(dir, { getMe });

    await expect(runAdd(ctx, config, { description: "x", projectName: "Nope", start: "09:00", end: "10:00" }))
      .rejects.toThrow("Unknown project: Nope");
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when the end time is not after the start time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-add-test-"));
    const ctx = makeCtx(dir, {});

    await expect(runAdd(ctx, config, { description: "x", start: "11:00", end: "09:00" }))
      .rejects.toThrow(/End time .* must be after start time/);
    await expect(runAdd(ctx, config, { description: "x", start: "09:00", end: "09:00" }))
      .rejects.toThrow(/End time .* must be after start time/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes tags through to the created entry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-add-test-"));
    const createCompletedTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "Manual entry", project_id: null, workspace_id: 9,
      start: "2026-07-26T09:00:00.000Z", stop: "2026-07-26T10:00:00.000Z", duration: 3600, tags: ["billable"],
    });
    const ctx = makeCtx(dir, { createCompletedTimeEntry });

    await runAdd(ctx, config, { description: "Manual entry", start: "09:00", end: "10:00", tags: ["billable"] });

    const [, data] = createCompletedTimeEntry.mock.calls[0];
    expect(data.tags).toEqual(["billable"]);
    rmSync(dir, { recursive: true, force: true });
  });
});
