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
    throw err;
  }
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
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
