#!/usr/bin/env node
import { Command } from "commander";
import { buildContext } from "./bootstrap.js";
import { runStart } from "./commands/start.js";
import { runAdd } from "./commands/add.js";
import { runEditEntry } from "./commands/editEntry.js";
import { runStop } from "./commands/stop.js";
import { runStatus, formatDuration } from "./commands/status.js";
import { runListProjects } from "./commands/listProjects.js";
import { runContinue } from "./commands/continueLast.js";
import { runReport, type ReportRange } from "./commands/report.js";
import { runConfigShow, runConfigUpdate, formatConfig } from "./commands/config.js";
import type { DegradedReason } from "./cache/sync.js";
import { getCacheDir, getConfigDir } from "./cache/paths.js";
import { checkForUpdate, getCurrentVersion } from "./updateCheck.js";
import { getCompletionScript } from "./completion.js";
import { installCompletion } from "./completionInstall.js";

const program = new Command();
program.name("toggl").version(getCurrentVersion(), "-v, --version", "print the installed version");

function degradedNotice(reason: DegradedReason): string {
  return reason === "offline"
    ? "(offline — showing cached data)"
    : "(rate limit budget reached — showing cached data)";
}

function collectTag(value: string, previous: string[]): string[] {
  return [...previous, value];
}

program
  .command("start <description>")
  .option("--project <name>")
  .option("--tag <name>", "add a tag (repeatable)", collectTag, [] as string[])
  .action(async (description: string, opts: { project?: string; tag: string[] }) => {
    const { ctx, config } = await buildContext();
    const timer = await runStart(ctx, config, {
      description,
      projectName: opts.project,
      tags: opts.tag.length > 0 ? opts.tag : undefined,
    });
    console.log(`Started: ${timer.description}`);
  });

program
  .command("add <description>")
  .requiredOption("--start <HH:MM>", "start time, today")
  .requiredOption("--end <HH:MM>", "end time, today")
  .option("--project <name>")
  .option("--tag <name>", "add a tag (repeatable)", collectTag, [] as string[])
  .action(async (description: string, opts: { start: string; end: string; project?: string; tag: string[] }) => {
    const { ctx, config } = await buildContext();
    const entry = await runAdd(ctx, config, {
      description,
      start: opts.start,
      end: opts.end,
      projectName: opts.project,
      tags: opts.tag.length > 0 ? opts.tag : undefined,
    });
    console.log(`Added: ${entry.description} (${formatDuration(entry.durationSeconds ?? 0)})`);
  });

program
  .command("edit <id>")
  .option("--description <text>")
  .option("--project <name>")
  .option("--start <HH:MM>", "change the start time (works on a running entry too)")
  .option("--end <HH:MM>", "change the end time")
  .option("--tag <name>", "add a tag (repeatable, replaces existing tags)", collectTag, [] as string[])
  .action(async (id: string, opts: { description?: string; project?: string; start?: string; end?: string; tag: string[] }) => {
    const entryId = Number(id);
    if (!Number.isInteger(entryId)) {
      console.error(`Invalid entry id: "${id}"`);
      process.exit(1);
    }
    const { ctx, config } = await buildContext();
    const entry = await runEditEntry(ctx, config, entryId, {
      description: opts.description,
      projectName: opts.project,
      start: opts.start,
      end: opts.end,
      tags: opts.tag.length > 0 ? opts.tag : undefined,
    });
    console.log(`Updated: ${entry.description}`);
  });

program.command("stop").action(async () => {
  const { ctx, config } = await buildContext();
  const entry = await runStop(ctx, config);
  console.log(`Stopped: ${entry.description}`);
});

program.command("status").action(async () => {
  const { ctx } = await buildContext();
  console.log(await runStatus(ctx));
});

program.command("list-projects").action(async () => {
  const { ctx } = await buildContext();
  const { data: projects, degraded } = await runListProjects(ctx);
  if (degraded) console.error(degradedNotice(degraded));
  projects.forEach((p) => console.log(p.name));
});

program.command("continue").action(async () => {
  const { ctx, config } = await buildContext();
  const timer = await runContinue(ctx, config);
  console.log(`Continuing: ${timer.description}`);
});

program
  .command("report [range]")
  .action(async (range: string = "today") => {
    if (range !== "today" && range !== "week") {
      console.error(`Unknown report range: "${range}". Use "today" or "week".`);
      process.exit(1);
    }
    const { ctx } = await buildContext();
    const { data: summaries, degraded } = await runReport(ctx, range as ReportRange);
    if (degraded) console.error(degradedNotice(degraded));
    summaries.forEach((s) => console.log(`${s.projectName}: ${formatDuration(Math.round(s.totalSeconds))}`));
  });

function parsePositiveInt(label: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${label}: "${value}"`);
  return n;
}

program
  .command("config")
  .description("show togglr's settings, or change them")
  .option("--token", "prompt for a new API token (also re-detects the default workspace)")
  .option("--workspace <id>", "change the workspace id used for new/edited entries")
  .option("--cache-ttl-projects <seconds>", "change the projects cache TTL")
  .option("--cache-ttl-entries <seconds>", "change the time-entries cache TTL")
  .action(
    async (opts: { token?: boolean; workspace?: string; cacheTtlProjects?: string; cacheTtlEntries?: string }) => {
      const configDir = getConfigDir();
      const workspaceId = parsePositiveInt("workspace id", opts.workspace);
      const cacheTtlProjects = parsePositiveInt("cache TTL", opts.cacheTtlProjects);
      const cacheTtlEntries = parsePositiveInt("cache TTL", opts.cacheTtlEntries);
      if (!opts.token && workspaceId === undefined && cacheTtlProjects === undefined && cacheTtlEntries === undefined) {
        console.log(await runConfigShow(configDir));
        return;
      }
      const next = await runConfigUpdate(configDir, {
        newToken: opts.token,
        workspaceId,
        cacheTtlProjects,
        cacheTtlEntries,
      });
      console.log(formatConfig(next));
    }
  );

program
  .command("completion <shell>")
  .description("print a shell completion script (bash or zsh), or --install it into your rc file")
  .option("--install", "append the eval line to ~/.bashrc or ~/.zshrc instead of printing the script")
  .action(async (shell: string, opts: { install?: boolean }) => {
    const script = getCompletionScript(shell);
    if (!script) {
      console.error(`Unknown shell: "${shell}". Use "bash" or "zsh".`);
      process.exit(1);
    }
    if (opts.install) {
      const { file, alreadyInstalled } = await installCompletion(shell);
      console.log(
        alreadyInstalled
          ? `Already set up in ${file}.`
          : `Added completion setup to ${file}. Restart your shell (or run "source ${file}") to pick it up.`
      );
      return;
    }
    process.stdout.write(script);
  });

async function main() {
  const isTui = process.argv.length <= 2;
  try {
    if (isTui) {
      const { renderDashboard } = await import("./tui/App.js");
      const { ctx, config } = await buildContext();
      renderDashboard(ctx, config);
    } else {
      await program.parseAsync();
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  // Skipped for the TUI: it's a long-running interactive session where an
  // extra stderr write would land awkwardly under Ink's own rendering.
  // Skipped outside a real terminal (CI, scripts, piped output) so this
  // never pollutes non-interactive usage.
  if (!isTui && process.stderr.isTTY) {
    await checkForUpdate(getCacheDir(), getCurrentVersion());
  }
}

main();
