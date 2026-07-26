import type { Timer, TimeEntry } from "./models.js";

/**
 * Local timer.json is only ever the source of truth between our own
 * start/stop/continue calls — it can silently diverge from reality if the
 * user starts, stops, or deletes a timer through another Toggl client
 * (web/mobile). Whenever we already have a fresh set of time entries from
 * Toggl (i.e. a real /me refresh just happened, at no extra API cost),
 * remote truth wins: reconcile the local timer against whatever is (or
 * isn't) actually running.
 */
export function reconcileTimer(localTimer: Timer | null, freshEntries: TimeEntry[]): Timer | null {
  const remoteRunning = freshEntries.find((entry) => entry.durationSeconds === null);
  if (!remoteRunning) return null;
  return {
    entryId: remoteRunning.id,
    description: remoteRunning.description,
    projectId: remoteRunning.projectId,
    workspaceId: remoteRunning.workspaceId,
    startedAt: remoteRunning.start,
  };
}
