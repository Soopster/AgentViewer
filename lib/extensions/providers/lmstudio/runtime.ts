// Provider architecture extraction: SDK behavior preserved from the session backend.
import { steerViewSession } from '../../../sessionSteering'
import { listPendingProviderPermissionPayloads } from '../../../sessionControlPlane'
import { createTurnUsageReporter } from '../runtimeCore'
import { coordinatorPermissionToken } from "../../../coordinatorNativePermission";
import { extractPendingPermissions } from "../../../permissions";
import { broadcastLiveSessionActivity, broadcastLiveSessionTurnEnd, broadcastLiveSessionTurnStart } from "../../../liveSessionHarness";
import { PendingRequestGoneError } from "../../../pendingRequestGone";
import { clearRunningSession, setRunningSession } from "../../../sessionRuntime";
import type { TurnCheckpoint } from "../../../checkpoints";
import type { AgentProvider, ReasoningEffortLevel } from "../../../types";
import type { DynamicToolSpec } from "../../../codex-schema/v2";
import { appendLmstudioTurn, createLmstudioSession, getLmstudioSession, streamLmstudioChatCompletion } from "../../../lmstudioClient";
export type SendMessageParams = {
    sessionId: string;
    signal: AbortSignal;
    body: Record<string, unknown>;
    provider?: AgentProvider;
};
export type ForkParams = {
    sessionId: string;
    body: Record<string, unknown>;
    provider?: AgentProvider;
};
export type RewindParams = {
    sessionId: string;
    body: Record<string, unknown>;
    provider?: AgentProvider;
};
export type SessionActionParams = {
    sessionId: string;
    body: Record<string, unknown>;
    provider?: AgentProvider;
};
export async function runAction({ sessionId, body, provider }: SessionActionParams): Promise<Record<string, unknown>> {
    const resolvedProvider = "lmstudio";
    const action = typeof body.action === 'string' ? body.action : '';
    // Guard again after provider resolution/pool awaits. Remote confirmation
    // cannot fall through to a different session's similarly named request.
    if ((action === 'respondPermission' || action === 'respondQuestion') && typeof body.expectedPermissionToken === 'string') {
        const pending = extractPendingPermissions(listPendingProviderPermissionPayloads(sessionId, "lmstudio"), { sessionId, provider: "lmstudio" });
        if (!pending.some(permission => permission.id === body.permissionId && coordinatorPermissionToken(permission) === body.expectedPermissionToken)) {
            throw new PendingRequestGoneError(action === 'respondQuestion' ? 'Question' : 'Permission request');
        }
    }
    // Provider-agnostic: deliver a user message into the running turn (native
    // steering). `delivered: false` means no running turn / no steer primitive /
    // the turn ended while the request was in flight — callers fall back to
    // queueing the message for the next turn.
    if (action === 'steer') {
        return steerViewSession(sessionId, body, "lmstudio");
    }
    throw new Error(`Action ${action || '(missing)'} is not supported for ${"lmstudio"} sessions`);
}
/**
 * Warm the send path for a session before the user hits Enter. Fresh-session
 * creation awaits this before enabling the composer; existing sessions call it
 * on focus so expensive setup can overlap with typing:
 * - claude: spawn the warm pool Query the send will attach to (the CLI boot is
 *   ~1-3s — the dominant first-send cost). Skipped when an entry already
 *   exists so a prewarm can never recycle a live or in-turn entry.
 * - codex: start the app-server if needed and resume the thread (cached).
 * - pi: open the pooled AgentSession (createAgentSession runs resource loading
 *   + package resolution on a cold open; the pool makes this idempotent).
 * - copilot: resume the SDK session (cached by the copilot client).
 * Opencode connects through a long-lived local server — cheap per-send.
 * Existing-session focus treats failures as best-effort. Fresh-session loading
 * surfaces them and keeps sending disabled rather than racing a cold runtime.
 */
export async function prewarm(params: {
    sessionId: string;
    provider?: AgentProvider;
    cwd?: string;
    model?: string;
    effort?: ReasoningEffortLevel;
    isPending?: boolean;
}): Promise<void> {
    const provider = "lmstudio";
}
export async function createLmstudioStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
    const userMessage = String(body.message ?? '').trim();
    const selectedModel = typeof body.model === 'string' ? body.model : undefined;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            let downstreamClosed = false;
            const safeEnqueue = (chunk: string) => {
                if (downstreamClosed)
                    return;
                try {
                    controller.enqueue(encoder.encode(chunk));
                }
                catch {
                    downstreamClosed = true;
                }
            };
            const close = () => {
                if (downstreamClosed)
                    return;
                downstreamClosed = true;
                try {
                    controller.close();
                }
                catch {
                    /* downstream already closed */
                }
            };
            const record = await getLmstudioSession(sessionId);
            if (!record) {
                safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: `LM Studio session not found: ${sessionId}` })}\n\n`);
                close();
                return;
            }
            setRunningSession(sessionId, {
                provider: 'lmstudio',
                interrupt: async () => undefined,
            });
            broadcastLiveSessionTurnStart('lmstudio', sessionId);
            safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId, provider: 'lmstudio' })}\n\n`);
            try {
                const model = selectedModel || record.model;
                // Live output tokens for the composer status line, over the same
                // `turn-usage` frame every other provider reports on. OpenAI-style
                // streams carry `completion_tokens` as an absolute running total (and
                // usually only on the final chunk), which is exactly the frame's
                // contract — forward it whenever it moves rather than accumulating.
                const reportTurnUsage = createTurnUsageReporter(safeEnqueue);
                const result = await streamLmstudioChatCompletion(record.messages, userMessage, model, signal, (delta) => {
                    if (delta.content) {
                        broadcastLiveSessionActivity('lmstudio', sessionId);
                        safeEnqueue(`data: ${JSON.stringify({ type: 'lmstudio_delta', delta: delta.content })}\n\n`);
                    }
                    reportTurnUsage(delta.usage?.completion_tokens);
                });
                reportTurnUsage(result.usage?.completionTokens);
                await appendLmstudioTurn(sessionId, userMessage, result.text, result.model, result.usage);
            }
            catch (err) {
                if (!signal.aborted) {
                    safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown LM Studio error' })}\n\n`);
                }
            }
            finally {
                clearRunningSession(sessionId);
                broadcastLiveSessionTurnEnd('lmstudio', sessionId);
                close();
            }
        },
    });
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
        },
    });
}
/** Existing SDK dispatch, reached only through bundled extension runtime entries. */
export async function streamTurn(params: SendMessageParams, checkpoint?: Promise<TurnCheckpoint | null>): Promise<Response> {
    const provider = "lmstudio";
    // Other providers don't yet have that explicit submission boundary — keep
    // the original blocking ordering for them until they gain one.
    await checkpoint?.catch(() => null);
    {
        return createLmstudioStream(params.sessionId, params.signal, params.body);
    }
}
export async function forkSession({ sessionId, body, provider }: ForkParams): Promise<{
    sessionId: string;
}> {
    const resolvedProvider = "lmstudio";
    {
        void sessionId;
        void body;
        throw new Error('Fork is not supported for LM Studio sessions');
    }
}
export async function createSession({ provider: providerOverride, cwd, title, codexDynamicTools, }: {
    provider?: AgentProvider;
    cwd?: string;
    title?: string;
    // Codex has no equivalent of Claude's per-query mcpServers lookup — custom
    // tools are declared once at thread/start and can't be added afterward
    // (see lib/agentCoordinationSdkTools.ts's Codex section), so a coordinator
    // caller must pass its static coord_* tool specs through session creation
    // itself rather than registering them after the fact like every other
    // provider.
    codexDynamicTools?: DynamicToolSpec[];
}): Promise<{
    sessionId: string;
    provider: AgentProvider;
    cwd: string;
    isPending: boolean;
}> {
    const provider = "lmstudio";
    const resolvedCwd = (cwd && cwd.trim()) ? cwd : process.cwd();
    {
        const record = await createLmstudioSession(resolvedCwd, title);
        return { sessionId: record.id, provider: "lmstudio", cwd: resolvedCwd, isPending: false };
    }
}
/** Release provider-side resources for an active session without deleting its durable history. */
export async function closeSession(sessionId: string, providerOverride?: AgentProvider): Promise<void> {
    const provider = "lmstudio";
}
export function listPendingPermissions(sessionId: string, provider?: AgentProvider): Record<string, unknown>[] {
    return [];
}
/** Process-local control-plane state for fleet and attention clients. */
export async function rewindSession({ sessionId, body, provider }: RewindParams): Promise<Record<string, unknown>> {
    const resolvedProvider = "lmstudio";
    {
        void sessionId;
        void body;
        throw new Error('Rewind is not supported for LM Studio sessions');
    }
}
export function readMemoryDiagnostics(): Record<string, number> {
    return {};
}

import type { ProviderRuntime } from '../types'
export const runtime = {
  createSession: createSession,
  streamTurn: streamTurn,
  prewarm: prewarm,
  runAction: runAction,
  forkSession: forkSession,
  rewindSession: rewindSession,
  closeSession: closeSession,
  listPendingPermissions: listPendingPermissions,
  getMemoryDiagnostics: readMemoryDiagnostics,
} satisfies ProviderRuntime
