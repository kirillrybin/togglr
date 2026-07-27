# togglr

A CLI + terminal UI for [Toggl Track](https://toggl.com/track/), built for
quick one-shot commands and a live dashboard — while staying well under
Toggl's API rate limit.

## Why

Toggl Track's API allows **30 requests/hour**. togglr self-limits to
**25/hour** and routes almost every read through a local file cache
(`~/.cache/togglr/`) instead of hitting the API directly. Only mutating
actions (start/stop/continue) always call the API — everything else is
served from cache with a TTL, and gracefully degrades (serving stale data
with a notice) if the budget is exhausted or the network is down.

## Install

```bash
npm install -g @kirillrybin/togglr
```

This gives you both `toggl` and `togglr` commands (they're equivalent).

Requires Node.js ≥ 18.

### From source

```bash
git clone https://github.com/kirillrybin/togglr.git
cd togglr
npm install
npm run build
```

This produces `dist/cli.js`. Run it directly with `node dist/cli.js`, or
link it as local `toggl`/`togglr` binaries:

```bash
npm link
```

## First run

The first time you run any command, togglr prompts for your Toggl API
token (found in Toggl under **Profile → API Token**) and saves it to
`~/.config/togglr/config.json` (mode `600`). Your default workspace is
detected automatically.

## Usage

```bash
toggl start "Coding on togglr" [--project <name>] [--tag <name>]...
toggl add "Coding on togglr" --start 09:00 --end 11:30 [--project <name>] [--tag <name>]...
toggl stop
toggl status
toggl continue
toggl list-projects
toggl report [today|week]
toggl
```

`toggl` and `togglr` are equivalent — both point at the same binary.

| Command | Description |
|---|---|
| `start "<description>" [--project <name>] [--tag <name>]...` | Start a new timer (`--tag` is repeatable) |
| `add "<description>" --start <HH:MM> --end <HH:MM> [--project <name>] [--tag <name>]...` | Manually add a completed entry for today (e.g. forgot to track something) |
| `stop` | Stop the running timer |
| `status` | Show the current timer and elapsed time (no network call) |
| `continue` | Repeat the most recent time entry |
| `list-projects` | List cached projects |
| `report [today\|week]` | Print a per-project time breakdown |
| *(no arguments)* | Launch the TUI dashboard |

### TUI dashboard

Running `toggl` with no arguments opens a live dashboard: the current
timer, a today/week summary, and recent entries.

| Key | Action |
|---|---|
| `s` | Stop the running timer |
| `c` | Continue the highlighted entry |
| `n` | Start a new timer (opens an inline description prompt) |
| `d` | Delete the highlighted entry (asks for `y`/`n` confirmation first) |
| `j` / `k` | Move the highlight up/down the recent-entries list |
| `r` | Force refresh (bypasses the cache TTL and rate-limit budget for one call) |
| `q` | Quit |

## Caching & rate limits

| Cache file | TTL | Notes |
|---|---|---|
| `~/.cache/togglr/projects.json` | 6 hours | |
| `~/.cache/togglr/time_entries.json` | 5 minutes | Invalidated after `stop` |
| `~/.cache/togglr/timer.json` | — | Local source of truth for the active timer, not TTL-based |
| `~/.cache/togglr/rate_limit.json` | — | Rolling 1-hour log of API calls, used to enforce the 25/hour budget |

Both `projects.json` and `time_entries.json` are refreshed together from a
single Toggl `/me` call whenever either goes stale, keeping API usage to a
minimum. TTLs are configurable via `cacheTtl` in `~/.config/togglr/config.json`.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build        # compile to dist/
```

## Architecture

```
src/
  api/       Thin Toggl API v9 client
  domain/    Pure models and report aggregation, no I/O
  cache/     TTL-aware file cache, rate limiter, and the sole
             read/refresh decision point (cache/sync.ts)
  config/    Token/workspace storage and first-run onboarding
  commands/  One module per CLI command
  tui/       Ink dashboard (presentational + container components)
```

`commands/` and `tui/` never call the API client directly for reads — every
read goes through `cache/sync.ts`, which decides whether to serve cache or
refresh. Mutating commands (`start`, `stop`, `continue`) always call the API
directly and are never throttled, but their calls are still recorded against
the rate-limit budget.
