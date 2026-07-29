import React, { useEffect, useState, useCallback, useRef } from "react";
import { render, useInput, useApp } from "ink";
import type { SyncContext } from "../cache/sync.js";
import { getProjects, getTimeEntries } from "../cache/sync.js";
import { readTimer } from "../cache/timerState.js";
import { reconcileTimer } from "../domain/reconcileTimer.js";
import { runStop } from "../commands/stop.js";
import { createTimer } from "../commands/start.js";
import { runDeleteEntry } from "../commands/deleteEntry.js";
import { runUndoDelete, type DeletedEntrySnapshot } from "../commands/undoDelete.js";
import { runEditEntry } from "../commands/editEntry.js";
import { formatTimeHHMM } from "../commands/add.js";
import { normalizeKey } from "./keymap.js";
import { resolveRange } from "../commands/report.js";
import { aggregateReport } from "../domain/report.js";
import type { Config } from "../config/config.js";
import type { Project, Timer } from "../domain/models.js";
import {
  Dashboard,
  filterProjectSuggestions,
  filterTagSuggestions,
  applyTagSuggestion,
  filterEntries,
  type RecentEntryView,
} from "./Dashboard.js";

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
  knownTags: string[];
  stale: boolean;
}

const EMPTY_STATE: LoadedState = {
  timer: null,
  todayTotalSeconds: 0,
  weekTotalSeconds: 0,
  recentEntries: [],
  projects: [],
  knownTags: [],
  stale: false,
};

// Exported for tests: this is where a degraded read becomes the `stale` flag
// the Dashboard renders, and where a running entry gets its live duration.
export async function loadState(ctx: SyncContext, opts: { force?: boolean } = {}): Promise<LoadedState> {
  const [localTimer, entriesResult, projectsResult] = await Promise.all([
    readTimer(ctx.cacheDir),
    getTimeEntries(ctx, opts),
    getProjects(ctx, opts),
  ]);
  const entries = entriesResult.data;
  const projects = projectsResult.data;
  // Derive the header's timer from the same entries this read just resolved,
  // instead of the separately-cached timer.json — otherwise the header and
  // the recent-entries list (which already uses this same entries data) can
  // silently disagree whenever timer.json falls behind. Only fall back to
  // the local file on a degraded (stale/offline) read, where `entries` may
  // be missing a timer started since the last successful fetch.
  const timer = entriesResult.degraded === null ? reconcileTimer(null, entries) : localTimer;
  const now = ctx.now();
  const today = resolveRange("today", now);
  const week = resolveRange("week", now);
  const todaySummary = aggregateReport(entries, projects, today.from, today.to, now);
  const weekSummary = aggregateReport(entries, projects, week.from, week.to, now);
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  const projectColorById = new Map(projects.map((p) => [p.id, p.color]));
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
      projectName: e.projectId !== null ? (projectNameById.get(e.projectId) ?? null) : null,
      projectColor: e.projectId !== null ? (projectColorById.get(e.projectId) ?? null) : null,
      start: e.start,
      stop: e.stop,
      tags: e.tags,
    }));
  // Off the full cached entries list, not just the 20-row recentEntries slice
  // — a tag from entry 21 is just as worth suggesting as one from entry 1.
  const knownTags = [...new Set(entries.flatMap((e) => e.tags))].sort();
  return {
    timer,
    todayTotalSeconds: todaySummary.reduce((sum, s) => sum + s.totalSeconds, 0),
    weekTotalSeconds: weekSummary.reduce((sum, s) => sum + s.totalSeconds, 0),
    recentEntries,
    projects,
    knownTags,
    stale: entriesResult.degraded !== null || projectsResult.degraded !== null,
  };
}

// Exported for tests (ink-testing-library drives it directly via stdin.write);
// renderDashboard below is the real entry point, which also wraps it in the
// alternate-screen setup that doesn't belong in a headless render.
export function App({ ctx, config }: { ctx: SyncContext; config: Config }): React.ReactElement {
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
  // A counter that only exists to force a re-render once a second — elapsed
  // time itself is computed fresh below, not stored, so it's never one tick
  // stale (e.g. showing 00:00:00 for the first second after a timer appears).
  const [tick, setTick] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  type Mode =
    | "dashboard"
    | "search"
    | "new-timer"
    | "new-timer-project"
    | "new-timer-tags"
    | "confirm-delete"
    | "edit-description"
    | "edit-start"
    | "edit-end"
    | "edit-project"
    | "edit-tags";
  const [mode, setMode] = useState<Mode>("dashboard");
  const [inputValue, setInputValue] = useState("");
  // The committed filter — stays applied after the search prompt closes.
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{
    entryId: number;
    description: string;
    projectId: number | null;
    start: string;
    stop: string | null;
    tags: string[];
  } | null>(null);
  // Only the most recent delete is undoable — a second delete (or a
  // successful undo) simply replaces/clears this.
  const [lastDeleted, setLastDeleted] = useState<DeletedEntrySnapshot | null>(null);
  const [pendingEdit, setPendingEdit] = useState<{
    entryId: number;
    description: string;
    start: string;
    end: string;
    projectName: string;
    tags: string;
    isRunning: boolean;
  } | null>(null);
  const [pendingNewTimer, setPendingNewTimer] = useState<{ description: string; projectId?: number } | null>(null);
  // Which of the filtered project suggestions is highlighted, so Enter can
  // pick it instead of submitting the raw (possibly partial) typed text.
  // null means "no highlight" — Enter then falls back to the raw text.
  const [suggestionIndex, setSuggestionIndex] = useState<number | null>(null);
  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    setSuggestionIndex(null);
  }, []);
  // ink-text-input only advances its internal cursor to the end of a new
  // `value` when that value got SHORTER than the old cursor position — never
  // when it got longer (e.g. Tab-completing "fe" to "feature, "). Remounting
  // via `key` forces it to re-derive cursorOffset from scratch instead of
  // inserting subsequent keystrokes wherever the stale cursor was left.
  const [inputResetKey, setInputResetKey] = useState(0);
  const setProgrammaticInput = useCallback((value: string) => {
    setInputValue(value);
    setInputResetKey((k) => k + 1);
  }, []);

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
    const interval = setInterval(() => setTick((t) => t + 1), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
  void tick; // read only to force the re-render below to recompute elapsedSeconds
  const elapsedSeconds = state?.timer
    ? Math.floor((ctx.now().getTime() - new Date(state.timer.startedAt).getTime()) / 1000)
    : 0;

  const view = state ?? EMPTY_STATE;
  const timerProjectColor =
    view.timer?.projectId != null
      ? (view.projects.find((p) => p.id === view.timer!.projectId)?.color ?? null)
      : null;
  // While actively typing a search, filter live off the in-progress text;
  // once submitted (or when not searching at all), use the committed query.
  const activeSearchQuery = mode === "search" ? inputValue : searchQuery;
  const filteredEntries = filterEntries(view.recentEntries, activeSearchQuery);
  const clampedSelectedIndex =
    filteredEntries.length === 0 ? 0 : Math.min(selectedIndex, filteredEntries.length - 1);

  // Active on any step that's asking for a project name (new timer or edit):
  // filters `state.projects` by the currently typed text.
  const isProjectStep = mode === "new-timer-project" || mode === "edit-project";
  const projectSuggestions = isProjectStep ? filterProjectSuggestions(state?.projects ?? [], inputValue) : [];
  // Tags are a single comma-separated field, so suggestions filter against
  // just the segment being typed right now (see filterTagSuggestions).
  const isTagsStep = mode === "new-timer-tags" || mode === "edit-tags";
  const tagSuggestions = isTagsStep ? filterTagSuggestions(view.knownTags, inputValue) : [];
  const suggestionsLength = isProjectStep ? projectSuggestions.length : tagSuggestions.length;

  // Up/Down aren't handled by TextInput itself, so this can run alongside it
  // without conflict — it only ever moves the highlighted suggestion.
  useInput(
    (_input, key) => {
      if (suggestionsLength === 0) return;
      if (key.downArrow) {
        setSuggestionIndex((i) => (i === null ? 0 : Math.min(i + 1, suggestionsLength - 1)));
      } else if (key.upArrow) {
        setSuggestionIndex((i) => (i === null ? suggestionsLength - 1 : Math.max(i - 1, 0)));
      }
    },
    { isActive: isProjectStep || isTagsStep }
  );

  // Tab inserts the highlighted (or, if none highlighted yet, the top) tag
  // suggestion and keeps editing — unlike the project step, Enter here
  // submits the whole comma-separated field rather than picking one value.
  useInput(
    (_input, key) => {
      if (!key.tab || tagSuggestions.length === 0) return;
      const picked = tagSuggestions[suggestionIndex ?? 0];
      setProgrammaticInput(applyTagSuggestion(inputValue, picked));
      setSuggestionIndex(null);
    },
    { isActive: isTagsStep }
  );

  useInput(
    async (rawInput, key) => {
      const input = normalizeKey(rawInput);
      if (mode === "confirm-delete" && pendingDelete) {
        if (input === "y") {
          const { entryId, ...snapshot } = pendingDelete;
          setPendingDelete(null);
          setMode("dashboard");
          try {
            await runDeleteEntry(ctx, config, entryId);
            setLastDeleted(snapshot);
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
      } else if (input === "c" && filteredEntries[clampedSelectedIndex]) {
        const entry = filteredEntries[clampedSelectedIndex];
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
        setProgrammaticInput("");
        setMode("new-timer");
      } else if (input === "/") {
        setProgrammaticInput(searchQuery);
        setMode("search");
      } else if (input === "d" && filteredEntries[clampedSelectedIndex]) {
        const entry = filteredEntries[clampedSelectedIndex];
        setPendingDelete({
          entryId: entry.entryId,
          description: entry.description,
          projectId: entry.projectId,
          start: entry.start,
          stop: entry.stop,
          tags: entry.tags,
        });
        setMode("confirm-delete");
      } else if (input === "u" && lastDeleted) {
        const snapshot = lastDeleted;
        setLastDeleted(null);
        try {
          await runUndoDelete(ctx, config, snapshot);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
        }
        await refresh();
      } else if (input === "e" && filteredEntries[clampedSelectedIndex]) {
        const entry = filteredEntries[clampedSelectedIndex];
        const projectName = entry.projectId !== null
          ? (state?.projects.find((p) => p.id === entry.projectId)?.name ?? "")
          : "";
        const next = {
          entryId: entry.entryId,
          description: entry.description,
          start: formatTimeHHMM(entry.start),
          // A running entry has no end time yet — the wizard skips that step
          // for it (see handleEditStartSubmit) rather than asking for one.
          end: entry.stop !== null ? formatTimeHHMM(entry.stop) : "",
          projectName,
          tags: entry.tags.join(", "),
          isRunning: entry.stop === null,
        };
        setPendingEdit(next);
        setProgrammaticInput(next.description);
        setMode("edit-description");
      } else if (filteredEntries.length > 0) {
        if (input === "j" || key.downArrow) setSelectedIndex((i) => Math.min(i + 1, filteredEntries.length - 1));
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

  // A single Escape while editing the search text closes the prompt without
  // touching the previously committed filter (if any) — unlike the wizards,
  // this one gets its own single-Escape-cancels gesture, matching how `/`
  // search works in less/vim rather than the double-Escape-to-quit pattern.
  useInput(
    (_input, key) => {
      if (key.escape) setMode("dashboard");
    },
    { isActive: mode === "search" }
  );

  const handleSearchSubmit = useCallback((value: string) => {
    setSearchQuery(value.trim());
    setSelectedIndex(0);
    setMode("dashboard");
  }, []);

  const handleNewTimerDescriptionSubmit = useCallback((value: string) => {
    const description = value.trim();
    if (!description) {
      setMode("dashboard");
      return;
    }
    setPendingNewTimer({ description });
    setProgrammaticInput("");
    setSuggestionIndex(null);
    setMode("new-timer-project");
  }, []);

  const handleNewTimerProjectSubmit = useCallback(
    (value: string) => {
      if (!pendingNewTimer) return;
      // A highlighted suggestion wins outright; otherwise fall back to
      // whatever was typed (blank included, meaning "no project").
      const projectName =
        suggestionIndex !== null
          ? projectSuggestions[suggestionIndex]?.name
          : value.trim() || undefined;
      let projectId: number | undefined;
      if (projectName) {
        const match = state?.projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase());
        if (!match) {
          console.error(`Unknown project: ${projectName}`);
          setPendingNewTimer(null);
          setMode("dashboard");
          return;
        }
        projectId = match.id;
      }
      setPendingNewTimer({ ...pendingNewTimer, projectId });
      setProgrammaticInput("");
      setSuggestionIndex(null);
      setMode("new-timer-tags");
    },
    [pendingNewTimer, projectSuggestions, suggestionIndex, state]
  );

  const handleNewTimerTagsSubmit = useCallback(
    async (value: string) => {
      if (!pendingNewTimer) return;
      const { description, projectId } = pendingNewTimer;
      const tags = value.trim() ? value.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
      setPendingNewTimer(null);
      setMode("dashboard");
      try {
        await createTimer(ctx, config, description, projectId, tags);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
      }
      await refresh();
    },
    [ctx, config, pendingNewTimer, refresh]
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
      setProgrammaticInput(next.start);
      setMode("edit-start");
    },
    [pendingEdit]
  );

  const handleEditStartSubmit = useCallback(
    (value: string) => {
      if (!pendingEdit) return;
      const next = { ...pendingEdit, start: value };
      setPendingEdit(next);
      if (next.isRunning) {
        // No end time to ask for yet — go straight to the project step.
        setProgrammaticInput(next.projectName);
        setSuggestionIndex(null);
        setMode("edit-project");
      } else {
        setProgrammaticInput(next.end);
        setMode("edit-end");
      }
    },
    [pendingEdit]
  );

  const handleEditEndSubmit = useCallback(
    (value: string) => {
      if (!pendingEdit) return;
      const next = { ...pendingEdit, end: value };
      setPendingEdit(next);
      setProgrammaticInput(next.projectName);
      setSuggestionIndex(null);
      setMode("edit-project");
    },
    [pendingEdit]
  );

  const handleEditProjectSubmit = useCallback(
    (value: string) => {
      if (!pendingEdit) return;
      // A highlighted suggestion wins outright; otherwise fall back to
      // whatever was typed (which starts pre-filled with the current project).
      const projectName = suggestionIndex !== null ? projectSuggestions[suggestionIndex]?.name : value.trim();
      const next = { ...pendingEdit, projectName: projectName ?? "" };
      setPendingEdit(next);
      setProgrammaticInput(next.tags);
      setSuggestionIndex(null);
      setMode("edit-tags");
    },
    [pendingEdit, projectSuggestions, suggestionIndex]
  );

  const handleEditTagsSubmit = useCallback(
    async (value: string) => {
      if (!pendingEdit) return;
      const { entryId, description, start, end, projectName, isRunning } = pendingEdit;
      const tags = value.trim() ? value.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
      setPendingEdit(null);
      setMode("dashboard");
      try {
        await runEditEntry(ctx, config, entryId, {
          description,
          start,
          // A running entry was never asked for an end — leave stop untouched
          // rather than sending the placeholder empty string.
          end: isRunning ? undefined : end,
          projectName: projectName || undefined,
          tags,
        });
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
      }
      await refresh();
    },
    [ctx, config, pendingEdit, refresh]
  );

  const INPUT_STEPS: Partial<Record<Mode, { label: string; onSubmit: (value: string) => void | Promise<void> }>> = {
    search: { label: "Filter", onSubmit: handleSearchSubmit },
    "new-timer": { label: "New timer", onSubmit: handleNewTimerDescriptionSubmit },
    "new-timer-project": { label: "Project (blank = none)", onSubmit: handleNewTimerProjectSubmit },
    "new-timer-tags": { label: "Tags (comma-separated, Tab to autocomplete, blank = none)", onSubmit: handleNewTimerTagsSubmit },
    "edit-description": { label: "Edit description", onSubmit: handleEditDescriptionSubmit },
    "edit-start": { label: "Edit start (HH:MM)", onSubmit: handleEditStartSubmit },
    "edit-end": { label: "Edit end (HH:MM)", onSubmit: handleEditEndSubmit },
    "edit-project": { label: "Edit project (blank = unchanged)", onSubmit: handleEditProjectSubmit },
    "edit-tags": { label: "Edit tags (comma-separated, Tab to autocomplete, blank = unchanged)", onSubmit: handleEditTagsSubmit },
  };
  const activeInputStep = INPUT_STEPS[mode];

  return (
    <Dashboard
      timer={view.timer}
      timerProjectColor={timerProjectColor}
      showProjectColors={config.showProjectColors}
      elapsedSeconds={elapsedSeconds}
      todayTotalSeconds={view.todayTotalSeconds}
      weekTotalSeconds={view.weekTotalSeconds}
      recentEntries={filteredEntries}
      stale={view.stale}
      selectedIndex={clampedSelectedIndex}
      inputMode={activeInputStep !== undefined}
      inputLabel={activeInputStep?.label ?? ""}
      inputValue={inputValue}
      inputResetKey={inputResetKey}
      onInputChange={handleInputChange}
      onInputSubmit={activeInputStep?.onSubmit ?? (() => {})}
      confirmDeleteDescription={mode === "confirm-delete" ? (pendingDelete?.description ?? null) : null}
      lastDeletedDescription={lastDeleted?.description ?? null}
      projectSuggestions={projectSuggestions}
      tagSuggestions={tagSuggestions}
      selectedSuggestionIndex={suggestionIndex}
      searchQuery={searchQuery}
    />
  );
}

// Ink draws into the normal scrollback by default, so the last frame stays
// printed in the shell after quitting. The alternate screen buffer (the same
// mechanism vim/htop/less use) makes the dashboard fully replace the terminal
// while running and fully disappear on exit, restoring whatever was there
// before. Restoring is registered on process "exit" (not just in `quit()`) so
// the terminal isn't left stuck on the alt screen if the process ever exits
// some other way (an uncaught error's process.exit(1), etc).
const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";

export function renderDashboard(ctx: SyncContext, config: Config): void {
  process.stdout.write(ENTER_ALT_SCREEN);
  process.on("exit", () => process.stdout.write(EXIT_ALT_SCREEN));
  render(<App ctx={ctx} config={config} />);
}
