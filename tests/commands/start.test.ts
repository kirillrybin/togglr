import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { runStart, createTimer } from "../../src/commands/start.js";
import { readTimer } from "../../src/cache/timerState.js";
import { readJson, writeCacheEntry } from "../../src/cache/store.js";
import type { RateLimiterState } from "../../src/cache/rateLimiter.js";
import type { SyncContext } from "../../src/cache/sync.js";
import type { Config } from "../../src/config/config.js";

function makeCtx(cacheDir: string, client: Partial<SyncContext["client"]>): SyncContext {
  return {
    client: { getMe: vi.fn(), createTimeEntry: vi.fn(), stopTimeEntry: vi.fn(), ...client } as any,
    cacheDir,
    ttlSeconds: { projects: 21600, timeEntries: 300 },
    budgetPerHour: 25,
    now: () => new Date("2026-07-26T12:00:00Z"),
  };
}

const config: Config = { apiToken: "t", workspaceId: 9, cacheTtl: { projects: 21600, timeEntries: 300 }, showProjectColors: true };

describe("commands/start", () => {
  it("createTimer creates a time entry and writes the local timer state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-start-test-"));
    const createTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "Coding", project_id: 5, workspace_id: 9,
      start: "2026-07-26T12:00:00Z", stop: null, duration: -1, tags: [],
    });
    const ctx = makeCtx(dir, { createTimeEntry });

    const timer = await createTimer(ctx, config, "Coding", 5);

    expect(timer.entryId).toBe(1);
    expect(await readTimer(dir)).toEqual(timer);
    rmSync(dir, { recursive: true, force: true });
  });

  it("createTimer invalidates the cached time entries list, so the new entry isn't hidden until the TTL expires", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-start-test-"));
    await writeCacheEntry(join(dir, "time_entries.json"), [], new Date("2026-07-26T11:59:00Z"));
    const createTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "Coding", project_id: null, workspace_id: 9,
      start: "2026-07-26T12:00:00Z", stop: null, duration: -1, tags: [],
    });
    const ctx = makeCtx(dir, { createTimeEntry });

    await createTimer(ctx, config, "Coding", undefined);

    expect(existsSync(join(dir, "time_entries.json"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("createTimer records its API spend against the rolling-hour budget", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-start-test-"));
    const createTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "Coding", project_id: null, workspace_id: 9,
      start: "2026-07-26T12:00:00Z", stop: null, duration: -1, tags: [],
    });
    const ctx = makeCtx(dir, { createTimeEntry });

    await createTimer(ctx, config, "Coding", undefined);

    const state = await readJson<RateLimiterState>(join(dir, "rate_limit.json"));
    expect(state?.timestamps).toEqual(["2026-07-26T12:00:00.000Z"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("runStart resolves a project name to its id before creating the timer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-start-test-"));
    const createTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "Coding", project_id: 5, workspace_id: 9,
      start: "2026-07-26T12:00:00Z", stop: null, duration: -1, tags: [],
    });
    const getMe = vi.fn().mockResolvedValue({
      id: 1, default_workspace_id: 9,
      projects: [{ id: 5, name: "Website", color: "#fff", workspace_id: 9 }],
      time_entries: [],
    });
    const ctx = makeCtx(dir, { createTimeEntry, getMe });

    await runStart(ctx, config, { description: "Coding", projectName: "Website" });

    expect(createTimeEntry).toHaveBeenCalledWith(9, { description: "Coding", project_id: 5 });
    rmSync(dir, { recursive: true, force: true });
  });

  it("runStart passes tags through to the created time entry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-start-test-"));
    const createTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "Coding", project_id: null, workspace_id: 9,
      start: "2026-07-26T12:00:00Z", stop: null, duration: -1, tags: ["billable"],
    });
    const ctx = makeCtx(dir, { createTimeEntry });

    await runStart(ctx, config, { description: "Coding", tags: ["billable"] });

    expect(createTimeEntry).toHaveBeenCalledWith(9, {
      description: "Coding",
      project_id: undefined,
      tags: ["billable"],
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("runStart throws when the project name does not match any cached project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-start-test-"));
    const getMe = vi.fn().mockResolvedValue({ id: 1, default_workspace_id: 9, projects: [], time_entries: [] });
    const ctx = makeCtx(dir, { getMe });

    await expect(runStart(ctx, config, { description: "Coding", projectName: "Nope" }))
      .rejects.toThrow("Unknown project: Nope");
    rmSync(dir, { recursive: true, force: true });
  });

  it("createTimer refuses to start a second timer while one is already running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "togglr-start-test-"));
    const createTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "First", project_id: null, workspace_id: 9,
      start: "2026-07-26T12:00:00Z", stop: null, duration: -1, tags: [],
    });
    const ctx = makeCtx(dir, { createTimeEntry });
    await createTimer(ctx, config, "First", undefined);
    await expect(createTimer(ctx, config, "Second", undefined))
      .rejects.toThrow(/already running/);
    expect(createTimeEntry).toHaveBeenCalledTimes(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
