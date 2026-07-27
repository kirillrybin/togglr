import React, { useEffect, useState, useCallback, useRef } from "react";
import { render, useInput, useApp } from "ink";
import type { SyncContext } from "../cache/sync.js";
import { getProjects, getTimeEntries } from "../cache/sync.js";
import { readTimer } from "../cache/timerState.js";
import { runStop } from "../commands/stop.js";
import { createTimer } from "../commands/start.js";
import { runDeleteEntry } from "../commands/deleteEntry.js";
import { runEditEntry } from "../commands/editEntry.js";
import { formatTimeHHMM } from "../commands/add.js";
import { normalizeKey } from "./keymap.js";
import { resolveRange } from "../commands/report.js";
import { aggregateReport } from "../domain/report.js";
import type { Config } from "../config/config.js";
import type { Project, Timer } from "../domain/models.js";
import { Dashboard, type RecentEntryView } from "./Dashboard.js";

const REFRESH_INTERVAL_MS = 30_000;
const TICK_INTERVAL_MS = 1000;
const DOUBLE_ESCAPE_WINDOW_MS = 600;
const RECENT_ENTRIES_COUNT = 20;

export interface LoadedState {
  timer: Timer | null;
  todayTotalSeconds: number;
  weekTotalSeconds: number;
  recentEntries: RecentEntryView[];
  projects: Project[];
  stale: boolean;
}

const EMPTY_STATE: LoadedState = {
  timer: null,
  todayTotalSeconds: 0,
  weekTotalSeconds: 0,
  recentEntries: [],
  projects: [],
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
    .slice(0, RECENT_ENTRIES_COUNT)
    .map((e) => ({
      entryId: e.id,
      description: e.description,
      // A still-running entry has no durationSeconds; fall back to live elapsed
      // time (same rule aggregateReport uses) instead of rendering 00:00:00.
      totalSeconds: e.durationSeconds ?? (now.getTime() - new Date(e.start).getTime()) / 1000,
      projectId: e.projectId,
      start: e.start,
      stop: e.stop,
    }));
  return {
    timer,
    todayTotalSeconds: todaySummary.reduce((sum, s) => sum + s.totalSeconds, 0),
    weekTotalSeconds: weekSummary.reduce((sum, s) => sum + s.totalSeconds, 0),
    recentEntries,
    projects,
    stale: entriesResult.degraded !== null || projectsResult.degraded !== null,
  };
}

function App({ ctx, config }: { ctx: SyncContext; config: Config }): React.ReactElement {
  const { exit } = useApp();
  // Ink's exit() only unmounts the UI and restores the terminal (raw mode
  // off, cursor back) — it does NOT stop the Node process. Our own
  // setInterval polls (refresh/tick) keep the event loop alive, so without
  // an explicit process.exit() the process just hangs after "quitting".
  const quit = useCallback(() => {
    exit();
    process.exit(0);
  }, [exit]);
  const [state, setState] = useState<LoadedState | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  type Mode =
    | "dashboard"
    | "new-timer"
    | "confirm-delete"
    | "edit-description"
    | "edit-start"
    | "edit-end"
    | "edit-project";
  const [mode, setMode] = useState<Mode>("dashboard");
  const [inputValue, setInputValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ entryId: number; description: string } | null>(null);
  const [pendingEdit, setPendingEdit] = useState<{
    entryId: number;
    description: string;
    start: string;
    end: string;
    projectName: string;
  } | null>(null);

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
    async (rawInput, key) => {
      const input = normalizeKey(rawInput);
      if (mode === "confirm-delete" && pendingDelete) {
        if (input === "y") {
          const { entryId } = pendingDelete;
          setPendingDelete(null);
          setMode("dashboard");
          try {
            await runDeleteEntry(ctx, config, entryId);
          } catch (err) {
            console.error(err instanceof Error ? err.message : String(err));
          }
          await refresh();
        } else if (input === "n") {
          setPendingDelete(null);
          setMode("dashboard");
        }
        return;
      }
      if (input === "q") {
        quit();
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
      } else if (input === "d" && state?.recentEntries[selectedIndex]) {
        const entry = state.recentEntries[selectedIndex];
        setPendingDelete({ entryId: entry.entryId, description: entry.description });
        setMode("confirm-delete");
      } else if (input === "e" && state?.recentEntries[selectedIndex]) {
        const entry = state.recentEntries[selectedIndex];
        if (entry.stop === null) {
          // A still-running entry has no end time to edit — stop it first.
          console.error("Can't edit a running entry. Stop it first.");
          return;
        }
        const projectName = entry.projectId !== null
          ? (state.projects.find((p) => p.id === entry.projectId)?.name ?? "")
          : "";
        const next = {
          entryId: entry.entryId,
          description: entry.description,
          start: formatTimeHHMM(entry.start),
          end: formatTimeHHMM(entry.stop),
          projectName,
        };
        setPendingEdit(next);
        setInputValue(next.description);
        setMode("edit-description");
      } else if (state && state.recentEntries.length > 0) {
        if (input === "j" || key.downArrow) setSelectedIndex((i) => Math.min(i + 1, state.recentEntries.length - 1));
        if (input === "k" || key.upArrow) setSelectedIndex((i) => Math.max(i - 1, 0));
      }
    },
    { isActive: mode === "dashboard" || mode === "confirm-delete" }
  );

  // Always active (regardless of mode) so Escape-Escape works as an
  // emergency exit even from deep inside a wizard that has no other way
  // out. A single Escape does nothing — this is deliberately a distinct
  // gesture from 'q', not a cancel-current-step action.
  const lastEscapeAt = useRef(0);
  useInput(
    (_input, key) => {
      if (!key.escape) return;
      const now = Date.now();
      if (now - lastEscapeAt.current < DOUBLE_ESCAPE_WINDOW_MS) {
        quit();
      } else {
        lastEscapeAt.current = now;
      }
    },
    { isActive: true }
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

  // The edit flow is a 4-step wizard (description -> start -> end -> project),
  // reusing the same single-line text prompt for each step. Each step just
  // stashes its value into pendingEdit and advances; the API call only
  // happens once, on the final (project) step.
  const handleEditDescriptionSubmit = useCallback(
    (value: string) => {
      if (!pendingEdit) return;
      const next = { ...pendingEdit, description: value };
      setPendingEdit(next);
      setInputValue(next.start);
      setMode("edit-start");
    },
    [pendingEdit]
  );

  const handleEditStartSubmit = useCallback(
    (value: string) => {
      if (!pendingEdit) return;
      const next = { ...pendingEdit, start: value };
      setPendingEdit(next);
      setInputValue(next.end);
      setMode("edit-end");
    },
    [pendingEdit]
  );

  const handleEditEndSubmit = useCallback(
    (value: string) => {
      if (!pendingEdit) return;
      const next = { ...pendingEdit, end: value };
      setPendingEdit(next);
      setInputValue(next.projectName);
      setMode("edit-project");
    },
    [pendingEdit]
  );

  const handleEditProjectSubmit = useCallback(
    async (value: string) => {
      if (!pendingEdit) return;
      const { entryId, description, start, end } = pendingEdit;
      const projectName = value.trim();
      setPendingEdit(null);
      setMode("dashboard");
      try {
        await runEditEntry(ctx, config, entryId, {
          description,
          start,
          end,
          projectName: projectName || undefined,
        });
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
      }
      await refresh();
    },
    [ctx, config, pendingEdit, refresh]
  );

  const INPUT_STEPS: Partial<Record<Mode, { label: string; onSubmit: (value: string) => void | Promise<void> }>> = {
    "new-timer": { label: "New timer", onSubmit: handleNewTimerSubmit },
    "edit-description": { label: "Edit description", onSubmit: handleEditDescriptionSubmit },
    "edit-start": { label: "Edit start (HH:MM)", onSubmit: handleEditStartSubmit },
    "edit-end": { label: "Edit end (HH:MM)", onSubmit: handleEditEndSubmit },
    "edit-project": { label: "Edit project (blank = unchanged)", onSubmit: handleEditProjectSubmit },
  };
  const activeInputStep = INPUT_STEPS[mode];

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
      inputMode={activeInputStep !== undefined}
      inputLabel={activeInputStep?.label ?? ""}
      inputValue={inputValue}
      onInputChange={setInputValue}
      onInputSubmit={activeInputStep?.onSubmit ?? (() => {})}
      confirmDeleteDescription={mode === "confirm-delete" ? (pendingDelete?.description ?? null) : null}
    />
  );
}

export function renderDashboard(ctx: SyncContext, config: Config): void {
  render(<App ctx={ctx} config={config} />);
}
