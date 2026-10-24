import { registerProviderDiagnostics } from '../../../providerDiagnostics'
// Provider architecture extraction: SDK behavior preserved from the session backend.
import { createTurnUsageReporter } from '../runtimeCore'
import { classifyClaudeUsageMessage, type ClaudeUsageLimitKind } from "../../../claudeUsageLimits";
import type { ElicitationResult as ClaudeElicitationResult, OnUserDialog, PermissionResult, PermissionUpdate, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
export type PendingClaudePermission = {
    resolve: (result: PermissionResult) => void;
    suggestions?: PermissionUpdate[];
    input?: Record<string, unknown>;
    // The exact `data` payload sent in the permission.requested frame, retained so
    // a client that reconnects mid-turn can re-surface the still-pending prompt
    // (the resolver stays valid and is answered by id, independent of the stream
    // that created it).
    requestData?: Record<string, unknown>;
};
declare global {
    // eslint-disable-next-line no-var
    var __agentViewerPendingClaudePermissions: Map<string, PendingClaudePermission> | undefined;
}
export const pendingClaudePermissions = globalThis.__agentViewerPendingClaudePermissions
    ?? (globalThis.__agentViewerPendingClaudePermissions = new Map<string, PendingClaudePermission>());
export type PendingClaudeElicitation = {
    resolve: (result: ClaudeElicitationResult) => void;
    requestData: Record<string, unknown>;
    requestedSchema?: Record<string, unknown>;
};
declare global {
    // eslint-disable-next-line no-var
    var __agentViewerPendingClaudeElicitations: Map<string, PendingClaudeElicitation> | undefined;
}
export const pendingClaudeElicitations = globalThis.__agentViewerPendingClaudeElicitations
    ?? (globalThis.__agentViewerPendingClaudeElicitations = new Map<string, PendingClaudeElicitation>());
export type PendingClaudeDialog = {
    resolve: (result: {
        behavior: 'completed';
        result: unknown;
    } | {
        behavior: 'cancelled';
    }) => void;
    requestData: Record<string, unknown>;
};
declare global {
    // eslint-disable-next-line no-var
    var __agentViewerPendingClaudeDialogs: Map<string, PendingClaudeDialog> | undefined;
}
export const pendingClaudeDialogs = globalThis.__agentViewerPendingClaudeDialogs
    ?? (globalThis.__agentViewerPendingClaudeDialogs = new Map<string, PendingClaudeDialog>());
// Pending Claude prompts (tool permissions + AskUserQuestion) still awaiting a
// response for this session, as permission.requested `data` payloads. Lets a
// reconnecting client re-arm in-flight prompts instead of leaving the turn
// blocked on an answer it can no longer see.
export function listPendingClaudePrompts(sessionId: string): Record<string, unknown>[] {
    const prefix = `${sessionId}:`;
    const prompts: Record<string, unknown>[] = [];
    for (const [key, pending] of pendingClaudePermissions) {
        if (key.startsWith(prefix) && pending.requestData)
            prompts.push(pending.requestData);
    }
    return prompts;
}
export function listPendingClaudeElicitations(sessionId: string): Record<string, unknown>[] {
    const prefix = `${sessionId}:`;
    return [
        ...Array.from(pendingClaudeElicitations)
            .filter(([key]) => key.startsWith(prefix))
            .map(([, pending]) => pending.requestData),
        ...Array.from(pendingClaudeDialogs)
            .filter(([key]) => key.startsWith(prefix))
            .map(([, pending]) => pending.requestData),
    ];
}
export function pendingClaudePermissionKey(sessionId: string, permissionId: string): string {
    return `${sessionId}:${permissionId}`;
}
export function claudePermissionDecision(response: string, pending: Pick<PendingClaudePermission, 'suggestions' | 'input'>, permissionMode?: ClaudePermissionModeValue): PermissionResult {
    // The SDK always injects toolUseID into the control response itself, so we
    // omit it here. decisionClassification is in the TypeScript types but the
    // CLI's Zod schema does not accept it — including it causes a validation
    // error that blocks the approval.
    if (response === 'reject') {
        return {
            behavior: 'deny',
            message: 'User denied permission',
        };
    }
    // A plan approval carries the mode to continue in. It has to ride the
    // approval itself: allowing ExitPlanMode leaves plan mode by restoring the
    // mode from before it, which overwrote a setPermissionMode sent a moment
    // earlier — so "approve · auto-accept edits" went on asking for every edit.
    // This is how Claude Code applies the choice.
    const updatedPermissions = [
        ...(response === 'always' && pending.suggestions?.length ? pending.suggestions : []),
        ...(permissionMode ? [{ type: 'setMode' as const, mode: permissionMode, destination: 'session' as const }] : []),
    ];
    return {
        behavior: 'allow',
        updatedInput: pending.input ?? {},
        ...(updatedPermissions.length ? { updatedPermissions } : {}),
    };
}
// Native SDK dialogs are distinct from MCP elicitation, but Agent Viewer can
// render them through the same durable prompt surface. Only dialog kinds the
// UI explicitly supports are declared on query startup; unknown kinds fail
// closed rather than being guessed at.
export function createClaudeUserDialogBridge(sessionId: string, controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder): OnUserDialog {
    const enqueue = (payload: Record<string, unknown>) => {
        try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        }
        catch { /* detached client */ }
    };
    return async (request, options) => {
        if (options.signal.aborted || request.dialogKind !== 'refusal_fallback_prompt') {
            return { behavior: 'cancelled' };
        }
        const requestId = options.requestId;
        const payloadMessage = typeof request.payload.message === 'string'
            ? request.payload.message
            : 'Claude declined this request. Continue with the configured fallback model?';
        const requestData: Record<string, unknown> = {
            requestId,
            sessionId,
            message: payloadMessage,
            mode: 'form',
            dialogKind: request.dialogKind,
            dialogPayload: request.payload,
            requestedSchema: {
                type: 'object',
                properties: {
                    continue: {
                        type: 'boolean',
                        title: 'Continue with fallback model',
                        default: true,
                    },
                },
                required: ['continue'],
            },
            title: 'Model fallback',
            description: payloadMessage,
        };
        enqueue({
            type: 'claude_elicitation',
            event: { type: 'elicitation.requested', data: requestData },
        });
        return new Promise((resolve) => {
            const key = pendingClaudePermissionKey(sessionId, requestId);
            const cleanup = () => {
                pendingClaudeDialogs.delete(key);
                options.signal.removeEventListener('abort', onAbort);
            };
            const finish: PendingClaudeDialog['resolve'] = (result) => {
                cleanup();
                enqueue({
                    type: 'claude_elicitation',
                    event: { type: 'elicitation.completed', data: { requestId, action: result.behavior } },
                });
                resolve(result);
            };
            const onAbort = () => finish({ behavior: 'cancelled' });
            options.signal.addEventListener('abort', onAbort, { once: true });
            pendingClaudeDialogs.set(key, { resolve: finish, requestData });
        });
    };
}
export const CLAUDE_PERMISSION_MODES = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions', 'dontAsk'] as const;
export type ClaudePermissionModeValue = typeof CLAUDE_PERMISSION_MODES[number];
// A Claude `result` message can report a non-success terminal state
// (max-turns / budget / execution error) or a recovered-but-errored API call
// (subtype 'success' with is_error + api_error_status). The SDK surfaces these
// inline in the CLI; without this the turn just goes quiet. Returns a
// human-readable error string plus the raw HTTP status when the SDK reported
// one, so callers can classify retryability structurally instead of parsing
// the message text; null when the result is a clean success.
export function claudeResultErrorMessage(msg: Record<string, unknown>): {
    message: string;
    apiErrorStatus?: number;
    usageLimit?: ClaudeUsageLimitKind;
} | null {
    if (msg.type !== 'result')
        return null;
    const subtype = typeof msg.subtype === 'string' ? msg.subtype : '';
    if (subtype === 'error_max_turns')
        return { message: 'Claude reached the maximum number of turns before finishing.' };
    if (subtype === 'error_max_budget_usd')
        return { message: 'Claude reached the maximum cost budget before finishing.' };
    if (subtype === 'error_max_structured_output_retries')
        return { message: 'Claude could not produce a valid structured response.' };
    if (subtype === 'error_during_execution') {
        const errors = Array.isArray(msg.errors) ? msg.errors.filter((entry): entry is string => typeof entry === 'string') : [];
        return { message: errors.length ? `Claude hit an error: ${errors.join('; ')}` : 'Claude hit an error during execution.' };
    }
    if (subtype === 'success' && msg.is_error === true) {
        const apiErrorStatus = typeof msg.api_error_status === 'number' ? msg.api_error_status : undefined;
        const status = apiErrorStatus != null ? ` (HTTP ${apiErrorStatus})` : '';
        const detail = typeof msg.result === 'string' && msg.result.trim() ? `: ${msg.result.trim()}` : '';
        // Classify before wrapping: the SDK's prefixes describe the raw generated
        // text, and "Claude API error (HTTP 429): You've hit your…" is a usage
        // limit, not an overloaded API — the retry paths need to tell them apart.
        const usageLimit = classifyClaudeUsageMessage(typeof msg.result === 'string' ? msg.result : null) ?? undefined;
        return { message: `Claude API error${status}${detail}`, apiErrorStatus, usageLimit };
    }
    return null;
}
// The Claude SDK emits one `stream_event` message per streamed text/thinking
// chunk (content_block_delta), each forwarded as its own SSE frame. Unlike
// Codex/Pi/OpenCode (see DELTA_METHODS / PI_DELTA_SPILL_CHARS above), Claude's
// deltas went straight to the wire — every token triggered a client re-render.
// Coalesce consecutive deltas for the same block index/kind into one merged
// frame, spilling early past CLAUDE_DELTA_SPILL_CHARS so a long uninterrupted
// stream still flushes periodically. Any non-delta message is an interaction
// boundary and flushes the pending delta first so transcript ordering holds.
export const CLAUDE_DELTA_SPILL_CHARS = 4000;
export function claudeStreamDeltaKey(msg: SDKMessage): {
    index: number;
    kind: 'text_delta' | 'thinking_delta';
    text: string;
} | null {
    const record = msg as unknown as Record<string, unknown>;
    if (record.type !== 'stream_event')
        return null;
    const event = record.event as Record<string, unknown> | undefined;
    if (!event || event.type !== 'content_block_delta' || typeof event.index !== 'number')
        return null;
    const delta = event.delta as Record<string, unknown> | undefined;
    if (!delta)
        return null;
    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        return { index: event.index, kind: 'text_delta', text: delta.text };
    }
    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        return { index: event.index, kind: 'thinking_delta', text: delta.thinking };
    }
    return null;
}
/**
 * Live output-token accounting for a Claude turn.
 *
 * Anthropic reports `usage.output_tokens` on `message_delta` as the running
 * total FOR THAT MESSAGE, and one turn contains several assistant messages
 * once tools run. So the total is "sum of the latest count per message id",
 * not "sum of every delta" — the latter re-adds the whole message on each
 * delta and inflates the counter badly. This mirrors the per-message
 * accounting the OpenCode/Copilot/Pi paths already do, and lets Claude report
 * live usage over the same `turn-usage` frame every other provider uses.
 *
 * Exported for claudeTurnUsageSmoke.ts.
 */
export function createClaudeTurnUsageTracker(enqueue: (chunk: string) => void) {
    const report = createTurnUsageReporter(enqueue);
    const outputByMessageId = new Map<string, number>();
    // Fallback bucket for the theoretical stream that reports a message_delta
    // without a preceding message_start: overwriting undercounts at worst,
    // whereas a fresh key per delta would resurrect the inflation bug.
    const UNKEYED = '\u0000unkeyed';
    let currentMessageId = UNKEYED;
    return (msg: SDKMessage) => {
        const record = msg as unknown as Record<string, unknown>;
        // Subagent streams carry their own usage; the turn counter tracks the
        // main loop only, matching what the composer status line claims to show.
        if (record.type !== 'stream_event' || record.parent_tool_use_id)
            return;
        const event = record.event as Record<string, unknown> | undefined;
        if (!event)
            return;
        if (event.type === 'message_start') {
            const message = event.message as Record<string, unknown> | undefined;
            currentMessageId = typeof message?.id === 'string' && message.id ? message.id : UNKEYED;
            return;
        }
        if (event.type !== 'message_delta')
            return;
        const outputTokens = (event.usage as Record<string, unknown> | undefined)?.output_tokens;
        if (typeof outputTokens !== 'number' || !Number.isFinite(outputTokens))
            return;
        outputByMessageId.set(currentMessageId, Math.max(0, outputTokens));
        let total = 0;
        for (const value of outputByMessageId.values())
            total += value;
        report(total);
    };
}
// Coalescing is for render cost, not for holding text back: without a timed
// flush a reply under the spill size appeared only when its block ended, so
// short and medium answers did not stream at all.
export const CLAUDE_DELTA_FLUSH_MS = 40;
export function createClaudeDeltaCoalescer(enqueue: (chunk: string) => void) {
    let pending: SDKMessage | null = null;
    let pendingKey: {
        index: number;
        kind: 'text_delta' | 'thinking_delta';
        text: string;
    } | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const trackTurnUsage = createClaudeTurnUsageTracker(enqueue);
    const flush = () => {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (!pending)
            return;
        const msg = pending;
        pending = null;
        pendingKey = null;
        enqueue(`data: ${JSON.stringify(msg)}\n\n`);
    };
    const emit = (msg: SDKMessage) => {
        const key = claudeStreamDeltaKey(msg);
        if (!key) {
            flush();
            enqueue(`data: ${JSON.stringify(msg)}\n\n`);
            // After the frame itself, so a usage frame never lands ahead of the
            // message it accounts for.
            trackTurnUsage(msg);
            return;
        }
        if (!pending || !pendingKey || pendingKey.index !== key.index || pendingKey.kind !== key.kind) {
            flush();
            pending = msg;
            pendingKey = key;
            scheduleFlush();
            return;
        }
        const mergedText = pendingKey.text + key.text;
        const pendingRecord = pending as unknown as Record<string, unknown>;
        const pendingEvent = pendingRecord.event as Record<string, unknown>;
        const pendingDelta = pendingEvent.delta as Record<string, unknown>;
        const merged = {
            ...pendingRecord,
            event: {
                ...pendingEvent,
                delta: key.kind === 'text_delta'
                    ? { ...pendingDelta, text: mergedText }
                    : { ...pendingDelta, thinking: mergedText },
            },
        } as unknown as SDKMessage;
        pending = merged;
        pendingKey = { ...key, text: mergedText };
        if (mergedText.length >= CLAUDE_DELTA_SPILL_CHARS) {
            flush();
            return;
        }
        scheduleFlush();
    };
    const scheduleFlush = () => {
        if (flushTimer)
            return;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            // The downstream may have closed between scheduling and firing.
            try {
                flush();
            }
            catch { /* stream already closed */ }
        }, CLAUDE_DELTA_FLUSH_MS);
    };
    return { emit, flush };
}


registerProviderDiagnostics('claude:permissions', () => ({ pendingClaudePermissions: pendingClaudePermissions.size, pendingClaudeElicitations: pendingClaudeElicitations.size, pendingClaudeDialogs: pendingClaudeDialogs.size }))
