import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { Project, Timer } from "../domain/models.js";
import { formatDuration } from "../commands/status.js";
import { formatTimeHHMM } from "../commands/add.js";

const PROJECT_SUGGESTION_LIMIT = 5;
const TAG_SUGGESTION_LIMIT = 5;

export function filterProjectSuggestions(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, PROJECT_SUGGESTION_LIMIT);
}

// The tags field is a single comma-separated line (e.g. "urgent, bil"), so
// suggestions are filtered against just the segment being typed right now —
// everything after the last comma — not the whole field.
function currentTagPartial(inputValue: string): string {
  const lastComma = inputValue.lastIndexOf(",");
  return (lastComma === -1 ? inputValue : inputValue.slice(lastComma + 1)).trim();
}

function typedTagsSoFar(inputValue: string): string[] {
  const lastComma = inputValue.lastIndexOf(",");
  const before = lastComma === -1 ? "" : inputValue.slice(0, lastComma);
  return before.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

export function filterTagSuggestions(knownTags: string[], inputValue: string): string[] {
  const partial = currentTagPartial(inputValue).toLowerCase();
  if (!partial) return [];
  const already = new Set(typedTagsSoFar(inputValue));
  return knownTags
    .filter((t) => t.toLowerCase().includes(partial) && !already.has(t.toLowerCase()))
    .slice(0, TAG_SUGGESTION_LIMIT);
}

// Applied on Tab (not Enter, unlike the project step) — tags are multi-value,
// so picking one should let you keep typing the next one rather than
// submitting the whole field. Always appends ", " to set up for that.
export function applyTagSuggestion(inputValue: string, suggestion: string): string {
  const lastComma = inputValue.lastIndexOf(",");
  const before = lastComma === -1 ? "" : `${inputValue.slice(0, lastComma + 1)} `;
  return `${before}${suggestion}, `;
}

export interface RecentEntryView {
  entryId: number;
  description: string;
  totalSeconds: number;
  projectId: number | null;
  projectName: string | null;
  start: string;
  stop: string | null;
  tags: string[];
}

// Client-side only — the whole point is filtering the already-cached recent
// entries without spending any API budget, so it matches everything already
// visible in a row (description, project, tags), not just the description.
export function filterEntries(entries: RecentEntryView[], query: string): RecentEntryView[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) =>
      e.description.toLowerCase().includes(q) ||
      (e.projectName?.toLowerCase().includes(q) ?? false) ||
      e.tags.some((t) => t.toLowerCase().includes(q))
  );
}

const VISIBLE_ENTRY_COUNT = 5;

export function computeVisibleWindow(
  total: number,
  selectedIndex: number,
  visibleCount: number
): { start: number; end: number } {
  if (total <= visibleCount) return { start: 0, end: total };
  const half = Math.floor(visibleCount / 2);
  const start = Math.max(0, Math.min(selectedIndex - half, total - visibleCount));
  return { start, end: start + visibleCount };
}

export interface DashboardProps {
  timer: Timer | null;
  elapsedSeconds: number;
  todayTotalSeconds: number;
  weekTotalSeconds: number;
  recentEntries: RecentEntryView[];
  stale: boolean;
  selectedIndex: number;
  inputMode: boolean;
  inputLabel: string;
  inputValue: string;
  // Forces TextInput to remount (see App.tsx) whenever its value was changed
  // programmatically rather than by the user actually typing.
  inputResetKey: number;
  onInputChange: (value: string) => void;
  onInputSubmit: (value: string) => void;
  confirmDeleteDescription: string | null;
  projectSuggestions: Project[];
  tagSuggestions: string[];
  selectedSuggestionIndex: number | null;
  searchQuery: string;
}

export function Dashboard(props: DashboardProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Box justifyContent="space-between">
        <Text>
          {props.timer ? `● ${props.timer.description}` : "No timer running"}
        </Text>
        <Text>{props.timer ? formatDuration(props.elapsedSeconds) : ""}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Today: {formatDuration(props.todayTotalSeconds)}  |  Week: {formatDuration(props.weekTotalSeconds)}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text underline>Recent entries</Text>
        {props.searchQuery && (
          <Text dimColor>
            Filter: "{props.searchQuery}" ({props.recentEntries.length} match
            {props.recentEntries.length === 1 ? "" : "es"})
          </Text>
        )}
        {props.recentEntries.length === 0 && <Text dimColor>No recent entries</Text>}
        {(() => {
          const { start, end } = computeVisibleWindow(
            props.recentEntries.length,
            props.selectedIndex,
            VISIBLE_ENTRY_COUNT
          );
          return (
            <>
              {start > 0 && <Text dimColor>↑ {start} more</Text>}
              {props.recentEntries.slice(start, end).map((entry, i) => (
                <Text key={start + i} inverse={start + i === props.selectedIndex}>
                  {entry.description}
                  {entry.projectName ? ` [${entry.projectName}]` : ""}
                  {entry.tags.length > 0 ? ` ${entry.tags.map((t) => `#${t}`).join(" ")}` : ""}
                  {" — "}{formatDuration(entry.totalSeconds)}
                  {entry.stop !== null ? ` (${formatTimeHHMM(entry.start)}–${formatTimeHHMM(entry.stop)})` : ""}
                </Text>
              ))}
              {end < props.recentEntries.length && (
                <Text dimColor>↓ {props.recentEntries.length - end} more</Text>
              )}
            </>
          );
        })()}
      </Box>
      {props.stale && (
        <Box marginTop={1}>
          <Text color="yellow">offline / stale data</Text>
        </Box>
      )}
      {props.inputMode ? (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text>{props.inputLabel}: </Text>
            <TextInput
              key={props.inputResetKey}
              value={props.inputValue}
              onChange={props.onInputChange}
              onSubmit={props.onInputSubmit}
            />
          </Box>
          {props.projectSuggestions.map((project, i) => (
            <Text key={project.id} inverse={i === props.selectedSuggestionIndex} dimColor={i !== props.selectedSuggestionIndex}>
              {"  "}{project.name}
            </Text>
          ))}
          {props.tagSuggestions.map((tag, i) => (
            <Text key={tag} inverse={i === props.selectedSuggestionIndex} dimColor={i !== props.selectedSuggestionIndex}>
              {"  "}{tag}{i === props.selectedSuggestionIndex ? " (Tab to insert)" : ""}
            </Text>
          ))}
        </Box>
      ) : props.confirmDeleteDescription !== null ? (
        <Box marginTop={1}>
          <Text color="red">Delete "{props.confirmDeleteDescription}"? (y/n)</Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>[j/k/↑/↓] move  [s] stop  [c] continue  [n] new  [e] edit  [d] delete  [/] search  [r] refresh  [q] quit</Text>
        </Box>
      )}
    </Box>
  );
}
