import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState } from "../../src/tui/App.js";
import { writeCacheEntry } from "../../src/cache/store.js";
import type { SyncContext } from "../../src/cache/sync.js";

const NOW = new Date("2026-07-26T12:00:00Z");
// Cache entries are written with this (an hour old) so the 60s TTLs below are
// genuinely expired and every load actually attempts a refresh.
const SYNCED_AT = new Date("2026-07-26T11:00:00Z");

function makeCtx(dir: string, getMe: SyncContext["client"]["getMe"]): SyncContext {
  return {
    client: { getMe, createTimeEntry: vi.fn(), stopTimeEntry: vi.fn() } as any,
    cacheDir: dir,
    ttlSeconds: { projects: 60, timeEntries: 60 },
    budgetPerHour: 25,
    now: () => NOW,
  };
}

describe("tui loadState", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "togglr-loadstate-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("marks the view stale when a read comes back degraded (offline)", async () => {
    await writeCacheEntry(join(dir, "projects.json"), [], SYNCED_AT);
    await writeCacheEntry(join(dir, "time_entries.json"), [], SYNCED_AT);
    const getMe = vi.fn().mockRejectedValue(new Error("fetch failed"));

    const state = await loadState(makeCtx(dir, getMe));

    expect(state.stale).toBe(true);
  });

  it("marks the view stale when a read comes back degraded (throttled)", async () => {
    await writeCacheEntry(join(dir, "projects.json"), [], SYNCED_AT);
    await writeCacheEntry(join(dir, "time_entries.json"), [], SYNCED_AT);
    const getMe = vi.fn();
    const ctx = { ...makeCtx(dir, getMe), budgetPerHour: 0 };

    const state = await loadState(ctx);

    expect(state.stale).toBe(true);
    expect(getMe).not.toHaveBeenCalled();
  });

  it("is not stale when the refresh succeeds", async () => {
    const getMe = vi.fn().mockResolvedValue({
      id: 1, default_workspace_id: 9, projects: [], time_entries: [],
    });

    const state = await loadState(makeCtx(dir, getMe));

    expect(state.stale).toBe(false);
  });

  it("shows the live elapsed duration for a still-running recent entry", async () => {
    await writeCacheEntry(join(dir, "projects.json"), [], SYNCED_AT);
    await writeCacheEntry(join(dir, "time_entries.json"), [
      {
        id: 1, description: "Running", projectId: null, workspaceId: 9,
        start: "2026-07-26T11:30:00Z", stop: null, durationSeconds: null, tags: [],
      },
    ], SYNCED_AT);
    const getMe = vi.fn().mockRejectedValue(new Error("offline"));

    const state = await loadState(makeCtx(dir, getMe));

    expect(state.recentEntries).toHaveLength(1);
    // 11:30 → 12:00 = 1800s, not 0.
    expect(state.recentEntries[0].totalSeconds).toBe(1800);
  });

  it("forwards force:true to the sync layer, bypassing a fresh cache and an empty budget", async () => {
    // Written "now" so both caches are unambiguously fresh.
    await writeCacheEntry(join(dir, "projects.json"), [], NOW);
    await writeCacheEntry(join(dir, "time_entries.json"), [], NOW);
    const getMe = vi.fn().mockResolvedValue({
      id: 1, default_workspace_id: 9, projects: [], time_entries: [],
    });
    const ctx: SyncContext = {
      ...makeCtx(dir, getMe),
      ttlSeconds: { projects: 21600, timeEntries: 300 }, // cache is fresh
      budgetPerHour: 0, // budget is exhausted
    };

    const plain = await loadState(ctx);
    expect(getMe).not.toHaveBeenCalled();
    expect(plain.stale).toBe(false);

    const forced = await loadState(ctx, { force: true });
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(forced.stale).toBe(false);
  });
});
