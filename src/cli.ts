#!/usr/bin/env node
import { Command } from "commander";
import { buildContext } from "./bootstrap.js";
import { runStart } from "./commands/start.js";
import { runAdd } from "./commands/add.js";
import { runStop } from "./commands/stop.js";
import { runStatus, formatDuration } from "./commands/status.js";
import { runListProjects } from "./commands/listProjects.js";
import { runContinue } from "./commands/continueLast.js";
import { runReport, type ReportRange } from "./commands/report.js";
import type { DegradedReason } from "./cache/sync.js";

const program = new Command();
program.name("toggl");

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

async function main() {
  try {
    if (process.argv.length <= 2) {
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
}

main();
