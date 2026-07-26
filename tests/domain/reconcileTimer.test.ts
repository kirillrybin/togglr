import { describe, expect, it } from "vitest";
import { reconcileTimer } from "../../src/domain/reconcileTimer.js";
import type { Timer, TimeEntry } from "../../src/domain/models.js";

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: 1, description: "Coding", projectId: null, workspaceId: 9,
    start: "2026-07-26T10:00:00Z", stop: "2026-07-26T10:30:00Z",
    durationSeconds: 1800, tags: [], ...overrides,
  };
}

const localTimer: Timer = {
  entryId: 1, description: "Coding", projectId: null, workspaceId: 9,
  startedAt: "2026-07-26T10:00:00Z",
};

describe("reconcileTimer", () => {
  it("clears the local timer when nothing is running remotely", () => {
    const entries = [entry({ id: 1, stop: "2026-07-26T10:30:00Z", durationSeconds: 1800 })];
    expect(reconcileTimer(localTimer, entries)).toBeNull();
  });

  it("clears the local timer when the remote entry list is empty (deleted elsewhere)", () => {
    expect(reconcileTimer(localTimer, [])).toBeNull();
  });

  it("adopts a different remote running entry, overwriting a stale local one", () => {
    const entries = [entry({ id: 2, description: "Meeting", stop: null, durationSeconds: null })];
    expect(reconcileTimer(localTimer, entries)).toEqual({
      entryId: 2, description: "Meeting", projectId: null, workspaceId: 9,
      startedAt: "2026-07-26T10:00:00Z",
    });
  });

  it("adopts a remote running entry when there was no local timer at all", () => {
    const entries = [entry({ id: 3, description: "Started elsewhere", stop: null, durationSeconds: null })];
    expect(reconcileTimer(null, entries)).toEqual({
      entryId: 3, description: "Started elsewhere", projectId: null, workspaceId: 9,
      startedAt: "2026-07-26T10:00:00Z",
    });
  });

  it("is a no-op when the local timer already matches the remote running entry", () => {
    const entries = [entry({ id: 1, description: "Coding", stop: null, durationSeconds: null })];
    expect(reconcileTimer(localTimer, entries)).toEqual(localTimer);
  });
});
