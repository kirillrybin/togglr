import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTimer, writeTimer } from "../../src/cache/timerState.js";
import type { Timer } from "../../src/domain/models.js";

describe("cache/timerState", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "togglr-timer-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when no timer is running", async () => {
    expect(await readTimer(dir)).toBeNull();
  });

  it("round-trips a running timer", async () => {
    const timer: Timer = {
      entryId: 1, description: "Coding", projectId: 5, workspaceId: 9,
      startedAt: "2026-07-26T10:00:00Z",
    };
    await writeTimer(dir, timer);
    expect(await readTimer(dir)).toEqual(timer);
  });

  it("removes the timer file when writing null", async () => {
    const timer: Timer = {
      entryId: 1, description: "Coding", projectId: null, workspaceId: 9,
      startedAt: "2026-07-26T10:00:00Z",
    };
    await writeTimer(dir, timer);
    await writeTimer(dir, null);
    expect(await readTimer(dir)).toBeNull();
    expect(existsSync(join(dir, "timer.json"))).toBe(false);
  });
});
