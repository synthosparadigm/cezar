import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveAntigravityBin } from './provider-auth.ts';
import type { ModelOption } from './runner-model-catalog.ts';

const exec = promisify(execFile);

export interface AntigravityModelDiscoveryOptions {
  bin?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  run?: (bin: string, env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<{ stdout: string; stderr: string }>;
}

const DEFAULT_DISCOVERY_TIMEOUT_MS = 15_000;
const MAX_MODELS = 500;

export const FALLBACK_ANTIGRAVITY_MODELS: ModelOption[] = [
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)', description: 'Default fast reasoning agent' },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', description: 'High capability Gemini 3.8 Flash model' },
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)', description: 'Low latency Gemini Flash' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)', description: 'Claude Sonnet 4.6 with thinking tokens' },
  { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)', description: 'Claude Opus 4.6 deep reasoning' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)', description: 'Open weight large reasoning model' },
];

/**
 * Parse `agy models` output.
 * Lines format: `<id>\t<label>` or `<id>`.
 */
export function parseAntigravityModelsOutput(text: string): ModelOption[] {
  const models: ModelOption[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.includes('Fetching available models') || line.includes('Available models')) {
      continue;
    }
    const parts = line.split(/\t+/);
    if (parts.length >= 2) {
      const id = parts[0]!.trim();
      const label = parts[1]!.trim();
      if (!id || seen.has(id)) continue;
      if (models.length >= MAX_MODELS) break;
      seen.add(id);
      models.push({ id, label: label || id, description: '' });
    } else if (parts.length === 1 && parts[0]) {
      const id = parts[0]!.trim();
      if (!id || seen.has(id)) continue;
      if (models.length >= MAX_MODELS) break;
      seen.add(id);
      models.push({ id, label: id, description: '' });
    }
  }

  return models;
}

/** Discover models from Google Antigravity CLI (`agy models`). */
export async function discoverAntigravityModels(
  options: AntigravityModelDiscoveryOptions = {},
): Promise<ModelOption[]> {
  const bin = resolveAntigravityBin(options.bin);
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  const env = options.env ?? process.env;
  const run =
    options.run ??
    (async (executable, runEnv, timeout) =>
      exec(executable, ['models'], { timeout, env: runEnv, maxBuffer: 2 * 1024 * 1024 }));

  try {
    const { stdout, stderr } = await run(bin, env, timeoutMs);
    const models = parseAntigravityModelsOutput(`${stdout}\n${stderr}`);
    if (models.length > 0) {
      return models;
    }
  } catch {
    // Fall back to well-known defaults if discovery fails or binary is absent
  }

  return FALLBACK_ANTIGRAVITY_MODELS;
}
