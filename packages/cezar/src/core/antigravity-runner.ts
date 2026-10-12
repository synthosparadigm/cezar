/**
 * Native Google Antigravity Runner (`agy`) for Cezar.
 * Runs agentic workflows using your authenticated Antigravity account and session allowance.
 */
import { ChildProcessWithoutNullStreams, spawn as nodeSpawn } from 'node:child_process';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentEvent,
  AgentRunner,
  AgentRunResult,
  AgentRunSpec,
  AgentSession,
  AgentToolCallRecord,
  ContentBlock,
  SessionOptions,
} from './agent-runner.ts';
import { isSignalTerminationExit, prependSystemPrompt, trackChildExit } from './agent-runner.ts';
import { buildChildEnv } from './agent-env.ts';
import { readNdjson } from './ndjson.ts';
import { resolveAntigravityBin } from './provider-auth.ts';

export const DEFAULT_ANTIGRAVITY_TIMEOUT_MS = 30 * 60_000;
export const ANTIGRAVITY_KILL_GRACE_MS = 10_000;

export interface AntigravityRunnerOptions {
  bin?: string;
  timeoutMs?: number;
}

export type BuildAntigravityArgsInput = {
  userPrompt: string;
  systemPrompt?: string;
  model?: string;
};

export function buildAntigravityArgs(input: BuildAntigravityArgsInput): string[] {
  const prompt = prependSystemPrompt(input.systemPrompt, input.userPrompt);
  const args = ['--dangerously-skip-permissions', '--output-format', 'stream-json'];
  if (input.model?.trim()) {
    args.push('--model', input.model.trim());
  }
  args.push('--print', prompt);
  return args;
}

export function mockAntigravityBinPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolvePath(here, '..', '..', 'scripts', 'mock-antigravity.mjs');
}

export function resolveAntigravityRunnerBin(optsBin?: string): string {
  if (optsBin) return optsBin;
  if (process.env.CEZ_DRY_RUN === '1') return mockAntigravityBinPath();
  return resolveAntigravityBin();
}

function wrapSpawnError(err: unknown, bin: string): Error {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') {
    return new Error(
      `\`${bin}\` not found on PATH — install Google Antigravity CLI (\`agy\`) or set CEZ_ANTIGRAVITY_BIN`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode != null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    const fin = (code: number | null) => resolve(code);
    child.once('close', fin);
    child.once('exit', fin);
    child.once('error', () => fin(child.exitCode ?? null));
  });
}

export class AntigravityRunner implements AgentRunner {
  readonly backend = 'antigravity' as const;

  private readonly bin: string;
  private readonly timeoutMs: number;
  private lastSession: AgentSession | null = null;

  constructor(opts: AntigravityRunnerOptions = {}) {
    this.bin = resolveAntigravityRunnerBin(opts.bin);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_ANTIGRAVITY_TIMEOUT_MS;
  }

  run(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult> {
    return this.startSession(spec, onEvent, { autoEndAfterFirstTurn: true }).result;
  }

  async interrupt(): Promise<void> {
    this.lastSession?.interrupt();
  }

  startSession(
    spec: AgentRunSpec,
    onEvent?: (event: AgentEvent) => void,
    opts: SessionOptions = {},
  ): AgentSession {
    const args = buildAntigravityArgs({
      userPrompt: spec.userPrompt,
      systemPrompt: spec.systemPrompt,
      model: spec.model,
    });

    let child: ChildProcessWithoutNullStreams;
    try {
      const isNodeScript = /\.[cm]?js$/.test(this.bin);
      const program = isNodeScript ? process.execPath : this.bin;
      const spawnArgs = isNodeScript ? [this.bin, ...args] : args;
      child = nodeSpawn(program, spawnArgs, {
        cwd: spec.cwd,
        env: buildChildEnv({ backend: this.backend, extraEnv: spec.env }),
      });
    } catch (err) {
      throw wrapSpawnError(err, this.bin);
    }

    let spawnFailed: Error | null = null;
    child.on('error', (err) => {
      spawnFailed = wrapSpawnError(err, this.bin);
    });

    const isExited = trackChildExit(child);
    const toolCalls: AgentToolCallRecord[] = [];
    const textChunks: string[] = [];
    let sessionId = spec.sessionId;
    let tokensUsed = 0;
    let open = true;
    let terminatedByCezar = false;
    let timedOut = false;
    let resultError: string | null = null;
    const stderrChunks: string[] = [];

    const emit = (event: AgentEvent) => {
      if (event.type === 'text') textChunks.push(event.text);
      if (event.type === 'tool-call') toolCalls.push({ id: event.id, name: event.tool, input: event.input });
      if (event.type === 'session') sessionId = event.sessionId;
      if (event.type === 'token-usage') tokensUsed = event.tokensUsed;
      if (event.type === 'error') resultError = event.message;
      onEvent?.(event);
    };

    const limitMs = spec.timeoutMs ?? this.timeoutMs;
    let deadline: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    if (limitMs > 0) {
      deadline = setTimeout(() => {
        timedOut = true;
        terminatedByCezar = true;
        try {
          child.kill('SIGTERM');
        } catch {}
        killTimer = setTimeout(() => {
          if (!isExited()) {
            try {
              child.kill('SIGKILL');
            } catch {}
          }
        }, ANTIGRAVITY_KILL_GRACE_MS);
        killTimer.unref?.();
      }, limitMs);
      deadline.unref?.();
    }

    const result = (async (): Promise<AgentRunResult> => {
      try {
        for await (const line of readNdjson(child.stdout)) {
          let parsed: any;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }

          if (parsed.event === 'init') {
            sessionId = parsed.conversation_id || sessionId;
            if (sessionId) emit({ type: 'session', sessionId });
            opts.onUiEvent?.({ type: 'session.started', sessionId: sessionId ?? '', backend: 'antigravity' });
            opts.onUiEvent?.({ type: 'turn.started', turnId: 'turn_1' });
          } else if (parsed.event === 'step_update') {
            const update = parsed.step_update || {};
            if (update.text_delta) {
              emit({ type: 'text', text: update.text_delta });
              opts.onUiEvent?.({
                type: 'item.delta',
                itemId: `msg_${update.step_index ?? 1}`,
                field: 'text',
                delta: update.text_delta,
              });
            }
            if (update.usage?.total_tokens) {
              emit({ type: 'token-usage', tokensUsed: update.usage.total_tokens });
            }
          } else if (parsed.event === 'result') {
            const res = parsed.result || {};
            if (res.usage?.total_tokens) {
              emit({ type: 'token-usage', tokensUsed: res.usage.total_tokens });
            }
            if (res.status && res.status !== 'SUCCESS') {
              emit({ type: 'error', message: res.response || 'Antigravity task reported failure' });
            }
            emit({ type: 'turn-end' });
            opts.onUiEvent?.({ type: 'turn.completed', turnId: 'turn_1', stopReason: 'end_turn' });
          }
        }
      } catch {
        /* stream closed */
      } finally {
        if (deadline) clearTimeout(deadline);
        if (killTimer) clearTimeout(killTimer);
        open = false;
      }

      const exitCode = await waitForExit(child);
      const text = textChunks.join('').trim();
      if (spawnFailed) throw spawnFailed;

      if (timedOut) {
        const mins = Math.round((limitMs / 60_000) * 10) / 10;
        onEvent?.({ type: 'error', message: `Antigravity agent timed out after ${mins}m and was killed` });
        onEvent?.({ type: 'done' });
        return { text, toolCalls, tokensUsed, sessionId };
      }

      if (terminatedByCezar && isSignalTerminationExit(exitCode)) {
        onEvent?.({ type: 'note', message: `Antigravity agent terminated by Cezar (code ${exitCode})` });
        onEvent?.({ type: 'done' });
        return { text, toolCalls, tokensUsed, sessionId };
      }

      if (exitCode !== 0 && exitCode !== null) {
        const stderr = stderrChunks.join('').trim();
        const detail = stderr ? ` — ${stderr.split('\n').slice(-3).join(' | ')}` : '';
        const msg = `Antigravity agent exited with code ${exitCode}${detail}`;
        onEvent?.({ type: 'error', message: msg });
        throw new Error(msg);
      }

      if (resultError) throw new Error(resultError);

      onEvent?.({ type: 'done' });
      return { text, toolCalls, tokensUsed, sessionId };
    })();

    child.stderr.on('data', (buf: Buffer) => {
      stderrChunks.push(buf.toString('utf8'));
    });

    const interrupt = () => {
      terminatedByCezar = true;
      open = false;
      try {
        child.kill('SIGTERM');
      } catch {}
    };

    const session: AgentSession = {
      result,
      pid: child.pid,
      sendMessage(_content: ContentBlock[]) {
        onEvent?.({
          type: 'note',
          message: 'Antigravity print mode is one-shot per turn.',
        });
        return false;
      },
      end() {
        interrupt();
      },
      interrupt,
      get open() {
        return open;
      },
    };

    this.lastSession = session;
    return session;
  }
}
