// Provider architecture extraction: SDK behavior preserved from the session backend.
import { parseQuestionAnswers, commandResultEvent, startTurnWatchdog, createTurnUsageReporter, parseAttachments, parseEffort, parseTurnRequestId } from '../runtimeCore'
import { steerViewSession } from '../../../sessionSteering'
import { listPendingProviderPermissionPayloads } from '../../../sessionControlPlane'
import { coordinatorPermissionToken } from "../../../coordinatorNativePermission";
import { extractPendingPermissions } from "../../../permissions";
import { dispatchCoordinatorCodexToolCall } from '../../../coordinatorProviderBindings'
import { ensureCodexThreadResumed, forgetCodexThreadResumed, markCodexThreadResumed, isCodexActiveWriterError, isCodexMissingRolloutError, readCodexThread, readCodexThreadWithFullTurns } from "../../../codexThreads";
import { withTimeout } from "../../../withTimeout";
import { providerStartupTimeoutMs } from "../../../providerWarmup";
import { PendingRequestGoneError } from "../../../pendingRequestGone";
import { clearRunningSession, interruptRunningSession, setRunningSession } from "../../../sessionRuntime";
import type { TurnCheckpoint } from "../../../checkpoints";
import { buildCodexComposerInput } from "../../../codexComposerInput";
import { currentProviderInstanceId } from "../../../providerInstances";
import type { AgentProvider, ContextUsage, ReasoningEffortLevel } from "../../../types";
import { readCodexMcpApp } from "../../../codexMcpApps";
import { getCodexClient } from "../../../codexClient";
import type { CodexNotification, CodexRequestParams, CodexResponseFor, CodexKnownServerRequest, CodexServerRequest, CodexThreadTokenUsage } from "../../../codexProtocol";
import type { DynamicToolSpec, ErrorNotification, ThreadStatusChangedNotification, ThreadTokenUsageUpdatedNotification } from "../../../codex-schema/v2";
import { advanceCodexTurnOutputUsage, mapCodexTokenUsageToContextUsage } from "../../../codexMapper";
import { subscribeToCodexEvents } from "../../../codexHarness";
export const CODEX_WATCHDOG_IDLE_MS = 30000;
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
export function codexContextUsageToEventData(contextUsage: ContextUsage): string {
    return `event: context-usage\ndata: ${JSON.stringify(contextUsage)}\n\n`;
}
export function parseOpenCodeSlashCommand(message: string): {
    command: string;
    arguments: string;
} | null {
    if (!message.startsWith('/'))
        return null;
    const trimmed = message.trim();
    const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
    if (!match)
        return null;
    return {
        command: match[1]!,
        arguments: match[2]?.trim() ?? '',
    };
}
export async function runAction({ sessionId, body, provider }: SessionActionParams): Promise<Record<string, unknown>> {
    const resolvedProvider = "codex";
    const action = typeof body.action === 'string' ? body.action : '';
    // Guard again after provider resolution/pool awaits. Remote confirmation
    // cannot fall through to a different session's similarly named request.
    if ((action === 'respondPermission' || action === 'respondQuestion') && typeof body.expectedPermissionToken === 'string') {
        const pending = extractPendingPermissions(listPendingProviderPermissionPayloads(sessionId, "codex"), { sessionId, provider: "codex" });
        if (!pending.some(permission => permission.id === body.permissionId && coordinatorPermissionToken(permission) === body.expectedPermissionToken)) {
            throw new PendingRequestGoneError(action === 'respondQuestion' ? 'Question' : 'Permission request');
        }
    }
    // Provider-agnostic: deliver a user message into the running turn (native
    // steering). `delivered: false` means no running turn / no steer primitive /
    // the turn ended while the request was in flight — callers fall back to
    // queueing the message for the next turn.
    if (action === 'steer') {
        return steerViewSession(sessionId, body, "codex");
    }
    {
        if (action === 'getMcpApp') {
            const { serverName, toolName, originCallId } = body;
            if (typeof serverName !== 'string' || typeof toolName !== 'string' || typeof originCallId !== 'string'
                || !serverName || !toolName || !originCallId)
                throw new Error('MCP server, tool, and originating call are required');
            return readCodexMcpApp(sessionId, serverName, toolName, originCallId);
        }
        if (action === 'respondPermission') {
            const permissionId = typeof body.permissionId === 'string' ? body.permissionId : '';
            const response = typeof body.response === 'string' ? body.response : '';
            if (!permissionId)
                throw new Error('permissionId is required');
            if (!response)
                throw new Error('response is required');
            respondCodexApproval(sessionId, permissionId, response);
            return { ok: true };
        }
        if (action === 'respondQuestion') {
            const permissionId = typeof body.permissionId === 'string' ? body.permissionId : '';
            const answers = parseQuestionAnswers(body.answers);
            if (!permissionId)
                throw new Error('permissionId is required');
            if (!answers)
                throw new Error('answers is required');
            respondCodexQuestion(sessionId, permissionId, answers);
            return { ok: true };
        }
    }
    throw new Error(`Action ${action || '(missing)'} is not supported for ${"codex"} sessions`);
}
export function formatCodexNotification(notification: CodexNotification): string | null {
    switch (notification.method) {
        case 'error':
            return JSON.stringify({ type: 'codex_error', ...notification.params });
        case 'item/agentMessage/delta':
            return JSON.stringify({ type: 'codex_agent_message_delta', ...notification.params });
        case 'item/plan/delta':
            return JSON.stringify({ type: 'codex_plan_delta', ...notification.params });
        case 'item/reasoning/summaryTextDelta':
            return JSON.stringify({ type: 'codex_reasoning_summary_delta', ...notification.params });
        case 'item/reasoning/textDelta':
            return JSON.stringify({ type: 'codex_reasoning_delta', ...notification.params });
        case 'item/commandExecution/outputDelta':
            return JSON.stringify({ type: 'codex_command_output_delta', ...notification.params });
        case 'item/fileChange/outputDelta':
            return JSON.stringify({ type: 'codex_file_change_output_delta', ...notification.params });
        case 'item/fileChange/patchUpdated':
            return JSON.stringify({ type: 'codex_file_change_patch_updated', ...notification.params });
        case 'item/mcpToolCall/progress':
            return JSON.stringify({ type: 'codex_mcp_tool_progress', ...notification.params });
        case 'turn/plan/updated':
            return JSON.stringify({ type: 'codex_turn_plan_updated', ...notification.params });
        case 'turn/diff/updated':
            return JSON.stringify({ type: 'codex_turn_diff_updated', ...notification.params });
        case 'thread/realtime/transcript/delta':
            return JSON.stringify({ type: 'codex_realtime_transcript_delta', ...notification.params });
        case 'thread/realtime/transcript/done':
            return JSON.stringify({ type: 'codex_realtime_transcript_done', ...notification.params });
        case 'thread/realtime/transcriptUpdated':
            return JSON.stringify({ type: 'codex_realtime_transcript', ...notification.params });
        case 'thread/realtime/itemAdded':
            return JSON.stringify({ type: 'codex_realtime_item_added', ...notification.params });
        case 'thread/realtime/error':
            return JSON.stringify({ type: 'codex_realtime_error', ...notification.params });
        case 'item/started':
            return JSON.stringify({ type: 'codex_item_started', ...notification.params });
        case 'item/completed':
            return JSON.stringify({ type: 'codex_item_completed', ...notification.params });
        default:
            return null;
    }
}
export function getCodexNotificationTurnId(notification: CodexNotification): string | null {
    // Most notifications expose turnId directly; turn/started, turn/completed
    // carry it indirectly via params.turn.id (per TurnStartedNotification /
    // TurnCompletedNotification). The shape varies across the union, so this
    // accessor stays loose-typed by design.
    const params = notification.params as {
        turnId?: unknown;
        turn?: {
            id?: unknown;
        } | null;
    };
    if (typeof params.turnId === 'string' && params.turnId)
        return params.turnId;
    if (typeof params.turn?.id === 'string' && params.turn.id)
        return params.turn.id;
    return null;
}
export function isCodexRealtimeNotification(notification: CodexNotification): boolean {
    switch (notification.method) {
        case 'error':
        case 'item/agentMessage/delta':
        case 'item/plan/delta':
        case 'item/reasoning/summaryTextDelta':
        case 'item/reasoning/textDelta':
        case 'item/commandExecution/outputDelta':
        case 'item/fileChange/outputDelta':
        case 'item/fileChange/patchUpdated':
        case 'item/mcpToolCall/progress':
        case 'turn/plan/updated':
        case 'turn/diff/updated':
        case 'thread/realtime/transcript/delta':
        case 'thread/realtime/transcript/done':
        case 'thread/realtime/transcriptUpdated':
        case 'thread/realtime/itemAdded':
        case 'thread/realtime/error':
        case 'item/started':
        case 'item/completed':
            return true;
        default:
            return false;
    }
}
export function isCodexIdleStatusNotification(notification: CodexNotification, sessionId: string): boolean {
    if (notification.method !== 'thread/status/changed')
        return false;
    const params = notification.params as ThreadStatusChangedNotification;
    return params.threadId === sessionId && params.status.type === 'idle';
}
// ── Codex server-request (approval) bridge ─────────────────────────────────
// The app-server sends exec/patch/permission approval *requests* mid-turn and
// blocks the turn until the client replies. createCodexStream surfaces them as
// `codex_approval` SSE frames; the respondPermission action replies via
// getCodexClient().respond(). Without this the turn hangs forever (the request
// was previously dropped as an unmatched response).
export type PendingCodexApproval = {
    rawId: string | number;
    method: string;
    params: Record<string, unknown>;
};
declare global {
    // eslint-disable-next-line no-var
    var __agentViewerPendingCodexApprovals: Map<string, PendingCodexApproval> | undefined;
}
export const pendingCodexApprovals = globalThis.__agentViewerPendingCodexApprovals
    ?? (globalThis.__agentViewerPendingCodexApprovals = new Map<string, PendingCodexApproval>());
export function pendingCodexApprovalKey(threadId: string, id: string): string {
    return `${threadId}:${id}`;
}
export const CODEX_APPROVAL_METHOD_NAMES = [
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
    'item/permissions/requestApproval',
    'item/tool/requestUserInput',
    'mcpServer/elicitation/request',
    'applyPatchApproval',
    'execCommandApproval',
] as const satisfies readonly CodexKnownServerRequest['method'][];
export const CODEX_APPROVAL_METHODS = new Set<string>(CODEX_APPROVAL_METHOD_NAMES);
export function isCodexApprovalRequest(method: string): boolean {
    return CODEX_APPROVAL_METHODS.has(method);
}
export function codexApprovalThreadId(params: Record<string, unknown>): string | undefined {
    return typeof params.threadId === 'string' ? params.threadId : undefined;
}
export function codexApprovalRequestedPayload(threadId: string, request: CodexServerRequest): Record<string, unknown> {
    return {
        type: 'codex_approval',
        event: {
            type: 'approval.requested',
            requestId: String(request.id),
            method: request.method,
            threadId,
            params: request.params,
        },
    };
}
export function codexApprovalRequestedEvent(threadId: string, request: CodexServerRequest): string {
    return JSON.stringify(codexApprovalRequestedPayload(threadId, request));
}
export function grantedCodexPermissionsFromRequest(params: Record<string, unknown>, response: string): Record<string, unknown> {
    if (response === 'reject' || response === 'decline' || response === 'cancel')
        return {};
    const request = params.permissions && typeof params.permissions === 'object' && !Array.isArray(params.permissions)
        ? params.permissions as Record<string, unknown>
        : {};
    const granted: Record<string, unknown> = {};
    if (request.network && typeof request.network === 'object')
        granted.network = request.network;
    if (request.fileSystem && typeof request.fileSystem === 'object')
        granted.fileSystem = request.fileSystem;
    return granted;
}
// Map a user decision to the per-method app-server response payload. Accepts the
// generic once/always/reject vocabulary shared by every provider's permission
// card, plus codex-native decision strings (accept/acceptForSession/decline/
// cancel) for finer control. Permission-profile requests follow codex-rs'
// composer flow: once grants for the turn, always grants for the session, and
// reject continues with an empty granted-permissions object.
export function codexApprovalResult(method: string, response: string, params: Record<string, unknown>): Record<string, unknown> | undefined {
    const decision = response === 'accept' || response === 'acceptForSession' || response === 'decline' || response === 'cancel'
        ? response
        : response === 'always'
            ? 'acceptForSession'
            : response === 'reject'
                ? 'decline'
                : 'accept';
    switch (method) {
        case 'item/commandExecution/requestApproval':
        case 'item/fileChange/requestApproval':
            return { decision };
        case 'applyPatchApproval':
        case 'execCommandApproval':
            return {
                decision: response === 'always' || response === 'acceptForSession'
                    ? 'approved_for_session'
                    : response === 'reject' || response === 'decline' || response === 'cancel'
                        ? { denied: { rejection: 'Denied by user' } }
                        : 'approved',
            };
        case 'item/permissions/requestApproval':
            return {
                permissions: grantedCodexPermissionsFromRequest(params, response),
                scope: response === 'always' || response === 'acceptForSession' ? 'session' : 'turn',
                strictAutoReview: response === 'strict',
            };
        case 'mcpServer/elicitation/request':
            return {
                action: response === 'reject' || response === 'decline' || response === 'cancel' ? 'decline' : 'accept',
                content: null,
                _meta: params._meta ?? null,
            };
        default:
            return undefined;
    }
}
export function respondCodexApproval(threadId: string, permissionId: string, response: string): void {
    const key = pendingCodexApprovalKey(threadId, permissionId);
    const pending = pendingCodexApprovals.get(key);
    if (!pending)
        throw new PendingRequestGoneError('Approval request');
    pendingCodexApprovals.delete(key);
    const client = getCodexClient();
    const result = codexApprovalResult(pending.method, response, pending.params);
    if (result === undefined) {
        client.respondError(pending.rawId, -32601, 'Approval type not supported by this client');
        return;
    }
    client.respond(pending.rawId, result);
}
export function elicitationContentFromAnswers(params: Record<string, unknown>, answers: Record<string, string[]>): Record<string, string | number | boolean | string[]> {
    const schema = params.requestedSchema && typeof params.requestedSchema === 'object' && !Array.isArray(params.requestedSchema)
        ? params.requestedSchema as Record<string, unknown>
        : {};
    const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
        ? schema.properties as Record<string, unknown>
        : {};
    const content: Record<string, string | number | boolean | string[]> = {};
    for (const [key, values] of Object.entries(answers)) {
        const first = values[0];
        if (first == null)
            continue;
        const property = properties[key] && typeof properties[key] === 'object' && !Array.isArray(properties[key])
            ? properties[key] as Record<string, unknown>
            : {};
        switch (property.type) {
            case 'array':
                content[key] = values;
                break;
            case 'boolean':
                content[key] = first === 'true';
                break;
            case 'number':
            case 'integer': {
                const value = Number(first);
                if (Number.isFinite(value))
                    content[key] = property.type === 'integer' ? Math.trunc(value) : value;
                break;
            }
            default:
                content[key] = first;
                break;
        }
    }
    return content;
}
export function respondCodexQuestion(threadId: string, permissionId: string, answers: Record<string, string[]>): void {
    const key = pendingCodexApprovalKey(threadId, permissionId);
    const pending = pendingCodexApprovals.get(key);
    if (!pending || (pending.method !== 'item/tool/requestUserInput' && pending.method !== 'mcpServer/elicitation/request')) {
        throw new PendingRequestGoneError('Question');
    }
    if (pending.method === 'mcpServer/elicitation/request') {
        pendingCodexApprovals.delete(key);
        getCodexClient().respond(pending.rawId, {
            action: 'accept',
            content: elicitationContentFromAnswers(pending.params, answers),
            _meta: pending.params._meta ?? null,
        });
        return;
    }
    const rawQuestions = Array.isArray(pending.params.questions) ? pending.params.questions : [];
    const responseAnswers: Record<string, {
        answers: string[];
    }> = {};
    for (const rawQuestion of rawQuestions) {
        if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion))
            continue;
        const question = rawQuestion as Record<string, unknown>;
        const id = typeof question.id === 'string' ? question.id : '';
        const prompt = typeof question.question === 'string' ? question.question : '';
        const answer = (id && answers[id]) || (prompt && answers[prompt]);
        if (!id || !Array.isArray(answer))
            continue;
        responseAnswers[id] = { answers: answer.map((value) => value.trim()).filter(Boolean) };
    }
    pendingCodexApprovals.delete(key);
    getCodexClient().respond(pending.rawId, { answers: responseAnswers });
}
// Decline any unanswered approvals for a thread when its turn ends/errors so the
// app-server is never left blocked. Safe on a clean completion (no pending) and
// idempotent if the server already cancelled the request.
export function declinePendingCodexApprovals(threadId: string): void {
    const client = getCodexClient();
    for (const [key, pending] of Array.from(pendingCodexApprovals)) {
        if (!key.startsWith(`${threadId}:`))
            continue;
        pendingCodexApprovals.delete(key);
        const result = codexApprovalResult(pending.method, 'reject', pending.params);
        if (result === undefined)
            client.respondError(pending.rawId, -32601, 'Approval cancelled');
        else
            client.respond(pending.rawId, result);
    }
}
// AskForApproval string variants accepted from the composer's APPROVALS picker.
// (The `granular` object variant isn't exposed in the UI.) Omitted → use the
// app-server's configured default.
export const CODEX_APPROVAL_POLICIES = ['untrusted', 'on-request', 'never'] as const;
export type CodexApprovalPolicy = typeof CODEX_APPROVAL_POLICIES[number];
export function parseCodexApprovalPolicy(body: Record<string, unknown>): CodexApprovalPolicy | undefined {
    const value = typeof body.approvalPolicy === 'string' ? body.approvalPolicy : '';
    return (CODEX_APPROVAL_POLICIES as readonly string[]).includes(value) ? (value as CodexApprovalPolicy) : undefined;
}
export const CODEX_INIT_PROMPT = `Generate a file named AGENTS.md that serves as a contributor guide for this repository.
Keep it concise (200-400 words), well organised under clear headings, and specific to this project:
project structure and module organisation; build, test and development commands; coding style and
naming conventions; testing guidelines; commit and pull request guidelines. If an AGENTS.md already
exists, improve it rather than replacing what is still accurate.`;
export async function createCodexStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>, checkpoint?: Promise<unknown>): Promise<Response> {
    const userMessage = String(body.message ?? '').trim();
    const turnRequestId = parseTurnRequestId(body);
    const model = typeof body.model === 'string' ? body.model : null;
    const effort = parseEffort(body);
    // Codex's app-server accepts `low`/`medium`/`high` for `effort`
    // (mirrors the CLI's `/reasoning` setting). `off`/`minimal`/`xhigh`/`max`
    // are not valid there, so drop them and let Codex use its thread default.
    const codexEffort = effort === 'low' || effort === 'medium' || effort === 'high'
        ? effort
        : undefined;
    const attachments = parseAttachments(body);
    const cwdOverride = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined;
    const approvalPolicy = parseCodexApprovalPolicy(body);
    // Codex's collaboration mode (the CLI's ⇧Tab Plan/Default). Sticky on the
    // thread once sent, so the composer sends it whenever the user has chosen one.
    const collaborationMode = body.collaborationMode === 'plan' || body.collaborationMode === 'default'
        ? body.collaborationMode
        : undefined;
    const bangShell = userMessage.startsWith('!') && attachments.length === 0
        ? userMessage.slice(1).trim()
        : null;
    const codexSlash = attachments.length === 0 ? parseOpenCodeSlashCommand(userMessage) : null;
    const detachOnClientAbort = body.detachOnClientAbort === true;
    const client = getCodexClient();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            let targetTurnId: string | null = null;
            const bufferedNotifications: CodexNotification[] = [];
            let currentModel = model ?? 'codex';
            let cleanedUp = false;
            let downstreamClosed = false;
            let completionSeen = false;
            let bufferedTurnCompleted = false;
            let targetTurnObserved = false;
            let directOperationStarted = false;
            let completionCloseTimer: ReturnType<typeof setTimeout> | null = null;
            let lastActivityAt = Date.now();
            let cancelWatchdog: (() => void) | null = null;
            const safeEnqueue = (chunk: string) => {
                if (cleanedUp || downstreamClosed)
                    return;
                lastActivityAt = Date.now();
                try {
                    controller.enqueue(encoder.encode(chunk));
                }
                catch {
                    downstreamClosed = true;
                }
            };
            const safeClose = () => {
                if (downstreamClosed)
                    return;
                downstreamClosed = true;
                try {
                    controller.close();
                }
                catch {
                    /* stream already closed by consumer/runtime */
                }
            };
            const closeStream = (unsubscribe: () => void) => {
                if (cleanedUp)
                    return;
                cleanedUp = true;
                if (completionCloseTimer) {
                    clearTimeout(completionCloseTimer);
                    completionCloseTimer = null;
                }
                cancelWatchdog?.();
                cancelWatchdog = null;
                clearRunningSession(sessionId, turnRequestId);
                flushPendingDelta();
                unsubscribe();
                safeClose();
            };
            const scheduleCompletionClose = (unsubscribe: () => void) => {
                if (cleanedUp)
                    return;
                completionSeen = true;
                if (completionCloseTimer)
                    clearTimeout(completionCloseTimer);
                completionCloseTimer = setTimeout(() => closeStream(unsubscribe), 400);
            };
            const flushNotification = (notification: CodexNotification) => {
                const payload = formatCodexNotification(notification);
                if (!payload)
                    return;
                safeEnqueue(`data: ${payload}\n\n`);
            };
            // Codex emits one delta notification per streamed chunk of assistant/
            // reasoning text. Forwarding each as its own SSE frame makes the live
            // view re-render on every chunk; coalesce same-item deltas into one
            // frame instead, spilling early if a single item's buffered text grows
            // past DELTA_SPILL_CHARS so a very long uninterrupted stream still
            // flushes periodically. Any non-delta notification (tool call, item
            // completion, approval, etc.) is an interaction boundary and flushes
            // the pending delta first so ordering in the transcript stays intact.
            const DELTA_SPILL_CHARS = 4000;
            // The periodic flush the text above promises. Without it, a turn that is
            // nothing but prose showed no text at all until the item completed —
            // measured: 18s of Codex streaming a 300-line answer, then all at once.
            const DELTA_FLUSH_MS = 40;
            const DELTA_METHODS = new Set([
                'item/agentMessage/delta',
                'item/reasoning/textDelta',
                'item/reasoning/summaryTextDelta',
            ]);
            let pendingDelta: CodexNotification | null = null;
            let deltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
            const flushPendingDelta = () => {
                if (deltaFlushTimer) {
                    clearTimeout(deltaFlushTimer);
                    deltaFlushTimer = null;
                }
                if (!pendingDelta)
                    return;
                const notification = pendingDelta;
                pendingDelta = null;
                flushNotification(notification);
            };
            const scheduleDeltaFlush = () => {
                if (!deltaFlushTimer)
                    deltaFlushTimer = setTimeout(flushPendingDelta, DELTA_FLUSH_MS);
            };
            const emitNotification = (notification: CodexNotification) => {
                if (!DELTA_METHODS.has(notification.method)) {
                    flushPendingDelta();
                    flushNotification(notification);
                    return;
                }
                const params = notification.params as {
                    itemId?: string;
                    delta?: string;
                };
                const pendingParams = pendingDelta?.params as {
                    itemId?: string;
                    delta?: string;
                } | undefined;
                if (typeof params.delta !== 'string' || typeof params.itemId !== 'string') {
                    flushPendingDelta();
                    flushNotification(notification);
                    return;
                }
                if (!pendingDelta || pendingDelta.method !== notification.method || pendingParams?.itemId !== params.itemId) {
                    flushPendingDelta();
                    pendingDelta = notification;
                    scheduleDeltaFlush();
                    return;
                }
                const mergedDelta = `${pendingParams?.delta ?? ''}${params.delta}`;
                const merged = { ...notification, params: { ...params, delta: mergedDelta } } as CodexNotification;
                if (mergedDelta.length >= DELTA_SPILL_CHARS) {
                    pendingDelta = merged;
                    flushPendingDelta();
                    return;
                }
                pendingDelta = merged;
                scheduleDeltaFlush();
            };
            // Prime the SSE stream before Codex startup/resume work so the TUI can
            // render "turn running" immediately and intermediaries do not buffer the
            // first real event behind the turn/start response.
            safeEnqueue(':ok\n\n');
            // Subscribe via the codex harness — events for this thread arrive
            // pre-filtered and the snapshot cache lets a downstream client
            // resume without losing the latest turn state. Matches how the
            // opencode stream consumes its harness.
            const subscription = subscribeToCodexEvents({ threadId: sessionId });
            const cachedSnapshot = subscription.snapshot;
            let turnOutputUsage = {
                lastTotalOutputTokens: cachedSnapshot?.tokenUsage?.total?.outputTokens ?? null,
                outputTokens: 0,
            };
            let consumeAborted = false;
            // Surface this thread's server→client approval requests as codex_approval
            // SSE frames. The app-server blocks the turn until respondPermission replies.
            const unsubscribeApprovals = client.subscribeServerRequests((request) => {
                if (consumeAborted)
                    return false;
                if (!isCodexApprovalRequest(request.method))
                    return false;
                const params = request.params as Record<string, unknown>;
                const approvalThreadId = codexApprovalThreadId(params);
                // A sub-agent this turn spawned asks under its own thread; the user
                // watching this chat is the only one who can answer it.
                if (approvalThreadId && !client.threadDescendsFrom(approvalThreadId, sessionId))
                    return false;
                pendingCodexApprovals.set(pendingCodexApprovalKey(sessionId, String(request.id)), {
                    rawId: request.id,
                    method: request.method,
                    params,
                });
                safeEnqueue(`data: ${codexApprovalRequestedEvent(sessionId, request)}\n\n`);
                return true;
            });
            // Coordinator agents get their coord_* tools declared as Codex
            // dynamicTools at thread/start (see createNewViewSession's codex
            // branch) — the model calling one arrives here as a server→client
            // item/tool/call request that blocks the turn until we respond.
            const coordinatorInstanceId = currentProviderInstanceId('codex');
            const unsubscribeCoordinatorTools = client.subscribeServerRequests((request) => {
                if (consumeAborted)
                    return false;
                if (request.method !== 'item/tool/call')
                    return false;
                const params = request.params as {
                    threadId?: string;
                    tool?: string;
                    arguments?: unknown;
                };
                if (params.threadId && params.threadId !== sessionId)
                    return false;
                void (async () => {
                    const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
                        ? params.arguments as Record<string, unknown>
                        : {};
                    const result = await dispatchCoordinatorCodexToolCall(sessionId, String(params.tool ?? ''), args, coordinatorInstanceId);
                    if (!result) {
                        client.respondError(request.id, -32601, `Unknown dynamic tool: ${params.tool}`);
                        return;
                    }
                    client.respond(request.id, {
                        contentItems: [{ type: 'inputText', text: result.text }],
                        success: !result.isError,
                    });
                })();
                return true;
            });
            const unsubscribe = () => {
                consumeAborted = true;
                unsubscribeApprovals();
                unsubscribeCoordinatorTools();
                declinePendingCodexApprovals(sessionId);
                subscription.close();
            };
            const reportTurnUsage = createTurnUsageReporter(safeEnqueue);
            const emitTokenUsage = (tokenUsage: CodexThreadTokenUsage) => {
                const usage = mapCodexTokenUsageToContextUsage(tokenUsage, currentModel);
                safeEnqueue(codexContextUsageToEventData(usage));
                turnOutputUsage = advanceCodexTurnOutputUsage(turnOutputUsage, tokenUsage);
                reportTurnUsage(turnOutputUsage.outputTokens);
            };
            const activateTargetTurn = (turnId: string) => {
                if (!turnId || targetTurnId)
                    return;
                targetTurnId = turnId;
                setRunningSession(sessionId, {
                    provider: 'codex',
                    requestId: turnRequestId,
                    interrupt: () => client.request('turn/interrupt', { threadId: sessionId, turnId }),
                    // Native mid-turn steering (the Codex CLI's type-while-running flow).
                    // expectedTurnId makes this fail cleanly if the turn just ended —
                    // the caller then falls back to queueing for the next turn.
                    steer: (text) => client.request('turn/steer', {
                        threadId: sessionId,
                        expectedTurnId: turnId,
                        input: buildCodexComposerInput(text, []),
                    }),
                });
                safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId, provider: 'codex', turnId })}\n\n`);
                // Backstop a dropped turn/completed: if the notification stream goes
                // silent, ask the app-server for the turn's actual status. A legit
                // long-running tool call reports `inProgress` and the watchdog keeps
                // waiting; only a confirmed-finished (or vanished) turn closes the
                // stream, so the composer can never wedge in 'sending' on a lost frame.
                cancelWatchdog = startTurnWatchdog({
                    label: 'codex',
                    idleTimeoutMs: CODEX_WATCHDOG_IDLE_MS,
                    // A detached HTTP client does not end the provider turn. Keep the
                    // authoritative status probe alive so a dropped terminal event still
                    // clears the process-local running registry for reattach clients.
                    isClosed: () => cleanedUp || (downstreamClosed && !detachOnClientAbort),
                    lastActivityAt: () => lastActivityAt,
                    probe: async () => {
                        try {
                            const response = await client.request('thread/turns/list', { threadId: sessionId, limit: 5 });
                            const turn = response.data.find((candidate) => candidate.id === turnId);
                            if (!turn)
                                return 'unknown';
                            return turn.status === 'inProgress' ? 'running' : 'idle';
                        }
                        catch {
                            return 'unknown';
                        }
                    },
                    onResolved: () => scheduleCompletionClose(unsubscribe),
                });
                for (const notification of bufferedNotifications.splice(0)) {
                    const bufferedTurnId = getCodexNotificationTurnId(notification);
                    if (bufferedTurnId && bufferedTurnId !== turnId)
                        continue;
                    if (bufferedTurnId === turnId)
                        targetTurnObserved = true;
                    if (notification.method === 'turn/completed') {
                        bufferedTurnCompleted = true;
                        continue;
                    }
                    if (notification.method === 'thread/tokenUsage/updated') {
                        emitTokenUsage((notification.params as ThreadTokenUsageUpdatedNotification).tokenUsage);
                        continue;
                    }
                    if (notification.method === 'error') {
                        const params = notification.params as ErrorNotification;
                        const message = params.error?.message || 'Codex turn failed';
                        safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
                        if (!params.willRetry) {
                            scheduleCompletionClose(unsubscribe);
                        }
                        continue;
                    }
                    if (isCodexIdleStatusNotification(notification, sessionId)) {
                        scheduleCompletionClose(unsubscribe);
                        continue;
                    }
                    if (completionSeen)
                        scheduleCompletionClose(unsubscribe);
                    flushNotification(notification);
                }
                if (bufferedTurnCompleted) {
                    scheduleCompletionClose(unsubscribe);
                }
            };
            const consume = (async () => {
                for await (const harnessEvent of subscription.events) {
                    if (consumeAborted)
                        break;
                    if (harnessEvent.type === 'disconnected') {
                        // The app-server died mid-turn. Surface it as a terminal error (so
                        // the composer leaves its sending state) and close, rather than
                        // blocking forever on a pipe that will never produce again.
                        if (!completionSeen) {
                            safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: 'Codex app-server disconnected' })}\n\n`);
                        }
                        scheduleCompletionClose(unsubscribe);
                        break;
                    }
                    if (harnessEvent.type !== 'notification')
                        continue;
                    const notification = harnessEvent.notification;
                    const notificationTurnId = getCodexNotificationTurnId(notification);
                    if (!targetTurnId && directOperationStarted) {
                        if (notification.method === 'error') {
                            const params = notification.params as ErrorNotification;
                            const message = params.error?.message || 'Codex operation failed';
                            safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
                            if (!params.willRetry) {
                                scheduleCompletionClose(unsubscribe);
                            }
                            continue;
                        }
                        if (isCodexIdleStatusNotification(notification, sessionId)) {
                            scheduleCompletionClose(unsubscribe);
                            continue;
                        }
                        if (isCodexRealtimeNotification(notification)) {
                            emitNotification(notification);
                            if (notification.method === 'item/completed') {
                                scheduleCompletionClose(unsubscribe);
                            }
                        }
                        continue;
                    }
                    if (notification.method === 'thread/tokenUsage/updated') {
                        if (!targetTurnId) {
                            bufferedNotifications.push(notification);
                            continue;
                        }
                        if (!targetTurnId || notificationTurnId !== targetTurnId)
                            continue;
                        emitTokenUsage((notification.params as ThreadTokenUsageUpdatedNotification).tokenUsage);
                        continue;
                    }
                    if (!targetTurnId) {
                        // `turn/start` is the authoritative source of the new turn id.
                        // The shared app-server can still deliver trailing notifications
                        // from the previous turn while this request is in flight; binding
                        // to one of those would filter out every delta from the real turn.
                        if (notificationTurnId) {
                            bufferedNotifications.push(notification);
                        }
                        continue;
                    }
                    if (notificationTurnId) {
                        if (notificationTurnId !== targetTurnId)
                            continue;
                        targetTurnObserved = true;
                    }
                    if (isCodexIdleStatusNotification(notification, sessionId)) {
                        if (targetTurnObserved)
                            scheduleCompletionClose(unsubscribe);
                        continue;
                    }
                    if (notification.method === 'turn/completed') {
                        scheduleCompletionClose(unsubscribe);
                        continue;
                    }
                    // The codex app-server reports mid-turn failures as `error`
                    // notifications. The legacy path stringified them as a generic
                    // codex_error data frame which the client never narrowed to an
                    // error. Promote them to the canonical `event: error` SSE frame
                    // so MessageView surfaces them the same way every other provider
                    // does.
                    if (notification.method === 'error') {
                        const params = notification.params as ErrorNotification;
                        const message = params.error?.message || 'Codex turn failed';
                        safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
                        if (!params.willRetry) {
                            scheduleCompletionClose(unsubscribe);
                        }
                        continue;
                    }
                    if (completionSeen)
                        scheduleCompletionClose(unsubscribe);
                    emitNotification(notification);
                }
            })();
            void consume.catch(() => { });
            // Replay snapshot state so the live indicator and token usage
            // reflect what the harness already knows about this thread.
            if (cachedSnapshot?.tokenUsage) {
                const usage = mapCodexTokenUsageToContextUsage(cachedSnapshot.tokenUsage, currentModel);
                safeEnqueue(codexContextUsageToEventData(usage));
            }
            signal.addEventListener('abort', () => {
                if (detachOnClientAbort) {
                    downstreamClosed = true;
                    return;
                }
                void interruptRunningSession(sessionId, turnRequestId).catch(() => { });
            });
            try {
                // Resume is cached per app-server process — consecutive turns in the
                // same thread skip the round-trip entirely (it sat serially ahead of
                // turn/start, adding to first-token latency on every send).
                let resume: {
                    model: string | null;
                };
                try {
                    resume = await ensureCodexThreadResumed(sessionId);
                }
                catch (err) {
                    if (!isCodexActiveWriterError(err))
                        throw err;
                    if (bangShell !== null || codexSlash) {
                        throw new Error('This Codex session is open in another Codex client. Send a normal prompt to queue it, or run this command in the client that owns the session.');
                    }
                    // A different Codex process owns the rollout writer, so this
                    // app-server cannot resume the thread or call turn/start. The
                    // persistent thread queue is specifically addressable while the
                    // thread is not loaded here; the owning client can consume the
                    // submission without Agent Viewer manufacturing a duplicate turn.
                    await checkpoint?.catch(() => null);
                    const queued = await client.request('thread/queue/add', {
                        threadId: sessionId,
                        input: buildCodexComposerInput(userMessage, attachments, cwdOverride),
                        clientUserMessageId: turnRequestId,
                    });
                    safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`);
                    safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({
                        sessionId,
                        provider: 'codex',
                        queuedSubmissionId: queued.queuedSubmission.id,
                        queued: true,
                    })}\n\n`);
                    safeEnqueue(commandResultEvent('codex', {
                        message: 'Queued for the Codex client that currently owns this session.',
                        // The owning CLI persists this queued prompt. Keep the clients'
                        // optimistic user row mounted until that durable row reconciles.
                        transcriptExpected: true,
                    }));
                    scheduleCompletionClose(unsubscribe);
                    return;
                }
                currentModel = model ?? resume?.model ?? currentModel;
                safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`);
                await checkpoint?.catch(() => null);
                if (bangShell !== null) {
                    if (!bangShell)
                        throw new Error('Enter a shell command after !');
                    directOperationStarted = true;
                    await client.request('thread/shellCommand', {
                        threadId: sessionId,
                        command: bangShell,
                    });
                    return;
                }
                // Execute native Codex slash commands instead of leaking the literal
                // "/command" into the model prompt. Commands that start a turn bind to
                // that turn; metadata/settings commands emit a command-result and close.
                if (codexSlash?.command.toLowerCase() === 'compact') {
                    directOperationStarted = true;
                    await client.request('thread/compact/start', { threadId: sessionId });
                    safeEnqueue(commandResultEvent('codex', { message: 'Compacting the conversation…' }));
                    return;
                }
                // Codex's /init is a built-in prompt, not a control op: it runs as an
                // ordinary turn that writes AGENTS.md.
                const codexInitPrompt = codexSlash?.command.toLowerCase() === 'init'
                    ? CODEX_INIT_PROMPT
                    : null;
                if (codexSlash && !codexInitPrompt) {
                    const commandName = codexSlash.command.toLowerCase();
                    const commandArgs = codexSlash.arguments.trim();
                    const finishCommand = (message: string, extra: Record<string, unknown> = {}) => {
                        safeEnqueue(commandResultEvent('codex', { message, transcriptExpected: false, ...extra }));
                        scheduleCompletionClose(unsubscribe);
                    };
                    if (commandName === 'model') {
                        if (!commandArgs) {
                            finishCommand(currentModel ? `Codex model is ${currentModel}.` : 'No Codex model is selected.');
                            return;
                        }
                        const [nextModel, maybeEffort] = commandArgs.split(/\s+/, 2);
                        const nextEffort = maybeEffort === 'low' || maybeEffort === 'medium' || maybeEffort === 'high'
                            ? maybeEffort
                            : undefined;
                        await client.request('thread/settings/update', {
                            threadId: sessionId,
                            model: nextModel,
                            ...(nextEffort ? { effort: nextEffort } : {}),
                        });
                        currentModel = nextModel ?? currentModel;
                        if (nextModel)
                            markCodexThreadResumed(sessionId, nextModel);
                        finishCommand(nextEffort
                            ? `Codex model set to ${nextModel} (${nextEffort}).`
                            : `Codex model set to ${nextModel}.`);
                        return;
                    }
                    if (commandName === 'permissions' || commandName === 'approvals') {
                        const nextPolicy = (CODEX_APPROVAL_POLICIES as readonly string[]).includes(commandArgs)
                            ? commandArgs as CodexApprovalPolicy
                            : undefined;
                        if (!nextPolicy) {
                            finishCommand('Use /permissions untrusted, /permissions on-request, or /permissions never.');
                            return;
                        }
                        await client.request('thread/settings/update', {
                            threadId: sessionId,
                            approvalPolicy: nextPolicy,
                        });
                        finishCommand(`Codex approval policy set to ${nextPolicy}.`);
                        return;
                    }
                    if (commandName === 'rename') {
                        if (!commandArgs) {
                            finishCommand('Use /rename <title> to rename this Codex thread.');
                            return;
                        }
                        await client.request('thread/name/set', { threadId: sessionId, name: commandArgs });
                        finishCommand(`Renamed Codex thread to "${commandArgs}".`);
                        return;
                    }
                    if (commandName === 'goal') {
                        if (!commandArgs) {
                            finishCommand('Use /goal <objective> to set a goal, or /goal clear to clear it.');
                            return;
                        }
                        if (commandArgs.toLowerCase() === 'clear') {
                            await client.request('thread/goal/clear', { threadId: sessionId });
                            finishCommand('Cleared the Codex goal.');
                            return;
                        }
                        await client.request('thread/goal/set', { threadId: sessionId, objective: commandArgs });
                        finishCommand('Updated the Codex goal.');
                        return;
                    }
                    if (commandName === 'review') {
                        const target = commandArgs
                            ? { type: 'custom' as const, instructions: commandArgs }
                            : { type: 'uncommittedChanges' as const };
                        const review = await client.request('review/start', {
                            threadId: sessionId,
                            target,
                            delivery: 'inline',
                        });
                        activateTargetTurn(review.turn.id);
                        return;
                    }
                    if (commandName === 'status') {
                        // Codex's /status: what this thread runs with. The TUI shows the
                        // same facts in its footer, but the command must still answer
                        // rather than claim it cannot run.
                        finishCommand([
                            `Model: ${currentModel}${codexEffort ? ` (${codexEffort})` : ''}`,
                            `Approvals: ${approvalPolicy ?? 'config default'}`,
                            `Directory: ${cwdOverride ?? process.cwd()}`,
                            `Thread: ${sessionId}`,
                        ].join(' · '));
                        return;
                    }
                    const commandCwd = cwdOverride ?? process.cwd();
                    if (commandName === 'skills') {
                        const listed = await client.request('skills/list', { cwds: [commandCwd] });
                        const skills = listed.data.flatMap((entry) => entry.skills);
                        finishCommand(skills.length === 0
                            ? 'No Codex skills are available in this directory.'
                            : ['Skills:', ...skills.map((skill) => `  ${skill.enabled ? '●' : '○'} ${skill.name} — ${skill.shortDescription || skill.description}`)].join('\n'));
                        return;
                    }
                    if (commandName === 'hooks') {
                        const listed = await client.request('hooks/list', { cwds: [commandCwd] });
                        const hooks = listed.data.flatMap((entry) => entry.hooks);
                        const problems = listed.data.flatMap((entry) => [...entry.warnings, ...entry.errors.map((error) => JSON.stringify(error))]);
                        finishCommand(hooks.length === 0 && problems.length === 0
                            ? 'No Codex hooks are configured.'
                            : [
                                'Hooks:',
                                ...hooks.map((hook) => {
                                    const handler = hook.handlerType === 'command' ? hook.command
                                        : hook.handlerType === 'mcpTool' ? `${hook.server}/${hook.tool}`
                                            : hook.handlerType;
                                    return `  ${hook.enabled ? '●' : '○'} ${hook.eventName}${hook.matcher ? ` (${hook.matcher})` : ''} → ${handler}`;
                                }),
                                ...problems.map((problem) => `  ! ${problem}`),
                            ].join('\n'));
                        return;
                    }
                    if (commandName === 'experimental' || commandName === 'rollout') {
                        // /experimental <name> on|off toggles a feature for this app-server;
                        // /rollout shows every gate and its stage.
                        const [featureName, toggle] = commandArgs.split(/\s+/);
                        if (commandName === 'experimental' && featureName && (toggle === 'on' || toggle === 'off')) {
                            await client.request('experimentalFeature/enablement/set', { enablement: { [featureName]: toggle === 'on' } });
                            finishCommand(`Experimental feature ${featureName} is now ${toggle}.`);
                            return;
                        }
                        const listed = await client.request('experimentalFeature/list', { threadId: sessionId, limit: 200 });
                        const features = commandName === 'experimental'
                            ? listed.data.filter((feature) => feature.stage === 'beta')
                            : listed.data.filter((feature) => feature.stage !== 'removed');
                        finishCommand(features.length === 0
                            ? 'No experimental features are available.'
                            : [
                                commandName === 'experimental' ? 'Experimental features (/experimental <name> on|off):' : 'Feature gates:',
                                ...features.map((feature) => `  ${feature.enabled ? '●' : '○'} ${feature.name}${commandName === 'rollout' ? ` [${feature.stage}]` : ''}${feature.description ? ` — ${feature.description}` : ''}`),
                            ].join('\n'));
                        return;
                    }
                    if (commandName === 'apps') {
                        const listed = await client.request('app/list', { threadId: sessionId, limit: 200 });
                        finishCommand(listed.data.length === 0
                            ? 'No apps are available.'
                            : ['Apps:', ...listed.data.map((app) => `  ${app.isEnabled && app.isAccessible ? '●' : '○'} ${app.name}${app.description ? ` — ${app.description}` : ''}`)].join('\n'));
                        return;
                    }
                    if (commandName === 'plugins') {
                        const listed = await client.request('plugin/list', { cwds: [commandCwd] });
                        const plugins = listed.marketplaces.flatMap((marketplace) => marketplace.plugins.map((plugin) => ({ plugin, marketplace: marketplace.name })));
                        const installed = plugins.filter(({ plugin }) => plugin.installedAt != null);
                        finishCommand(plugins.length === 0
                            ? 'No plugins are available.'
                            : [
                                `Plugins: ${installed.length} installed of ${plugins.length} available`,
                                ...installed.map(({ plugin, marketplace }) => `  ${plugin.enabled ? '●' : '○'} ${plugin.name} (${marketplace})`),
                            ].join('\n'));
                        return;
                    }
                    if (commandName === 'memories') {
                        if (commandArgs === 'on' || commandArgs === 'off') {
                            await client.request('thread/memoryMode/set', { threadId: sessionId, mode: commandArgs === 'on' ? 'enabled' : 'disabled' });
                            finishCommand(`Memories ${commandArgs === 'on' ? 'enabled' : 'disabled'} for this thread.`);
                            return;
                        }
                        finishCommand('Use /memories on or /memories off to set whether this thread uses and records memories.');
                        return;
                    }
                    if (commandName === 'personality') {
                        if (commandArgs === 'none' || commandArgs === 'friendly' || commandArgs === 'pragmatic') {
                            await client.request('thread/settings/update', { threadId: sessionId, personality: commandArgs });
                            finishCommand(`Codex personality set to ${commandArgs}.`);
                            return;
                        }
                        finishCommand('Use /personality none, /personality friendly, or /personality pragmatic.');
                        return;
                    }
                    if (commandName === 'feedback') {
                        // Sends to OpenAI, so only with the user's own words and no logs.
                        if (!commandArgs) {
                            finishCommand('Use /feedback <what happened> to send feedback about this thread to the Codex team (logs are not attached).');
                            return;
                        }
                        await client.request('feedback/upload', { classification: 'other', reason: commandArgs, threadId: sessionId, includeLogs: false });
                        finishCommand('Sent your feedback to the Codex team.');
                        return;
                    }
                    if (commandName === 'logout') {
                        await client.request('account/logout', undefined as never);
                        finishCommand('Logged out of Codex. Run `codex login` to sign in again.');
                        return;
                    }
                    if (commandName === 'subagents' || commandName === 'agent') {
                        // codex-cli 0.158's multi_agent records each spawn as
                        // subAgentActivity items on the parent (those children are not in
                        // thread/list); older thread_spawn children are listed with a
                        // parentThreadId.
                        type SubAgent = {
                            id: string;
                            label: string;
                            status: string;
                        };
                        const byId = new Map<string, SubAgent>();
                        const parentThread = await readCodexThreadWithFullTurns(sessionId).catch(() => null);
                        for (const turn of parentThread?.turns ?? []) {
                            for (const item of turn.items) {
                                if (item.type !== 'subAgentActivity')
                                    continue;
                                const activity = item as {
                                    agentThreadId?: string;
                                    agentPath?: string | null;
                                    kind?: string;
                                };
                                if (!activity.agentThreadId)
                                    continue;
                                const label = activity.agentPath?.split('/').filter(Boolean).pop() ?? activity.agentThreadId;
                                byId.set(activity.agentThreadId, { id: activity.agentThreadId, label, status: activity.kind ?? 'started' });
                            }
                        }
                        const listed = await client.request('thread/list', { sourceKinds: ['subAgentThreadSpawn'], limit: 200 }).catch(() => null);
                        for (const thread of listed?.data ?? []) {
                            if (thread.parentThreadId !== sessionId || byId.has(thread.id))
                                continue;
                            byId.set(thread.id, { id: thread.id, label: thread.agentNickname || thread.name || thread.id, status: thread.status.type });
                        }
                        const children = [...byId.values()];
                        if (commandName === 'agent' && commandArgs) {
                            const needle = commandArgs.toLowerCase();
                            const match = children.find((child) => child.id.startsWith(commandArgs) || child.label.toLowerCase().includes(needle));
                            if (!match) {
                                finishCommand(`No sub-agent of this thread matches "${commandArgs}".`);
                                return;
                            }
                            finishCommand(`Opening sub-agent ${match.label}.`, { openSession: { sessionId: match.id, provider: 'codex', title: match.label } });
                            return;
                        }
                        finishCommand(children.length === 0
                            ? 'This thread has not spawned any sub-agents.'
                            : ['Sub-agents (/agent <name> opens one):', ...children.map((child) => `  ${child.label} [${child.status}] — ${child.id}`)].join('\n'));
                        return;
                    }
                    if (commandName === 'ps') {
                        const listed = await client.request('thread/backgroundTerminals/list', { threadId: sessionId });
                        finishCommand(listed.data.length === 0
                            ? 'No background terminals are running.'
                            : ['Background terminals:', ...listed.data.map((terminal) => `  ${terminal.processId}  ${terminal.command}`)].join('\n'));
                        return;
                    }
                    if (commandName === 'stop') {
                        if (commandArgs) {
                            await client.request('thread/backgroundTerminals/terminate', { threadId: sessionId, processId: commandArgs });
                            finishCommand(`Stopped background terminal ${commandArgs}.`);
                        }
                        else {
                            await client.request('thread/backgroundTerminals/clean', { threadId: sessionId });
                            finishCommand('Stopped all background terminals.');
                        }
                        return;
                    }
                    finishCommand(`/${codexSlash.command} is part of the Codex terminal UI and has no counterpart here — run it in \`codex\` itself.`);
                    return;
                }
                const turnStartParams = {
                    threadId: sessionId,
                    model: model ?? undefined,
                    effort: codexEffort,
                    // Override the app-server's approval policy only when the user picks one
                    // in the composer (otherwise the configured default is used). This is
                    // what makes the exec/patch approval prompts appear interactively.
                    ...(approvalPolicy ? { approvalPolicy } : {}),
                    // A mode needs a concrete model; `currentModel` is 'codex' only when
                    // none is known, and then the thread keeps whatever mode it had.
                    ...(collaborationMode && currentModel !== 'codex' ? {
                        collaborationMode: {
                            mode: collaborationMode,
                            settings: {
                                model: currentModel,
                                // Plan's preset reasons at medium (collaborationMode/list).
                                reasoning_effort: codexEffort ?? (collaborationMode === 'plan' ? 'medium' : null),
                                // null keeps the preset's own instructions.
                                developer_instructions: null,
                            },
                        },
                    } : {}),
                    input: buildCodexComposerInput(codexInitPrompt ?? userMessage, attachments, cwdOverride),
                } satisfies CodexRequestParams<'turn/start'>;
                // No watchdog covers this call yet — it runs before activateTargetTurn
                // sets up startTurnWatchdog above, so a hang here (e.g. the app-server
                // blocked on a custom model provider's auth/discovery) would otherwise
                // wedge the composer in "sending" forever. Bound it and let the failure
                // surface as a timeout message, which isTransientSendError already
                // classifies as retryable on the client.
                let started: CodexResponseFor<'turn/start'>;
                try {
                    await checkpoint?.catch(() => null);
                    started = await withTimeout(client.request('turn/start', turnStartParams), providerStartupTimeoutMs(model, 20000), 'Codex turn/start');
                }
                catch (err) {
                    // The resume cache said this thread was live but the server lost it
                    // (e.g. a restart raced the disconnect listener). Re-resume once.
                    if (!isCodexMissingRolloutError(err))
                        throw err;
                    forgetCodexThreadResumed(sessionId);
                    await withTimeout(ensureCodexThreadResumed(sessionId), 8000, 'Codex thread re-resume');
                    started = await withTimeout(client.request('turn/start', turnStartParams), providerStartupTimeoutMs(model, 20000), 'Codex turn/start retry');
                }
                activateTargetTurn(started.turn.id);
            }
            catch (err) {
                unsubscribe();
                clearRunningSession(sessionId, turnRequestId);
                safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`);
                safeClose();
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
    const provider = "codex";
    {
        // A resume advances Codex's activity timestamp even without a message.
        // Wait for the actual send; composer focus must remain read-only.
        return;
    }
}
/** Existing SDK dispatch, reached only through bundled extension runtime entries. */
export async function streamTurn(params: SendMessageParams, checkpoint?: Promise<TurnCheckpoint | null>): Promise<Response> {
    const provider = "codex";
    {
        return createCodexStream(params.sessionId, params.signal, params.body, checkpoint);
    }
}
export async function forkSession({ sessionId, body, provider }: ForkParams): Promise<{
    sessionId: string;
}> {
    const resolvedProvider = "codex";
    {
        const client = getCodexClient();
        const response = await client.request('thread/fork', {
            threadId: sessionId,
        });
        if (typeof body.title === 'string' && body.title.trim()) {
            await client.request('thread/name/set', {
                threadId: response.thread.id,
                name: body.title.trim(),
            });
        }
        return { sessionId: response.thread.id };
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
    const provider = "codex";
    const resolvedCwd = (cwd && cwd.trim()) ? cwd : process.cwd();
    {
        const client = getCodexClient();
        const response = await client.request('thread/start', {
            ...(codexDynamicTools?.length ? { dynamicTools: codexDynamicTools } : {}),
            cwd: resolvedCwd,
        });
        const newId = response.thread.id;
        // thread/start already loads the thread into this app-server process. Mark
        // it before the TUI can poll session detail so metadata reads reuse the
        // loaded writer instead of issuing thread/resume against an active turn.
        markCodexThreadResumed(newId, response.model);
        if (title && title.trim()) {
            await client.request('thread/name/set', { threadId: newId, name: title.trim() }).catch(() => { });
        }
        return { sessionId: newId, provider: "codex", cwd: response.thread.cwd ?? resolvedCwd, isPending: true };
    }
}
/** Release provider-side resources for an active session without deleting its durable history. */
export async function closeSession(sessionId: string, providerOverride?: AgentProvider): Promise<void> {
    const provider = "codex";
    {
        await getCodexClient().request('thread/unsubscribe', { threadId: sessionId }).catch(() => { });
        forgetCodexThreadResumed(sessionId);
        return;
    }
}
export function listPendingPermissions(sessionId: string, provider?: AgentProvider): Record<string, unknown>[] {
    {
        const prefix = `${sessionId}:`;
        return Array.from(pendingCodexApprovals)
            .filter(([key]) => key.startsWith(prefix))
            .map(([, pending]) => codexApprovalRequestedPayload(sessionId, {
            id: pending.rawId,
            method: pending.method,
            params: pending.params,
        }));
    }
}
/** Process-local control-plane state for fleet and attention clients. */
export async function rewindSession({ sessionId, body, provider }: RewindParams): Promise<Record<string, unknown>> {
    const resolvedProvider = "codex";
    {
        const thread = await readCodexThread(sessionId, true);
        // Either a turn to go back to before (exact) or a count from the end.
        const beforeTurnId = typeof body.beforeTurnId === 'string' ? body.beforeTurnId : undefined;
        const beforeIndex = beforeTurnId
            ? thread.turns.findIndex((turn) => turn.id === beforeTurnId)
            : thread.turns.length - Number(body.numTurns ?? 1);
        if (!Number.isFinite(beforeIndex) || beforeIndex < 0 || beforeIndex >= thread.turns.length) {
            throw new Error(beforeTurnId ? 'That turn is not in this thread' : 'numTurns is required');
        }
        const numTurns = thread.turns.length - beforeIndex;
        const removedTurns = thread.turns.slice(beforeIndex).map((turn) => {
            const firstUserItem = turn.items.find((item) => item.type === 'userMessage');
            const preview = firstUserItem && firstUserItem.type === 'userMessage'
                ? firstUserItem.content
                    .map((entry) => entry.type === 'text' ? entry.text : '')
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                : turn.items[0]?.type ?? turn.id;
            return {
                turnId: turn.id,
                preview: preview || turn.id,
            };
        });
        if (body.dryRun) {
            return {
                mode: 'rollback',
                canRollback: true,
                turnsRemoved: removedTurns,
            };
        }
        const client = getCodexClient();
        // Reverting needs the thread loaded in this app-server ("thread not found"
        // otherwise); a turn or prewarm usually has it, a cold session does not.
        await ensureCodexThreadResumed(sessionId);
        // codex-cli 0.158 removed `thread/rollback` in favour of `thread/revert`;
        // older app-servers have only the former.
        try {
            await client.request('thread/revert', {
                threadId: sessionId,
                beforeTurnId: thread.turns[beforeIndex]!.id,
            });
        }
        catch (err) {
            if (!/unknown variant `thread\/revert`/.test(err instanceof Error ? err.message : String(err)))
                throw err;
            await client.request('thread/rollback', { threadId: sessionId, numTurns });
        }
        return {
            mode: 'rollback',
            canRollback: true,
            turnsRemoved: removedTurns,
            remainingTurns: beforeIndex,
        };
    }
}
export function readMemoryDiagnostics(): Record<string, number> {
    let codexApprovals = 0;
    try {
        codexApprovals = pendingCodexApprovals.size;
    }
    catch { /* defined later in module; ignore during init */ }
    return {
        pendingCodexApprovals: codexApprovals
    };
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
