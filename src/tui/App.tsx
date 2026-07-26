import React, { useEffect, useState, useCallback } from "react";
import { render, useInput, useApp } from "ink";
import type { SyncContext } from "../cache/sync.js";
import { getProjects, getTimeEntries } from "../cache/sync.js";
import { readTimer } from "../cache/timerState.js";
import { runStop } from "../commands/stop.js";
import { createTimer } from "../commands/start.js";
import { resolveRange } from "../commands/report.js";
import { aggregateReport } from "../domain/report.js";
import type { Config } from "../config/config.js";
import type { Timer } from "../domain/models.js";
import { Dashboard, type RecentEntryView } from "./Dashboard.js";

const REFRESH_INTERVAL_MS = 30_000;
const TICK_INTERVAL_MS = 1000;

export interface LoadedState {
  timer: Timer | null;
  todayTotalSeconds: number;
  weekTotalSeconds: number;
  recentEntries: RecentEntryView[];
  stale: boolean;
}

const EMPTY_STATE: LoadedState = {
  timer: null,
  todayTotalSeconds: 0,
  weekTotalSeconds: 0,
  recentEntries: [],
  stale: false,
};

// Exported for tests: this is where a degraded read becomes the `stale` flag
// the Dashboard renders, and where a running entry gets its live duration.
export async function loadState(ctx: SyncContext, opts: { force?: boolean } = {}): Promise<LoadedState> {
  const [timer, entriesResult, projectsResult] = await Promise.all([
    readTimer(ctx.cacheDir),
    getTimeEntries(ctx, opts),
    getProjects(ctx, opts),
  ]);
  const entries = entriesResult.data;
  const projects = projectsResult.data;
  const now = ctx.now();
  const today = resolveRange("today", now);
  const week = resolveRange("week", now);
  const todaySummary = aggregateReport(entries, projects, today.from, today.to, now);
  const weekSummary = aggregateReport(entries, projects, week.from, week.to, now);
  const recentEntries: RecentEntryView[] = [...entries]
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())
    .slice(0, 5)
    .map((e) => ({
      description: e.description,
      // A still-running entry has no durationSeconds; fall back to live elapsed
      // time (same rule aggregateReport uses) instead of rendering 00:00:00.
      totalSeconds: e.durationSeconds ?? (now.getTime() - new Date(e.start).getTime()) / 1000,
      projectId: e.projectId,
    }));
  return {
    timer,
    todayTotalSeconds: todaySummary.reduce((sum, s) => sum + s.totalSeconds, 0),
    weekTotalSeconds: weekSummary.reduce((sum, s) => sum + s.totalSeconds, 0),
    recentEntries,
    stale: entriesResult.degraded !== null || projectsResult.degraded !== null,
  };
}

function App({ ctx, config }: { ctx: SyncContext; config: Config }): React.ReactElement {
  const { exit } = useApp();
  const [state, setState] = useState<LoadedState | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<"dashboard" | "new-timer">("dashboard");
  const [inputValue, setInputValue] = useState("");

  const refresh = useCallback(
    async (opts: { force?: boolean } = {}) => {
      try {
        const next = await loadState(ctx, opts);
        setState(next);
        setSelectedIndex((i) => Math.min(i, Math.max(next.recentEntries.length - 1, 0)));
      } catch {
        // Defensive fallback only. Offline/throttled reads no longer throw —
        // they come back as valid results carrying `degraded`, which loadState
        // already turns into `stale: true`. This catch is for genuinely
        // unexpected failures (e.g. an unreadable cache directory).
        setState((prev) => (prev ? { ...prev, stale: true } : prev));
      }
    },
    [ctx]
  );

  useEffect(() => {
    refresh();
    // Wrapped so the timer never accidentally passes arguments into `refresh`'s
    // new opts parameter — automatic polling must never force-bypass the budget.
    const interval = setInterval(() => refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const tick = setInterval(() => {
      if (state?.timer) {
        setElapsedSeconds(Math.floor((ctx.now().getTime() - new Date(state.timer.startedAt).getTime()) / 1000));
      }
    }, TICK_INTERVAL_MS);
    return () => clearInterval(tick);
  }, [state?.timer, ctx]);

  useInput(
    async (input) => {
      if (input === "q") {
        exit();
      } else if (input === "s" && state?.timer) {
        try {
          await runStop(ctx, config);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
        }
        await refresh();
      } else if (input === "c" && state?.recentEntries[selectedIndex]) {
        const entry = state.recentEntries[selectedIndex];
        try {
          await createTimer(ctx, config, entry.description, entry.projectId);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
        }
        await refresh();
      } else if (input === "r") {
        // Explicit user-initiated refresh: bypasses both the TTL freshness
        // check and the rolling-hour budget gate (the spend is still recorded).
        await refresh({ force: true });
      } else if (input === "n") {
        setInputValue("");
        setMode("new-timer");
      } else if (state && state.recentEntries.length > 0) {
        if (input === "j") setSelectedIndex((i) => Math.min(i + 1, state.recentEntries.length - 1));
        if (input === "k") setSelectedIndex((i) => Math.max(i - 1, 0));
      }
    },
    { isActive: mode === "dashboard" }
  );

  const handleNewTimerSubmit = useCallback(
    async (value: string) => {
      setMode("dashboard");
      const description = value.trim();
      if (description) {
        try {
          await createTimer(ctx, config, description, undefined);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
        }
        await refresh();
      }
    },
    [ctx, config, refresh]
  );

  const view = state ?? EMPTY_STATE;

  return (
    <Dashboard
      timer={view.timer}
      elapsedSeconds={elapsedSeconds}
      todayTotalSeconds={view.todayTotalSeconds}
      weekTotalSeconds={view.weekTotalSeconds}
      recentEntries={view.recentEntries}
      stale={view.stale}
      selectedIndex={selectedIndex}
      inputMode={mode === "new-timer"}
      inputValue={inputValue}
      onInputChange={setInputValue}
      onInputSubmit={handleNewTimerSubmit}
    />
  );
}

export function renderDashboard(ctx: SyncContext, config: Config): void {
  render(<App ctx={ctx} config={config} />);
}
