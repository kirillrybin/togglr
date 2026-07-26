#!/usr/bin/env node
import { Command } from "commander";
import { buildContext } from "./bootstrap.js";
import { runStart } from "./commands/start.js";
import { runStop } from "./commands/stop.js";
import { runStatus, formatDuration } from "./commands/status.js";
import { runListProjects } from "./commands/listProjects.js";
import { runContinue } from "./commands/continueLast.js";
import { runReport, type ReportRange } from "./commands/report.js";

const program = new Command();
program.name("toggl");

program
  .command("start <description>")
  .option("--project <name>")
  .action(async (description: string, opts: { project?: string }) => {
    const { ctx, config } = await buildContext();
    const timer = await runStart(ctx, config, { description, projectName: opts.project });
    console.log(`Started: ${timer.description}`);
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
  const projects = await runListProjects(ctx);
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
    const { ctx } = await buildContext();
    const summaries = await runReport(ctx, range as ReportRange);
    summaries.forEach((s) => console.log(`${s.projectName}: ${formatDuration(Math.round(s.totalSeconds))}`));
  });

async function main() {
  if (process.argv.length <= 2) {
    const { renderDashboard } = await import("./tui/App.js");
    const { ctx, config } = await buildContext();
    renderDashboard(ctx, config);
  } else {
    await program.parseAsync();
  }
}

main();
