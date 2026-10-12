import type { AgentModelSettingsStrategy } from './types.ts';

/**
 * Google Antigravity's native model settings strategy.
 * Resolves optional model overrides from environment variables.
 */
export const antigravityModelSettingsStrategy: AgentModelSettingsStrategy = {
  runner: 'antigravity',
  async read(_repoRoot, env) {
    const fromEnv = env.CEZ_ANTIGRAVITY_MODEL?.trim() || env.AGY_MODEL?.trim();
    return fromEnv ? { model: fromEnv } : {};
  },
};
