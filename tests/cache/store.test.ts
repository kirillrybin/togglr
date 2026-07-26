import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readJson, writeJson, readCacheEntry, writeCacheEntry, isStale,
} from "../../src/cache/store.js";

describe("cache/store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "togglr-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null reading a file that does not exist", async () => {
    expect(await readJson(join(dir, "missing.json"))).toBeNull();
  });

  it("round-trips arbitrary JSON data", async () => {
    const file = join(dir, "sub", "data.json");
    await writeJson(file, { a: 1 });
    expect(await readJson(file)).toEqual({ a: 1 });
  });

  it("wraps data with lastSyncedAt in a CacheEntry", async () => {
    const file = join(dir, "entry.json");
    const now = new Date("2026-07-26T10:00:00Z");
    await writeCacheEntry(file, [1, 2, 3], now);
    const entry = await readCacheEntry<number[]>(file);
    expect(entry).toEqual({ lastSyncedAt: now.toISOString(), data: [1, 2, 3] });
  });

  it("treats a corrupted/truncated JSON file as a cache miss instead of throwing", async () => {
    const file = join(dir, "corrupt.json");
    writeFileSync(file, '{"lastSyncedAt": "2026-07-26T10:00:00Z", "data": [{"id": 1');
    expect(await readJson(file)).toBeNull();
    expect(await readCacheEntry(file)).toBeNull();
  });

  it("still rethrows non-parse, non-ENOENT read errors", async () => {
    // Reading a directory as a file fails with EISDIR on macOS/Linux.
    await expect(readJson(dir)).rejects.toThrow();
  });

  it("writes atomically and leaves no temp file behind", async () => {
    const file = join(dir, "atomic.json");
    await writeJson(file, { a: 1 });
    await writeJson(file, { a: 2 });
    expect(await readJson(file)).toEqual({ a: 2 });
    expect(readdirSync(dir)).toEqual(["atomic.json"]);
  });

  it("isStale is true when no entry exists", () => {
    expect(isStale(null, 300)).toBe(true);
  });

  it("isStale is false within the TTL window and true after it", () => {
    const entry = { lastSyncedAt: "2026-07-26T10:00:00Z", data: null };
    expect(isStale(entry, 300, new Date("2026-07-26T10:04:00Z"))).toBe(false);
    expect(isStale(entry, 300, new Date("2026-07-26T10:06:00Z"))).toBe(true);
  });
});
