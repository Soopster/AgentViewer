// Provider architecture extraction: SDK behavior preserved from the session backend.
import { parseQuestionAnswers } from '../runtimeCore';
import { steerViewSession } from '../../../sessionSteering';
import { listPendingProviderPermissionPayloads } from '../../../sessionControlPlane';
import { coordinatorPermissionToken } from "../../../coordinatorNativePermission";
import { extractPendingPermissions } from "../../../permissions";
import { getCoordinatorAcpMcpServers } from '../../../coordinatorProviderBindings'
import type { AcpProvider } from "../../../provider";
import { COORDINATION_DATA_DIR } from "../../../coordinatorLedger";
import { broadcastLiveSessionActivity, broadcastLiveSessionTurnEnd, broadcastLiveSessionTurnStart } from "../../../liveSessionHarness";
import { PendingRequestGoneError } from "../../../pendingRequestGone";
import { clearRunningSession, setRunningSession } from "../../../sessionRuntime";
import { acpPoolSize, acpPendingRequests, acquireAcpSession, closeAcpSession, getAcpSessionError, interruptAcpSession, peekAcpSession, readAcpMessagesSince, resolveAcpElicitation, respondAcpPermissionDecision, sendAcpPrompt, setAcpSessionModel, waitForAcpActivity } from "../../../acpClientPool";
import { mapAcpBufferedMessages } from "../../../acpMapper";
import { acpAgentKindOf } from "../../../acpAgentSpawn";
import type { TurnCheckpoint } from "../../../checkpoints";
import { rememberSessionInstances, withSessionInstance } from "../../../sessionInstances";
import { currentProviderInstanceId } from "../../../providerInstances";
import type { AgentProvider, ReasoningEffortLevel } from "../../../types";
import type { DynamicToolSpec } from "../../../codex-schema/v2";
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
export const ACP_ACTIVITY_BACKSTOP_MS = 1000;
// A Coordinator participant's coord_* tools. Only the configurable `acp`
// provider can be one; the two built-in transports are not staffed as teammates.
export async function coordinatorAcpMcpServers(provider: AcpProvider, sessionId: string) {
    if (provider !== 'acp')
        return undefined;
    return getCoordinatorAcpMcpServers(sessionId, `${COORDINATION_DATA_DIR}/session-bindings`);
}
export async function createAcpStream(provider: AcpProvider, sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
    const userMessage = String(body.message ?? '').trim();
    const cwd = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : process.cwd();
    const detachOnClientAbort = body.detachOnClientAbort === true;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            let downstreamClosed = false;
            let requestAborted = false;
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
            const onAbort = () => {
                requestAborted = true;
                downstreamClosed = true;
                if (!detachOnClientAbort)
                    void interruptAcpSession(sessionId).catch(() => { });
            };
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted)
                onAbort();
            try {
                await acquireAcpSession(sessionId, acpAgentKindOf(provider), cwd, await coordinatorAcpMcpServers(provider, sessionId));
                // The composer sends its model with every turn; applying it is a no-op
                // when the session is already on it.
                const model = typeof body.model === 'string' ? body.model.trim() : '';
                if (model)
                    await setAcpSessionModel(sessionId, model);
            }
            catch (err) {
                safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to start ACP session' })}\n\n`);
                signal.removeEventListener('abort', onAbort);
                close();
                return;
            }
            // The pool buffer is the canonical transcript across turns. Begin at its
            // current tail so this SSE stream sends only updates caused by the new
            // prompt instead of replaying every prior ACP message on every send.
            let lastIndex = readAcpMessagesSince(sessionId, Number.MAX_SAFE_INTEGER).latestIndex;
            let claimedTurn = false;
            try {
                if (requestAborted && !detachOnClientAbort)
                    return;
                // sendAcpPrompt synchronously claims the pool entry before starting the
                // async prompt. Only publish the running-session handle after that claim
                // succeeds, so a duplicate stream cannot overwrite/clear the real turn.
                sendAcpPrompt(sessionId, userMessage);
                claimedTurn = true;
                setRunningSession(sessionId, {
                    provider,
                    interrupt: async () => {
                        await interruptAcpSession(sessionId);
                    },
                });
                broadcastLiveSessionTurnStart(provider, sessionId);
                safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId, provider })}\n\n`);
                // sendAcpPrompt sets inTurn synchronously before returning, so this
                // activity loop's very first iteration always observes a running turn.
                while (!requestAborted || detachOnClientAbort) {
                    const { messages, latestIndex } = readAcpMessagesSince(sessionId, lastIndex);
                    if (messages.length > 0) {
                        lastIndex = latestIndex;
                        broadcastLiveSessionActivity(provider, sessionId);
                        const mapped = mapAcpBufferedMessages(sessionId, provider, messages);
                        for (const msg of mapped) {
                            safeEnqueue(`data: ${JSON.stringify({ type: 'acp_message', message: msg })}\n\n`);
                        }
                    }
                    const entry = peekAcpSession(sessionId);
                    if (!entry || !entry.alive) {
                        throw new Error(getAcpSessionError(sessionId) ?? 'ACP provider session ended before the turn completed.');
                    }
                    if (!entry.inTurn) {
                        if (entry.lastError)
                            throw new Error(entry.lastError);
                        break;
                    }
                    await waitForAcpActivity(sessionId, lastIndex, ACP_ACTIVITY_BACKSTOP_MS, detachOnClientAbort ? undefined : signal);
                }
            }
            catch (err) {
                if (!requestAborted) {
                    safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown ACP error' })}\n\n`);
                }
            }
            finally {
                signal.removeEventListener('abort', onAbort);
                if (claimedTurn) {
                    clearRunningSession(sessionId);
                    broadcastLiveSessionTurnEnd(provider, sessionId);
                }
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
export function readMemoryDiagnostics(): Record<string, number> {
    return {
        acpPool: acpPoolSize()
    };
}
import type { ProviderRuntime } from '../types';
export function createAcpRuntime(extensionProvider: AcpProvider): ProviderRuntime {
    async function runAction({ sessionId, body, provider }: SessionActionParams): Promise<Record<string, unknown>> {
        const resolvedProvider = extensionProvider;
        const action = typeof body.action === 'string' ? body.action : '';
        // Guard again after provider resolution/pool awaits. Remote confirmation
        // cannot fall through to a different session's similarly named request.
        if ((action === 'respondPermission' || action === 'respondQuestion') && typeof body.expectedPermissionToken === 'string') {
            const pending = extractPendingPermissions(listPendingProviderPermissionPayloads(sessionId, extensionProvider), { sessionId, provider: extensionProvider });
            if (!pending.some(permission => permission.id === body.permissionId && coordinatorPermissionToken(permission) === body.expectedPermissionToken)) {
                throw new PendingRequestGoneError(action === 'respondQuestion' ? 'Question' : 'Permission request');
            }
        }
        // Provider-agnostic: deliver a user message into the running turn (native
        // steering). `delivered: false` means no running turn / no steer primitive /
        // the turn ended while the request was in flight — callers fall back to
        // queueing the message for the next turn.
        if (action === 'steer') {
            return steerViewSession(sessionId, body, extensionProvider);
        }
        {
            if (action === 'respondPermission') {
                const permissionId = typeof body.permissionId === 'string' ? body.permissionId : '';
                const response = typeof body.response === 'string' ? body.response : '';
                if (!permissionId)
                    throw new Error('permissionId is required');
                if (response !== 'once' && response !== 'always' && response !== 'reject') {
                    throw new Error('response must be once, always, or reject');
                }
                respondAcpPermissionDecision(sessionId, permissionId, response);
                return { ok: true };
            }
            if (action === 'respondQuestion') {
                const permissionId = typeof body.permissionId === 'string' ? body.permissionId : '';
                const answers = parseQuestionAnswers(body.answers);
                if (!permissionId)
                    throw new Error('permissionId is required');
                if (!answers)
                    throw new Error('answers is required');
                // Elicitation content is one primitive value per schema property (the
                // AskUserQuestion picker's PendingQuestion.id === the schema property
                // name — see parseMcpElicitationQuestions). Multi-select answers join;
                // this transport doesn't support multi-value elicitation content.
                const content: Record<string, string> = {};
                for (const [key, values] of Object.entries(answers))
                    content[key] = values.join(', ');
                resolveAcpElicitation(sessionId, permissionId, { action: 'accept', content });
                return { ok: true };
            }
        }
        throw new Error(`Action ${action || '(missing)'} is not supported for ${extensionProvider} sessions`);
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
    async function prewarm(params: {
        sessionId: string;
        provider?: AgentProvider;
        cwd?: string;
        model?: string;
        effort?: ReasoningEffortLevel;
        isPending?: boolean;
    }): Promise<void> {
        const provider = extensionProvider;
        {
            await withSessionInstance(extensionProvider, params.sessionId, async () => acquireAcpSession(params.sessionId, acpAgentKindOf(extensionProvider), params.cwd ?? process.cwd(), await coordinatorAcpMcpServers(extensionProvider, params.sessionId)));
            return;
        }
    }
    /** Existing SDK dispatch, reached only through bundled extension runtime entries. */
    async function streamTurn(params: SendMessageParams, checkpoint?: Promise<TurnCheckpoint | null>): Promise<Response> {
        const provider = extensionProvider;
        // Other providers don't yet have that explicit submission boundary — keep
        // the original blocking ordering for them until they gain one.
        await checkpoint?.catch(() => null);
        {
            return withSessionInstance(extensionProvider, params.sessionId, () => createAcpStream(extensionProvider, params.sessionId, params.signal, params.body));
        }
    }
    async function forkSession({ sessionId, body, provider }: ForkParams): Promise<{
        sessionId: string;
    }> {
        const resolvedProvider = extensionProvider;
        {
            void sessionId;
            void body;
            throw new Error(`Fork is not supported for ${extensionProvider} sessions`);
        }
    }
    async function createSession({ provider: providerOverride, cwd, title, codexDynamicTools, }: {
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
        const provider = extensionProvider;
        const resolvedCwd = (cwd && cwd.trim()) ? cwd : process.cwd();
        {
            // ACP has no listing RPC, so the session is created lazily on first
            // prompt (createAcpStream's acquireAcpSession) — mirrors Claude/Pi's
            // pending-id pattern, just with no durable history behind it.
            const { randomUUID } = await import('node:crypto');
            const sessionId = randomUUID();
            // Its first turn must reach the agent it was created for.
            rememberSessionInstances(extensionProvider, [sessionId], currentProviderInstanceId(extensionProvider));
            return { sessionId, provider: extensionProvider, cwd: resolvedCwd, isPending: true };
        }
    }
    /** Release provider-side resources for an active session without deleting its durable history. */
    async function closeSession(sessionId: string, providerOverride?: AgentProvider): Promise<void> {
        const provider = extensionProvider;
        {
            await closeAcpSession(sessionId);
        }
    }
    function listPendingPermissions(sessionId: string, provider?: AgentProvider): Record<string, unknown>[] {
        {
            return acpPendingRequests(sessionId).map((pending) => {
                const data = { requestId: pending.id, sessionId, provider: extensionProvider, ...(pending.params as Record<string, unknown>) };
                return pending.method === 'elicitation/create'
                    ? { type: 'acp_elicitation', event: { type: 'elicitation.requested', data } }
                    : { type: 'acp_permission', event: { type: 'permission.requested', data } };
            });
        }
    }
    /** Process-local control-plane state for fleet and attention clients. */
    async function rewindSession({ sessionId, body, provider }: RewindParams): Promise<Record<string, unknown>> {
        const resolvedProvider = extensionProvider;
        {
            void sessionId;
            void body;
            throw new Error(`Rewind is not supported for ${extensionProvider} sessions`);
        }
    }
    return {
        createSession: createSession,
        streamTurn: streamTurn,
        prewarm: prewarm,
        runAction: runAction,
        forkSession: forkSession,
        rewindSession: rewindSession,
        closeSession: closeSession,
        listPendingPermissions: listPendingPermissions,
        getMemoryDiagnostics: readMemoryDiagnostics,
    };
}
