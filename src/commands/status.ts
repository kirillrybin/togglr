import type { SyncContext } from "../cache/sync.js";
import { readTimer } from "../cache/timerState.js";

export function formatDuration(totalSeconds: number): string {
  // Clamp: negative input (reachable via clock skew) otherwise renders as
  // garbage like "-1:-1:-5" because Math.floor rounds away from zero here.
  const clamped = Math.max(0, totalSeconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export async function runStatus(ctx: SyncContext): Promise<string> {
  const timer = await readTimer(ctx.cacheDir);
  if (!timer) return "No timer running.";
  const elapsedSeconds = Math.floor((ctx.now().getTime() - new Date(timer.startedAt).getTime()) / 1000);
  return `${timer.description} — ${formatDuration(elapsedSeconds)}`;
}
