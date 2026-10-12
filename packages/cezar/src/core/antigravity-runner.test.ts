import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunner } from './runner-factory.ts';
import {
  buildAntigravityArgs,
  AntigravityRunner,
  mockAntigravityBinPath,
} from './antigravity-runner.ts';

describe('buildAntigravityArgs', () => {
  it('builds stream-json print args', () => {
    const args = buildAntigravityArgs({ userPrompt: 'fix bug', systemPrompt: 'be concise', model: 'gemini-3.8-flash-medium' });
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--model');
    expect(args).toContain('gemini-3.8-flash-medium');
    expect(args).toContain('--print');
    expect(args.at(-1)).toBe('be concise\n\n---\n\nfix bug');
  });
});

describe('createRunner(antigravity)', () => {
  it('returns AntigravityRunner', () => {
    const runner = createRunner('antigravity');
    expect(runner.backend).toBe('antigravity');
  });
});

describe('AntigravityRunner mock bin', () => {
  it('feeds stream-json and emits session, text, turn-end, and done', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agy-runner-'));
    try {
      const events: Array<{ type: string }> = [];
      const runner = new AntigravityRunner({
        bin: mockAntigravityBinPath(),
        timeoutMs: 15_000,
      });

      const result = await runner.run({ userPrompt: 'hello world', cwd }, (e) => events.push(e));
      expect(result.sessionId).toBe('mock-antigravity-session');
      expect(result.text).toContain('mock: antigravity');
      expect(events.map((e) => e.type)).toEqual(['session', 'text', 'token-usage', 'token-usage', 'turn-end', 'done']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects gracefully when binary is missing without crashing process', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agy-runner-missing-'));
    try {
      const runner = new AntigravityRunner({ bin: '/nonexistent/agy-xyz', timeoutMs: 15_000 });
      await expect(runner.run({ userPrompt: 'hi', cwd })).rejects.toThrow(/not found on PATH/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
