export interface RateLimiterState {
  timestamps: string[];
}

const WINDOW_MS = 60 * 60 * 1000;

export function pruneOld(state: RateLimiterState, now: Date): RateLimiterState {
  const cutoff = now.getTime() - WINDOW_MS;
  return { timestamps: state.timestamps.filter((ts) => new Date(ts).getTime() > cutoff) };
}

export function canSpend(state: RateLimiterState, now: Date, budgetPerHour: number): boolean {
  return pruneOld(state, now).timestamps.length < budgetPerHour;
}

export function recordRequest(state: RateLimiterState, now: Date): RateLimiterState {
  const pruned = pruneOld(state, now);
  return { timestamps: [...pruned.timestamps, now.toISOString()] };
}
