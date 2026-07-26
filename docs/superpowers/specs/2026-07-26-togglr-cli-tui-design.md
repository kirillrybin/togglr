# togglr — Toggl Track CLI/TUI — Design

## Summary

A Node.js/TypeScript command-line tool for Toggl Track that supports both quick
one-shot commands (`toggl start "..."`, `toggl stop`) and a full-screen TUI
dashboard (`toggl` with no arguments) built with Ink. The overriding
architectural constraint is Toggl's API rate limit of **30 requests/hour**:
all reads go through a local file cache with per-entity TTLs, and only
mutating actions (start/stop/continue) talk to the API directly.

## Goals

- Start/stop time tracking from the terminal with a single command.
- A TUI dashboard showing the live timer, recent entries, and a day/week
  summary, without exceeding the Toggl API rate limit.
- Never spend more than a small fraction of the 30 req/hour budget on
  background syncing; degrade gracefully (serve stale cache) rather than
  hit 429s.

## Non-goals (MVP)

- Multi-workspace switching (first available workspace is used automatically).
- Editing/deleting past time entries.
- Full Toggl Reports API integration (reports are computed locally from
  cached time entries instead).
- A persistent background daemon process.

## Tech Stack

- TypeScript, Node.js ≥ 18
- Ink (React-based renderer) for the TUI
- Commander (or yargs) for CLI argument parsing
- Native `fetch`/`undici` for HTTP against Toggl API v9
- Vitest for tests, `ink-testing-library` for TUI smoke tests

## Architecture

```
src/
  api/          — thin Toggl API v9 client (auth header, retry/backoff, response types)
  cache/        — cache file read/write, TTL logic, rate-limit budget tracking
  domain/       — models (Project, TimeEntry, Timer) + pure logic (report aggregation)
  commands/     — one module per command (start.ts, stop.ts, status.ts, list.ts, report.ts, continue.ts)
  tui/          — Ink components for the dashboard
  config/       — reads/writes ~/.config/togglr/config.json
  cli.ts        — entry point: no args → tui/, command arg → commands/
```

**Key boundary:** `tui/` and `commands/` never call `api/` directly — only
through `cache/`, which alone decides whether a real HTTP call is needed
(TTL expired) or a cached value should be returned. This is the single place
where the "spend budget or not" decision is made, so it's easy to test and to
change policy later without touching command or UI code.

## Caching & Rate-Limit Budget

Cache files live under `~/.cache/togglr/`:

| File | Content | Default TTL | Invalidated by |
|---|---|---|---|
| `projects.json` | workspace projects/tags | 6 hours | manual `--refresh` |
| `time_entries.json` | entries from the last ~14 days | 5 minutes | immediately after start/stop/continue |
| `timer.json` | current active timer (id, project, start ts) | not TTL-based — it's the source of truth, updated locally on start/stop | — |

Before any read-only command (`status`, `list`, `report`) the `cache/` layer
checks `last_synced_at + ttl < now`. If fresh, zero API calls are made. If
stale, **one** batched refresh call is made using Toggl v9's
`/me?with_related_data=true`, which returns workspaces, projects, and the
current timer in a single request — avoiding one call per entity type.

Mutating commands always hit the API directly (to avoid drifting from the
server): `start` → 1 POST, `stop` → 1 PATCH, `continue` → 1 POST. The
response from these calls updates the local cache immediately, so no
separate sync is needed right after a mutation.

**Budget safety:** `cache/` keeps a rolling-hour log of request timestamps in
`rate_limit.json`. If the remaining budget for the current hour is low, a
background/TTL-triggered refresh is skipped and the stale cache is served
with a "stale" indicator in the TUI, rather than risking a 429 from Toggl.
Mutating commands (start/stop/continue) are never throttled this way, since
skipping them would mean the user's action silently didn't happen.

**Live timer display:** the running timer's duration is computed locally as
`now - timer.json.start` and re-rendered every second in the TUI — no network
calls involved.

**Sync trigger:** sync-on-invocation. Every command checks cache staleness at
startup; there is no persistent background daemon. While the TUI dashboard is
open, it re-checks staleness on an interval (`setInterval` inside the running
process) for as long as it stays open.

## CLI Commands (MVP)

- `toggl start "<description>" [--project <name>] [--tag <name>]` — creates a
  running time entry, updates `timer.json`.
- `toggl stop` — stops the current timer.
- `toggl status` — prints the current timer (no network call, reads
  `timer.json`).
- `toggl list projects` — lists cached projects (auto-refreshes if TTL
  expired).
- `toggl continue` — repeats the last entry (same project/description/tags)
  from `time_entries.json`.
- `toggl report [today|week|--from --to]` — aggregates time by project,
  computed locally from `time_entries.json`, no extra API calls.
- `toggl` (no arguments) — launches the TUI dashboard.

All commands exit `0`/`1` with human-readable output, suitable for scripting
or shell aliases.

## TUI Dashboard (Ink)

Default view on launch:

```
┌─ togglr ─────────────────────────────────────────┐
│ ● Coding on togglr        00:42:17    [s] stop    │
├────────────────────────────────────────────────────┤
│ Today: 3h 12m   |  Week: 14h 05m                  │
├─ Recent entries ───────────────────────────────────┤
│ Coding on togglr        1h 20m   [c] continue      │
│ Standup                   15m    [c] continue      │
│ Review PR #42            45m    [c] continue      │
└────────────────────────────────────────────────────┘
[n] new timer  [q] quit
```

Keybindings: `s` stop, `c` continue selected entry, `n` new timer (inline
form for description/project), `r` force refresh (bypasses throttle when the
user explicitly asks), `q` quit. The entry list and day/week summary render
from the cache loaded at TUI startup; the process re-reads the cache on its
own TTL-driven interval while it stays open.

## Config & Auth

`~/.config/togglr/config.json` (mode 600):

```json
{
  "apiToken": "...",
  "workspaceId": 12345,
  "cacheTtl": { "projects": 21600, "timeEntries": 300 }
}
```

On first run without a token, an interactive Ink prompt asks for the Toggl
API token (Profile → API Token) and saves it to config. The workspace is
auto-selected as the first one returned by the API (no picker in MVP).

## Error Handling

- Network unreachable / Toggl down: read commands (`status`, `report`,
  `list`) silently fall back to cache with an "offline, showing cached data"
  notice. Mutating commands (`start`/`stop`) fail explicitly and leave local
  state untouched, to avoid desyncing `timer.json` from the server.
- `429` from Toggl (if throttling still misses one): back off respecting
  `Retry-After`; cache is left as-is; the command returns a clear error.
- `401` (invalid/expired token): error message instructing the user to
  re-enter their token via the token prompt.

## Testing

- Vitest throughout.
- `api/` is mocked in tests — no real HTTP calls.
- `cache/` TTL and throttle-decision logic: unit tests on pure functions with
  fake timestamps.
- `domain/` report aggregation: unit tests against time-entry fixtures.
- `tui/`: smoke-test rendering via `ink-testing-library`; full interaction
  coverage is out of scope for MVP given low ROI.
