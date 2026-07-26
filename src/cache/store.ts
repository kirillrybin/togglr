import fs from "node:fs/promises";
import path from "node:path";

export interface CacheEntry<T> {
  lastSyncedAt: string;
  data: T;
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    // A truncated / corrupted cache file must behave like a cache miss, not
    // like a fatal error — otherwise one bad write bricks every subsequent
    // command (including ones that need no network at all, e.g. `status`).
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

// Distinguishes temp files of two writes racing inside a single process; the
// pid distinguishes them across processes.
let writeCounter = 0;

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Atomic write: a crash mid-write can only ever leave a stray temp file
  // behind, never a half-written filePath. rename(2) within one directory
  // (hence the same filesystem) is atomic.
  const tmpPath = `${filePath}.tmp-${process.pid}-${writeCounter++}`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

export async function readCacheEntry<T>(filePath: string): Promise<CacheEntry<T> | null> {
  return readJson<CacheEntry<T>>(filePath);
}

export async function writeCacheEntry<T>(
  filePath: string,
  data: T,
  now: Date = new Date()
): Promise<void> {
  const entry: CacheEntry<T> = { lastSyncedAt: now.toISOString(), data };
  await writeJson(filePath, entry);
}

export function isStale(
  entry: CacheEntry<unknown> | null,
  ttlSeconds: number,
  now: Date = new Date()
): boolean {
  if (!entry) return true;
  const ageSeconds = (now.getTime() - new Date(entry.lastSyncedAt).getTime()) / 1000;
  return ageSeconds > ttlSeconds;
}
