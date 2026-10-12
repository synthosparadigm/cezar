#!/usr/bin/env node
// Mock `agy` binary for CEZ_DRY_RUN=1 — emits Antigravity-shaped stream-json.

import { appendFileSync } from 'node:fs';

if (process.env.CEZ_MOCK_ARGS_FILE) {
  try {
    appendFileSync(process.env.CEZ_MOCK_ARGS_FILE, `${JSON.stringify(process.argv.slice(2))}\n`);
  } catch {
    /* ignore */
  }
}

const args = process.argv.slice(2);

// Handle `agy models` subcommand
if (args[0] === 'models') {
  process.stdout.write(`Fetching available models...\n`);
  process.stdout.write(`gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n`);
  process.stdout.write(`gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\n`);
  process.stdout.write(`claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n`);
  process.exit(0);
}

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const sessionId = 'mock-antigravity-session';
const prompt = args.at(-1) ?? '';

emit({
  event: 'init',
  conversation_id: sessionId,
});

emit({
  event: 'step_update',
  step_update: {
    step_index: 1,
    text_delta: 'mock: antigravity dry-run completed the task.',
    usage: { total_tokens: 120 },
  },
});

const isError = prompt.includes('mock:error');
emit({
  event: 'result',
  result: {
    status: isError ? 'ERROR' : 'SUCCESS',
    response: isError ? 'mock: antigravity dry-run reported failure.' : 'mock: antigravity dry-run completed the task.',
    usage: { total_tokens: 120 },
  },
});

process.exit(isError ? 1 : 0);
