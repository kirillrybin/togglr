import { TogglClient } from "./api/client.js";
import { getCacheDir, getConfigDir } from "./cache/paths.js";
import { DEFAULT_BUDGET_PER_HOUR, type SyncContext } from "./cache/sync.js";
import { ensureConfig } from "./config/ensureConfig.js";
import type { Config } from "./config/config.js";

export interface BootstrapOverrides {
  configDir?: string;
  cacheDir?: string;
}

export async function buildContext(
  overrides: BootstrapOverrides = {}
): Promise<{ ctx: SyncContext; config: Config }> {
  const configDir = getConfigDir(overrides.configDir);
  const cacheDir = getCacheDir(overrides.cacheDir);
  const config = await ensureConfig(configDir);
  const client = new TogglClient(config.apiToken);
  const ctx: SyncContext = {
    client,
    cacheDir,
    ttlSeconds: config.cacheTtl,
    budgetPerHour: DEFAULT_BUDGET_PER_HOUR,
    now: () => new Date(),
  };
  return { ctx, config };
}
