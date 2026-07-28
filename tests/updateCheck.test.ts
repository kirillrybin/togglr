import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNewer, checkForUpdate, getCurrentVersion } from "../src/updateCheck.js";
import { readJson } from "../src/cache/store.js";

describe("getCurrentVersion", () => {
  it("reads a semver string synchronously from package.json", () => {
    expect(getCurrentVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("isNewer", () => {
  it("detects a newer patch/minor/major version", () => {
    expect(isNewer("0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.1.1", "0.1.0")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
  });

  it("returns false when equal or older", () => {
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "togglr-update-test-"));
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("prints a notice and caches the result on a cold check when a newer version exists", async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ version: "0.3.0" }) });
    const notice = vi.fn();
    const now = new Date("2026-07-27T12:00:00Z");

    await checkForUpdate(dir, "0.2.0", now, notice);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith("0.2.0", "0.3.0");
    const state = await readJson<{ lastCheckedAt: string; latestVersion: string | null }>(
      join(dir, "update_check.json")
    );
    expect(state).toEqual({ lastCheckedAt: now.toISOString(), latestVersion: "0.3.0" });
  });

  it("does not print a notice when already on the latest version", async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ version: "0.2.0" }) });
    const notice = vi.fn();

    await checkForUpdate(dir, "0.2.0", new Date(), notice);

    expect(notice).not.toHaveBeenCalled();
  });

  it("does not call the network again within 24h, but still uses the cached result", async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ version: "0.3.0" }) });
    const notice = vi.fn();
    const first = new Date("2026-07-27T12:00:00Z");

    await checkForUpdate(dir, "0.2.0", first, notice);
    expect(fetch).toHaveBeenCalledTimes(1);

    const soonAfter = new Date("2026-07-27T18:00:00Z"); // 6h later, still within 24h
    await checkForUpdate(dir, "0.2.0", soonAfter, notice);

    expect(fetch).toHaveBeenCalledTimes(1); // no new network call
    expect(notice).toHaveBeenCalledTimes(2); // still notified from cached data
  });

  it("checks again once 24h have passed", async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ version: "0.3.0" }) });
    const notice = vi.fn();
    const first = new Date("2026-07-27T12:00:00Z");
    await checkForUpdate(dir, "0.2.0", first, notice);

    const muchLater = new Date("2026-07-29T00:00:00Z"); // >24h later
    await checkForUpdate(dir, "0.2.0", muchLater, notice);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never throws when the network call fails, and skips the notice", async () => {
    (fetch as any).mockRejectedValue(new Error("network down"));
    const notice = vi.fn();

    await expect(checkForUpdate(dir, "0.2.0", new Date(), notice)).resolves.toBeUndefined();
    expect(notice).not.toHaveBeenCalled();
  });
});
