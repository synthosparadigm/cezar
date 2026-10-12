import { describe, expect, it, vi } from 'vitest';
import {
  discoverAntigravityModels,
  parseAntigravityModelsOutput,
  FALLBACK_ANTIGRAVITY_MODELS,
} from './antigravity-model-catalog.ts';

describe('parseAntigravityModelsOutput', () => {
  it('parses tab-separated id and label lines', () => {
    const raw = `Fetching available models...
gemini-3.8-flash-high\tGemini 3.8 Flash (High)
gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
`;
    const models = parseAntigravityModelsOutput(raw);
    expect(models).toEqual([
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', description: '' },
      { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)', description: '' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)', description: '' },
    ]);
  });

  it('dedupes repeated model ids', () => {
    const raw = `gemini-3.8-flash-high\tGemini 3.8 Flash\ngemini-3.8-flash-high\tDuplicate\n`;
    expect(parseAntigravityModelsOutput(raw)).toEqual([
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash', description: '' },
    ]);
  });
});

describe('discoverAntigravityModels', () => {
  it('runs agy models and returns parsed models', async () => {
    const run = vi.fn(async () => ({
      stdout: 'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\n',
      stderr: '',
    }));
    await expect(discoverAntigravityModels({ bin: '/bin/agy', run })).resolves.toEqual([
      { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)', description: '' },
    ]);
    expect(run).toHaveBeenCalledWith('/bin/agy', process.env, 15_000);
  });

  it('falls back to static defaults when binary fails or discovery errors', async () => {
    const run = vi.fn(async () => {
      throw new Error('command not found');
    });
    const models = await discoverAntigravityModels({ bin: '/bin/agy', run });
    expect(models).toEqual(FALLBACK_ANTIGRAVITY_MODELS);
  });
});
