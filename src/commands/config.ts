import readline from "node:readline/promises";
import { TogglClient, type TogglApiClient } from "../api/client.js";
import { readConfig, writeConfig, type Config } from "../config/config.js";

export interface ConfigUpdateOptions {
  newToken?: boolean;
  workspaceId?: number;
  cacheTtlProjects?: number;
  cacheTtlEntries?: number;
}

export interface ConfigDeps {
  prompt?: (question: string) => Promise<string>;
  createClient?: (token: string) => Pick<TogglApiClient, "getMe">;
}

async function defaultPrompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

const NO_CONFIG_MESSAGE = "No config found yet — run any togglr command once to set up.";

// Never print the raw token: first/last 4 chars is enough to recognize which
// one is active without it being usable if someone glances at the screen.
export function maskToken(token: string): string {
  if (token.length <= 8) return "*".repeat(token.length);
  return `${token.slice(0, 4)}${"*".repeat(token.length - 8)}${token.slice(-4)}`;
}

export function formatConfig(config: Config): string {
  return [
    `API token: ${maskToken(config.apiToken)}`,
    `Workspace ID: ${config.workspaceId}`,
    `Cache TTL: projects=${config.cacheTtl.projects}s, time entries=${config.cacheTtl.timeEntries}s`,
  ].join("\n");
}

export async function runConfigShow(configDir: string): Promise<string> {
  const config = await readConfig(configDir);
  if (!config) throw new Error(NO_CONFIG_MESSAGE);
  return formatConfig(config);
}

export async function runConfigUpdate(
  configDir: string,
  opts: ConfigUpdateOptions,
  deps: ConfigDeps = {}
): Promise<Config> {
  const existing = await readConfig(configDir);
  if (!existing) throw new Error(NO_CONFIG_MESSAGE);

  let next = existing;

  if (opts.newToken) {
    const prompt = deps.prompt ?? defaultPrompt;
    const createClient = deps.createClient ?? ((token: string) => new TogglClient(token));
    const token = await prompt("Paste your new Toggl API token (Profile -> API Token): ");
    const client = createClient(token);
    // Re-detecting the workspace here mirrors first-run setup — a new token
    // may well belong to a different account with a different default.
    const me = await client.getMe(false);
    next = { ...next, apiToken: token, workspaceId: me.default_workspace_id };
  }

  if (opts.workspaceId !== undefined) {
    next = { ...next, workspaceId: opts.workspaceId };
  }
  if (opts.cacheTtlProjects !== undefined || opts.cacheTtlEntries !== undefined) {
    next = {
      ...next,
      cacheTtl: {
        projects: opts.cacheTtlProjects ?? next.cacheTtl.projects,
        timeEntries: opts.cacheTtlEntries ?? next.cacheTtl.timeEntries,
      },
    };
  }

  await writeConfig(configDir, next);
  return next;
}
