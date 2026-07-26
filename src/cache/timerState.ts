import fs from "node:fs/promises";
import path from "node:path";
import type { Timer } from "../domain/models.js";
import { readJson, writeJson } from "./store.js";

function timerFile(cacheDir: string): string {
  return path.join(cacheDir, "timer.json");
}

export async function readTimer(cacheDir: string): Promise<Timer | null> {
  return readJson<Timer>(timerFile(cacheDir));
}

export async function writeTimer(cacheDir: string, timer: Timer | null): Promise<void> {
  if (timer === null) {
    await fs.rm(timerFile(cacheDir), { force: true });
    return;
  }
  await writeJson(timerFile(cacheDir), timer);
}
