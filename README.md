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
**The `-g` flag is required** — without it, npm installs the package into
the local `node_modules` instead of putting a command on your `PATH`, and
`toggl`/`togglr` won't be found by your shell.

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
detected automatically. Use `toggl config` afterwards to view or change
any of this (token, workspace id, cache TTLs) without hand-editing the file.

## Usage

```bash
toggl start "Coding on togglr" [--project <name>] [--tag <name>]...
toggl add "Coding on togglr" --start 09:00 --end 11:30 [--project <name>] [--tag <name>]...
toggl edit <id> [--description <text>] [--project <name>] [--start <HH:MM>] [--end <HH:MM>] [--tag <name>]...
toggl stop
toggl status
toggl continue
toggl list-projects
toggl report [today|week] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--csv]
toggl config [--token] [--workspace <id>] [--cache-ttl-projects <seconds>] [--cache-ttl-entries <seconds>]
toggl completion <bash|zsh> [--install]
toggl --version
toggl
```

`toggl` and `togglr` are equivalent — both point at the same binary.

| Command | Description |
|---|---|
| `start "<description>" [--project <name>] [--tag <name>]...` | Start a new timer (`--tag` is repeatable) |
| `add "<description>" --start <HH:MM> --end <HH:MM> [--project <name>] [--tag <name>]...` | Manually add a completed entry for today (e.g. forgot to track something) |
| `edit <id> [--description] [--project] [--start] [--end] [--tag]...` | Edit an existing entry by its Toggl id (only the given fields change; `--start`/`--end` can be given independently, including on a still-running entry) |
| `stop` | Stop the running timer |
| `status` | Show the current timer and elapsed time (no network call) |
| `continue` | Repeat the most recent time entry |
| `list-projects` | List cached projects |
| `report [today\|week] [--from] [--to] [--csv]` | Print a per-project time breakdown. `--from`/`--to` (`YYYY-MM-DD`, `--to` inclusive, defaults to today) override the preset range; `--csv` prints `project,duration,seconds` instead of plain text |
| `config` | Show current settings (token masked); with `--token`/`--workspace`/`--cache-ttl-projects`/`--cache-ttl-entries`, changes them instead |
| `completion <bash\|zsh> [--install]` | Print a shell completion script, or `--install` it into your rc file — see [Shell completion](#shell-completion) |
| `--version` / `-v` | Print the installed version |
| *(no arguments)* | Launch the TUI dashboard |

### TUI dashboard

Running `toggl` with no arguments opens a live dashboard: the current
timer, a today/week summary, and recent entries (shown as
`description [project] #tag1 #tag2 — duration (start–end)`, project/tags
omitted when there aren't any, and the `(start–end)` range omitted for the
still-running entry, which has no end yet). Up to 20 recent entries are
kept, displayed through a scrolling 5-row window that follows the highlight
(`↑ N more` / `↓ N more` indicate what's scrolled off-screen). The
dashboard runs in the terminal's alternate screen buffer (like
`vim`/`htop`), so it fully disappears on exit instead of leaving its last
frame in your shell.

| Key | Action |
|---|---|
| `s` | Stop the running timer |
| `c` | Continue the highlighted entry |
| `n` | Start a new timer: prompts for a description, then a project, then tags (same autocomplete as `e`'s steps below) |
| `e` | Edit the highlighted entry (description → start → end → project → tags, one prompt per field; the running entry has no end yet, so that step is skipped). Project: type to filter, `↑`/`↓` to highlight a match, `Enter` to pick it or submit the typed text as-is. Tags: comma-separated, replaces the existing set; `↑`/`↓` highlights a match for the segment you're currently typing (after the last comma) and `Tab` inserts it, leaving `Enter` free to submit the whole line whenever you're done. Blank leaves either field unchanged |
| `d` | Delete the highlighted entry (asks for `y`/`n` confirmation first) |
| `j` / `k` or `↓` / `↑` | Move the highlight up/down the recent-entries list |
| `/` | Filter the recent-entries list by description, project, or tag — matches live as you type. `Enter` keeps the filter applied after closing the prompt (submit blank to clear it); `Esc` cancels the edit without changing whatever filter was already active. Filtering never spends API budget — it only searches what's already cached |
| `r` | Force refresh (bypasses the cache TTL and rate-limit budget for one call) |
| `q` | Quit |
| `Esc` `Esc` | Quit (press twice quickly — works from anywhere, including mid-wizard) |

## Shell completion

```bash
toggl completion bash --install   # appends to ~/.bashrc
toggl completion zsh --install    # appends to ~/.zshrc
```

Idempotent — running it again just reports it's already set up instead of
adding a duplicate line. Restart your shell (or `source` the rc file)
afterwards. Prefer to do it by hand, or use a different rc file? Add one of
these yourself instead:

```bash
eval "$(toggl completion bash)"   # ~/.bashrc
eval "$(toggl completion zsh)"    # ~/.zshrc, before compinit if you call it explicitly
```

Completes subcommand names, plus `report`'s `today`/`week` argument and
`completion`'s own `bash`/`zsh` argument. It doesn't complete things that
would require a network call (project/entry names) — see [Caching & rate
limits](#caching--rate-limits) for why that's deliberately avoided outside
the app's own cache/budget accounting.

## Update notifications

After a one-shot command finishes (not the TUI, and only in an interactive
terminal), togglr checks npm for a newer published version — at most once a
day — and prints a short reminder if one exists. This never touches your
Toggl API rate-limit budget; it's a separate, throttled check against the
npm registry.

## Caching & rate limits

| Cache file | TTL | Notes |
|---|---|---|
| `~/.cache/togglr/projects.json` | 6 hours | |
| `~/.cache/togglr/time_entries.json` | 5 minutes | Invalidated after `stop` |
| `~/.cache/togglr/timer.json` | — | Local source of truth for the active timer, not TTL-based |
| `~/.cache/togglr/rate_limit.json` | — | Rolling 1-hour log of API calls, used to enforce the 25/hour budget |
| `~/.cache/togglr/update_check.json` | 24 hours | Last npm version check, unrelated to the Toggl budget |

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
