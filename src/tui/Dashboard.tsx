import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { Timer } from "../domain/models.js";
import { formatDuration } from "../commands/status.js";

export interface RecentEntryView {
  entryId: number;
  description: string;
  totalSeconds: number;
  projectId: number | null;
  start: string;
  stop: string | null;
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
  onInputChange: (value: string) => void;
  onInputSubmit: (value: string) => void;
  confirmDeleteDescription: string | null;
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
                  {entry.description} — {formatDuration(entry.totalSeconds)}
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
        <Box marginTop={1}>
          <Text>{props.inputLabel}: </Text>
          <TextInput value={props.inputValue} onChange={props.onInputChange} onSubmit={props.onInputSubmit} />
        </Box>
      ) : props.confirmDeleteDescription !== null ? (
        <Box marginTop={1}>
          <Text color="red">Delete "{props.confirmDeleteDescription}"? (y/n)</Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>[j/k/↑/↓] move  [s] stop  [c] continue  [n] new  [e] edit  [d] delete  [r] refresh  [q] quit</Text>
        </Box>
      )}
    </Box>
  );
}
