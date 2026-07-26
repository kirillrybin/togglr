import readline from "node:readline/promises";
import { TogglClient, type TogglApiClient } from "../api/client.js";
import { readConfig, writeConfig, DEFAULT_TTL, type Config } from "./config.js";

export interface EnsureConfigDeps {
  prompt?: (question: string) => Promise<string>;
  createClient?: (token: string) => Pick<TogglApiClient, "getMe">;
}

async function defaultPrompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

export async function ensureConfig(configDir: string, deps: EnsureConfigDeps = {}): Promise<Config> {
  const existing = await readConfig(configDir);
  if (existing) return existing;

  const prompt = deps.prompt ?? defaultPrompt;
  const createClient = deps.createClient ?? ((token: string) => new TogglClient(token));

  const token = await prompt("Paste your Toggl API token (Profile -> API Token): ");
  const client = createClient(token);
  const me = await client.getMe(false);

  const config: Config = { apiToken: token, workspaceId: me.default_workspace_id, cacheTtl: DEFAULT_TTL };
  await writeConfig(configDir, config);
  return config;
}
