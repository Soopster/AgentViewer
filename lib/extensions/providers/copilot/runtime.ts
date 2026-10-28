// Provider architecture extraction: SDK behavior preserved from the session backend.
import { parseQuestionAnswers, createTurnUsageReporter, parseAttachments, parseEffort, parseTurnRequestId } from '../runtimeCore'
import { steerViewSession } from '../../../sessionSteering'
import { listPendingProviderPermissionPayloads } from '../../../sessionControlPlane'
import { coordinatorPermissionToken } from "../../../coordinatorNativePermission";
import { extractPendingPermissions } from "../../../permissions";
import { broadcastLiveSessionActivity, broadcastLiveSessionTurnEnd, broadcastLiveSessionTurnStart } from "../../../liveSessionHarness";
import { approveAll, type ContextTier as CopilotContextTier, type MessageOptions as CopilotMessageOptions, type ModelInfo as CopilotModelInfo, type PermissionRequest as CopilotPermissionRequest, type PermissionRequestResult as CopilotPermissionRequestResult, type ElicitationContext as CopilotElicitationContext, type ElicitationResult as CopilotElicitationResult, type SessionEvent as CopilotSessionEvent } from '@github/copilot-sdk';
import { withTimeout } from "../../../withTimeout";
import { providerStartupTimeoutMs } from "../../../providerWarmup";
import { type CopilotAgentMode, type CopilotPersistentMode, parseCopilotContextTier, parseCopilotMode, parseCopilotModeResponse } from "../../../copilotComposer";
import { clearCopilotLiveTranscript, scheduleCopilotLiveTranscriptCleanup, recordCopilotLiveTranscriptEvent } from "../../../liveTranscripts";
import { copilotPermissionModeFromSdk, copilotPermissionModeToSdk, type CopilotPermissionMode } from "../../../adapters/shared";
import { PendingRequestGoneError } from "../../../pendingRequestGone";
import { clearRunningSession, interruptRunningSession, setRunningSession } from "../../../sessionRuntime";
import type { TurnCheckpoint } from "../../../checkpoints";
import { appendPortableComposerContext, assertComposerAttachmentsSupported, planComposerAttachments, resolveLocalComposerAttachmentPath } from "../../../composerAttachments";
import type { AgentProvider, ContextUsage, SendAttachment, ReasoningEffortLevel } from "../../../types";
export type CopilotReasoningEffort = Extract<ReasoningEffortLevel, 'low' | 'medium' | 'high' | 'xhigh'>;
import { acquireCopilotSession, refreshCopilotBackgroundTasks, copilotPoolSize, copilotSessionConfigOverrides, evictCopilotSession, getCopilotClient, retainCopilotSession, rewindCopilotSessionFiles, setCopilotElicitationHandler, setCopilotPermissionHandler, steerCopilotSession } from "../../../copilotClient";
import { mapCopilotUsageToContextUsage } from "../../../copilotMapper";
import type { DynamicToolSpec } from "../../../codex-schema/v2";
export const COPILOT_TURN_INACTIVITY_MS = 300000;
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
export function attachmentPath(attachment: SendAttachment): string | undefined {
    return attachment.path || attachment.filePath;
}
export type CopilotSendAttachment = NonNullable<CopilotMessageOptions['attachments']>[number] | {
    type: 'extension_context';
    title: string;
    extensionId: string;
    capturedAt: string;
    canvasId?: string;
    instanceId?: string;
    payload?: Record<string, unknown>;
};
export type CopilotSendMessageOptions = Omit<CopilotMessageOptions, 'attachments'> & {
    attachments?: CopilotSendAttachment[];
};
export function buildCopilotAttachments(attachments: SendAttachment[], cwd?: string): CopilotSendAttachment[] {
    const result: CopilotSendAttachment[] = [];
    for (const attachment of attachments) {
        const path = attachmentPath(attachment);
        if (attachment.type === 'file' || attachment.type === 'image' || attachment.type === 'mention') {
            if (path)
                result.push({ type: 'file', path: resolveLocalComposerAttachmentPath(path, cwd), displayName: attachment.displayName });
            continue;
        }
        if (attachment.type === 'directory') {
            if (path)
                result.push({ type: 'directory', path: resolveLocalComposerAttachmentPath(path, cwd), displayName: attachment.displayName });
            continue;
        }
        if (attachment.type === 'selection') {
            const filePath = attachment.filePath || attachment.path;
            if (filePath && attachment.displayName) {
                result.push({
                    type: 'selection',
                    filePath: resolveLocalComposerAttachmentPath(filePath, cwd),
                    displayName: attachment.displayName,
                    selection: attachment.selection,
                    text: attachment.text,
                });
            }
            continue;
        }
        if (attachment.type === 'blob' && attachment.data && attachment.mimeType) {
            result.push({
                type: 'blob',
                data: attachment.data,
                mimeType: attachment.mimeType,
                displayName: attachment.displayName,
            });
            continue;
        }
        if (attachment.type === 'extension_context' && attachment.extensionId && attachment.capturedAt && attachment.displayName) {
            result.push({
                type: 'extension_context',
                title: attachment.displayName,
                extensionId: attachment.extensionId,
                capturedAt: attachment.capturedAt,
                canvasId: attachment.canvasId,
                instanceId: attachment.instanceId,
                payload: attachment.payload,
            });
        }
    }
    return result;
}
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
export function copilotCommandResultEvent(data: Record<string, unknown>): string {
    return `event: command-result\ndata: ${JSON.stringify({ provider: 'copilot', transcriptExpected: false, ...data })}\n\n`;
}
export function parseCopilotPermissionMode(value: unknown): CopilotPermissionMode | undefined {
    return value === 'off' || value === 'auto' || value === 'on' ? value : undefined;
}
export function isCopilotPersistentMode(mode: CopilotAgentMode): mode is CopilotPersistentMode {
    return mode !== 'shell';
}
export function copilotPermissionDecision(response: string, feedback?: string): Exclude<CopilotPermissionRequestResult, {
    kind: 'no-result';
}> {
    return response === 'once'
        ? { kind: 'approve-once' }
        : response === 'always'
            ? { kind: 'approve-for-session' }
            : { kind: 'reject', ...(feedback ? { feedback } : {}) };
}
export type PendingCopilotPermission = {
    resolve: (result: Exclude<CopilotPermissionRequestResult, {
        kind: 'no-result';
    }>) => void;
    requestPayload: Record<string, unknown>;
};
declare global {
    // eslint-disable-next-line no-var
    var __agentViewerPendingCopilotPermissions: Map<string, PendingCopilotPermission> | undefined;
}
export const pendingCopilotPermissions = globalThis.__agentViewerPendingCopilotPermissions
    ?? (globalThis.__agentViewerPendingCopilotPermissions = new Map<string, PendingCopilotPermission>());
export type PendingCopilotElicitation = {
    resolve: (result: CopilotElicitationResult) => void;
    requestPayload: Record<string, unknown>;
    requestedSchema?: Record<string, unknown>;
};
declare global {
    // eslint-disable-next-line no-var
    var __agentViewerPendingCopilotElicitations: Map<string, PendingCopilotElicitation> | undefined;
}
export const pendingCopilotElicitations = globalThis.__agentViewerPendingCopilotElicitations
    ?? (globalThis.__agentViewerPendingCopilotElicitations = new Map<string, PendingCopilotElicitation>());
export function pendingCopilotPermissionKey(sessionId: string, permissionId: string): string {
    return `${sessionId}:${permissionId}`;
}
export function copilotPermissionRequestedPayload(sessionId: string, requestId: string, permissionRequest: CopilotPermissionRequest): Record<string, unknown> {
    return {
        type: 'copilot_event',
        event: {
            id: requestId,
            parentId: null,
            timestamp: new Date().toISOString(),
            type: 'permission.requested',
            data: {
                requestId,
                permissionRequest,
            },
        },
    };
}
export function copilotPermissionRequestedEvent(sessionId: string, requestId: string, permissionRequest: CopilotPermissionRequest): string {
    return JSON.stringify(copilotPermissionRequestedPayload(sessionId, requestId, permissionRequest));
}
export function createCopilotPermissionBridge(sessionId: string, enqueue: (chunk: string) => void, activeIds: Set<string>, canAwaitUser: () => boolean): (request: CopilotPermissionRequest) => Promise<Exclude<CopilotPermissionRequestResult, {
    kind: 'no-result';
}>> {
    return (request) => {
        if (!canAwaitUser()) {
            return Promise.resolve({ kind: 'user-not-available' });
        }
        const requestId = `agent-viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        activeIds.add(requestId);
        enqueue(`data: ${copilotPermissionRequestedEvent(sessionId, requestId, request)}\n\n`);
        if (!canAwaitUser()) {
            activeIds.delete(requestId);
            return Promise.resolve({ kind: 'user-not-available' });
        }
        return new Promise((resolve) => {
            const key = pendingCopilotPermissionKey(sessionId, requestId);
            pendingCopilotPermissions.set(key, {
                resolve: (result) => {
                    pendingCopilotPermissions.delete(key);
                    activeIds.delete(requestId);
                    resolve(result);
                },
                requestPayload: copilotPermissionRequestedPayload(sessionId, requestId, request),
            });
        });
    };
}
export function createCopilotElicitationBridge(sessionId: string, enqueue: (chunk: string) => void, activeIds: Set<string>, canAwaitUser: () => boolean): (context: CopilotElicitationContext) => Promise<CopilotElicitationResult> {
    return (context) => {
        if (!canAwaitUser())
            return Promise.resolve({ action: 'cancel' });
        const requestId = `agent-viewer-elicitation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const requestPayload = {
            type: 'copilot_event',
            event: {
                id: requestId,
                parentId: null,
                timestamp: new Date().toISOString(),
                type: 'elicitation.requested',
                ephemeral: true,
                data: {
                    requestId,
                    message: context.message,
                    mode: context.mode ?? 'form',
                    elicitationSource: context.elicitationSource,
                    url: context.url,
                    requestedSchema: context.requestedSchema,
                },
            },
        };
        activeIds.add(requestId);
        enqueue(`data: ${JSON.stringify(requestPayload)}\n\n`);
        return new Promise((resolve) => {
            const key = pendingCopilotPermissionKey(sessionId, requestId);
            pendingCopilotElicitations.set(key, {
                resolve: (result) => {
                    pendingCopilotElicitations.delete(key);
                    activeIds.delete(requestId);
                    resolve(result);
                },
                requestPayload,
                requestedSchema: context.requestedSchema ? { ...context.requestedSchema } : undefined,
            });
        });
    };
}
export function resolvePendingCopilotPermissions(sessionId: string, ids: Set<string>, result: Exclude<CopilotPermissionRequestResult, {
    kind: 'no-result';
}>): void {
    for (const id of Array.from(ids)) {
        const key = pendingCopilotPermissionKey(sessionId, id);
        const pending = pendingCopilotPermissions.get(key);
        if (!pending)
            continue;
        pendingCopilotPermissions.delete(key);
        ids.delete(id);
        pending.resolve(result);
    }
}
export function resolvePendingCopilotElicitations(sessionId: string, ids: Set<string>, result: CopilotElicitationResult): void {
    for (const id of Array.from(ids)) {
        const key = pendingCopilotPermissionKey(sessionId, id);
        const pending = pendingCopilotElicitations.get(key);
        if (!pending)
            continue;
        pendingCopilotElicitations.delete(key);
        ids.delete(id);
        pending.resolve(result);
    }
}
export function formatCopilotEvent(event: CopilotSessionEvent): string {
    return JSON.stringify({ type: 'copilot_event', event });
}
export async function readCopilotHistoryFromSession(session: Awaited<ReturnType<typeof acquireCopilotSession>>): Promise<CopilotSessionEvent[]> {
    const historyReader = session as typeof session & {
        getEvents?: () => Promise<CopilotSessionEvent[]>;
        getMessages?: () => Promise<CopilotSessionEvent[]>;
    };
    if (typeof historyReader.getEvents === 'function') {
        return historyReader.getEvents();
    }
    if (typeof historyReader.getMessages === 'function') {
        return historyReader.getMessages();
    }
    throw new Error('Copilot session does not expose a history reader');
}
export function isCopilotAssistantMessage(event: CopilotSessionEvent): event is Extract<CopilotSessionEvent, {
    type: 'assistant.message';
}> {
    return event.type === 'assistant.message';
}
export function findCopilotHistoryCompletion(events: CopilotSessionEvent[], baselineCount: number, allowFinalMessageFallback: boolean): Extract<CopilotSessionEvent, {
    type: 'assistant.message';
}> | null {
    const currentEvents = events.slice(Math.max(0, baselineCount));
    const userIndex = currentEvents.findIndex((event) => event.type === 'user.message');
    if (userIndex === -1)
        return null;
    const turnEvents = currentEvents.slice(userIndex);
    const error = turnEvents.find((event) => event.type === 'session.error') as Extract<CopilotSessionEvent, {
        type: 'session.error';
    }> | undefined;
    if (error) {
        const err = new Error(error.data.message);
        if (error.data.stack)
            err.stack = error.data.stack;
        throw err;
    }
    const hasCompletionSignal = turnEvents.some((event) => event.type === 'session.idle' || (event.type as string) === 'session.task_complete');
    const assistant = turnEvents.findLast(isCopilotAssistantMessage);
    if (!assistant)
        return null;
    const hasToolRequests = Array.isArray(assistant.data.toolRequests) && assistant.data.toolRequests.length > 0;
    return hasCompletionSignal || (allowFinalMessageFallback && !hasToolRequests)
        ? assistant
        : null;
}
export async function runAction({ sessionId, body, provider }: SessionActionParams): Promise<Record<string, unknown>> {
    const resolvedProvider = "copilot";
    const action = typeof body.action === 'string' ? body.action : '';
    // Guard again after provider resolution/pool awaits. Remote confirmation
    // cannot fall through to a different session's similarly named request.
    if ((action === 'respondPermission' || action === 'respondQuestion') && typeof body.expectedPermissionToken === 'string') {
        const pending = extractPendingPermissions(listPendingProviderPermissionPayloads(sessionId, "copilot"), { sessionId, provider: "copilot" });
        if (!pending.some(permission => permission.id === body.permissionId && coordinatorPermissionToken(permission) === body.expectedPermissionToken)) {
            throw new PendingRequestGoneError(action === 'respondQuestion' ? 'Question' : 'Permission request');
        }
    }
    // Provider-agnostic: deliver a user message into the running turn (native
    // steering). `delivered: false` means no running turn / no steer primitive /
    // the turn ended while the request was in flight — callers fall back to
    // queueing the message for the next turn.
    if (action === 'steer') {
        return steerViewSession(sessionId, body, "copilot");
    }
    {
        if (action === 'respondPermission') {
            const permissionId = typeof body.permissionId === 'string' ? body.permissionId : '';
            const response = typeof body.response === 'string' ? body.response : '';
            const feedback = typeof body.permissionDecisionReason === 'string' && body.permissionDecisionReason.trim()
                ? body.permissionDecisionReason.trim()
                : undefined;
            if (!permissionId)
                throw new Error('permissionId is required');
            if (response !== 'once' && response !== 'always' && response !== 'reject') {
                throw new Error('response must be once, always, or reject');
            }
            const result = copilotPermissionDecision(response, feedback);
            const key = pendingCopilotPermissionKey(sessionId, permissionId);
            const pending = pendingCopilotPermissions.get(key);
            if (pending) {
                pendingCopilotPermissions.delete(key);
                pending.resolve(result);
                return { ok: true };
            }
            let elicitation = pendingCopilotElicitations.get(key);
            if (!elicitation) {
                for (const [pendingKey, candidate] of pendingCopilotElicitations) {
                    if (!pendingKey.endsWith(`:${permissionId}`))
                        continue;
                    elicitation = candidate;
                    break;
                }
            }
            if (elicitation) {
                elicitation.resolve({
                    action: response === 'reject' ? 'decline' : 'accept',
                    ...(response === 'reject' ? {} : { content: {} }),
                });
                return { ok: true };
            }
            const session = await acquireCopilotSession(sessionId);
            const handled = await session.rpc.permissions.handlePendingPermissionRequest({
                requestId: permissionId,
                result,
            });
            return { ok: handled.success };
        }
        if (action === 'respondQuestion') {
            const permissionId = typeof body.permissionId === 'string' ? body.permissionId : '';
            if (!permissionId)
                throw new Error('permissionId is required');
            const answers = parseQuestionAnswers(body.answers);
            if (!answers)
                throw new Error('answers is required');
            const key = pendingCopilotPermissionKey(sessionId, permissionId);
            let elicitation = pendingCopilotElicitations.get(key);
            if (!elicitation) {
                for (const [pendingKey, candidate] of pendingCopilotElicitations) {
                    if (!pendingKey.endsWith(`:${permissionId}`))
                        continue;
                    elicitation = candidate;
                    break;
                }
            }
            if (!elicitation)
                throw new PendingRequestGoneError('Question');
            elicitation.resolve({
                action: 'accept',
                content: elicitationContentFromAnswers({ requestedSchema: elicitation.requestedSchema }, answers),
            });
            return { ok: true };
        }
        if (action === 'setMode') {
            const mode = parseCopilotMode(body.mode);
            if (!mode)
                throw new Error('mode must be interactive, plan, autopilot, or shell');
            if (isCopilotPersistentMode(mode)) {
                const session = await acquireCopilotSession(sessionId);
                await session.rpc.mode.set({ mode });
            }
            return { ok: true, mode };
        }
        if (action === 'setPermissionMode') {
            const mode = parseCopilotPermissionMode(body.permissionMode);
            if (!mode)
                throw new Error('permissionMode must be off, auto, or on');
            const session = await acquireCopilotSession(sessionId);
            const result = await session.rpc.permissions.setMode({ mode: copilotPermissionModeToSdk(mode) });
            return { ok: result.success, mode: copilotPermissionModeFromSdk(result.mode) ?? mode };
        }
    }
    throw new Error(`Action ${action || '(missing)'} is not supported for ${"copilot"} sessions`);
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
export function copilotModelOptions(params: {
    effort?: CopilotReasoningEffort;
    contextTier?: CopilotContextTier;
}): Parameters<Awaited<ReturnType<typeof acquireCopilotSession>>['setModel']>[1] | undefined {
    const options = {
        ...(params.effort ? { reasoningEffort: params.effort } : {}),
        ...(params.contextTier ? { contextTier: params.contextTier } : {}),
    };
    return Object.keys(options).length > 0 ? options : undefined;
}
export async function createCopilotStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
    const userMessage = String(body.message ?? '').trim();
    const turnRequestId = parseTurnRequestId(body);
    const selectedModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null;
    const effort = parseEffort(body);
    const contextTier = parseCopilotContextTier(body.contextTier);
    let turnAgentMode = parseCopilotMode(body.mode);
    const permissionMode = parseCopilotPermissionMode(body.permissionMode);
    const manualPermissions = body.manualPermissions === true;
    // Native slash execution is the default — matching the Copilot CLI (and the
    // other providers, which never leak "/command" into the prompt). Clients can
    // opt out explicitly with nativeCommands:false.
    const nativeCommands = body.nativeCommands !== false;
    const parsedAttachments = parseAttachments(body);
    const cwdOverride = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined;
    const attachmentPlan = planComposerAttachments('copilot', parsedAttachments);
    assertComposerAttachmentsSupported('copilot', attachmentPlan);
    const attachments = buildCopilotAttachments(attachmentPlan.native, cwdOverride);
    const composerPrompt = appendPortableComposerContext(userMessage, attachmentPlan.portableText);
    const detachOnClientAbort = body.detachOnClientAbort === true;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            let session: Awaited<ReturnType<typeof acquireCopilotSession>> | null = null;
            let releasePooledSession: (() => void) | null = null;
            let unsubscribe: (() => void) | null = null;
            let cleanedUp = false;
            let downstreamClosed = false;
            let requestAborted = false;
            let emittedError = false;
            let manualPermissionHandlerInstalled = false;
            let elicitationHandlerInstalled = false;
            let broadcastedTurnStart = false;
            let turnTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
            let finalMessageFallbackTimer: ReturnType<typeof setTimeout> | null = null;
            let historyPollCancelled = false;
            let finishTurn: (() => void) | null = null;
            let failTurn: ((error: Error) => void) | null = null;
            // Captured from the root assistant.turn_start so we can complete the turn
            // on the matching authoritative assistant.turn_end (faster + more reliable
            // than the 1.5s assistant.message heuristic / session.idle / history poll).
            let currentTurnId: string | null = null;
            const streamedAssistantMessageIds = new Set<string>();
            const seenUsageEventIds = new Set<string>();
            const bridgedPermissionIds = new Set<string>();
            const bridgedElicitationIds = new Set<string>();
            let turnOutputTokens = 0;
            // safeEnqueue is declared further down this stream body; the arrow defers
            // the lookup so the reporter can live beside the counter it reports.
            const reportTurnUsage = createTurnUsageReporter((chunk) => safeEnqueue(chunk));
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
            // Commit the streaming response before resume/model discovery work.
            safeEnqueue(':ok\n\n');
            const close = () => {
                if (cleanedUp)
                    return;
                cleanedUp = true;
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
            const clearFinalMessageFallback = () => {
                if (finalMessageFallbackTimer == null)
                    return;
                clearTimeout(finalMessageFallbackTimer);
                finalMessageFallbackTimer = null;
            };
            const scheduleFinalMessageFallback = (event: Extract<CopilotSessionEvent, {
                type: 'assistant.message';
            }>) => {
                if (turnAgentMode === 'autopilot')
                    return;
                if (Array.isArray(event.data.toolRequests) && event.data.toolRequests.length > 0)
                    return;
                clearFinalMessageFallback();
                finalMessageFallbackTimer = setTimeout(() => {
                    finalMessageFallbackTimer = null;
                    finishTurn?.();
                }, 1500);
                if (typeof finalMessageFallbackTimer === 'object' && finalMessageFallbackTimer && 'unref' in finalMessageFallbackTimer) {
                    (finalMessageFallbackTimer as {
                        unref: () => void;
                    }).unref();
                }
            };
            const sleep = (ms: number) => new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, ms);
                if (typeof timer === 'object' && timer && 'unref' in timer) {
                    (timer as {
                        unref: () => void;
                    }).unref();
                }
            });
            // Inactivity watchdog, NOT an absolute turn ceiling: re-armed by every
            // session event, so it only fires after COPILOT_TURN_INACTIVITY_MS of
            // total silence (no probe RPC exists in the Copilot SDK; the 1s history
            // poll below is the recovery path for missed completions, this is the
            // recovery path for a genuinely dead turn).
            const armTurnInactivityTimeout = () => {
                if (cleanedUp)
                    return;
                if (turnTimeoutTimer != null)
                    clearTimeout(turnTimeoutTimer);
                turnTimeoutTimer = setTimeout(() => {
                    failTurn?.(new Error(`Copilot turn produced no events for ${COPILOT_TURN_INACTIVITY_MS / 1000}s`));
                }, COPILOT_TURN_INACTIVITY_MS);
                if (typeof turnTimeoutTimer === 'object' && turnTimeoutTimer && 'unref' in turnTimeoutTimer) {
                    (turnTimeoutTimer as {
                        unref: () => void;
                    }).unref();
                }
            };
            try {
                const modelsById = new Map<string, CopilotModelInfo>();
                let activeContextTier = contextTier;
                const turnComplete = new Promise<void>((resolve, reject) => {
                    finishTurn = () => {
                        clearFinalMessageFallback();
                        resolve();
                    };
                    failTurn = (error) => {
                        clearFinalMessageFallback();
                        reject(error);
                    };
                });
                const handleEvent = (event: CopilotSessionEvent) => {
                    if (cleanedUp)
                        return;
                    // Any session event proves the turn is alive — push the inactivity
                    // deadline out. Only sustained SILENCE (no events at all) times out;
                    // a long autopilot run that keeps emitting is never killed.
                    armTurnInactivityTimeout();
                    recordCopilotLiveTranscriptEvent(sessionId, event);
                    broadcastLiveSessionActivity('copilot', sessionId);
                    // Only the root agent's turn lifecycle ends our turn; sub-agent
                    // turn_start/turn_end (which carry an agentId) must not finish it.
                    const eventAgentId = (event as {
                        agentId?: string;
                    }).agentId;
                    if (event.type === 'assistant.message') {
                        streamedAssistantMessageIds.add(event.data.messageId);
                        scheduleFinalMessageFallback(event);
                    }
                    else if (event.type === 'assistant.turn_start') {
                        if (!eventAgentId)
                            currentTurnId = event.data.turnId ?? currentTurnId;
                        clearFinalMessageFallback();
                    }
                    else if (event.type === 'assistant.turn_end') {
                        // Authoritative completion. Match the captured root turnId so a stale
                        // or sub-agent turn_end can't end the turn early; if we never saw a
                        // turn_start, accept it rather than risk hanging on the heuristics.
                        if (!eventAgentId && (currentTurnId == null || event.data.turnId === currentTurnId)) {
                            finishTurn?.();
                        }
                    }
                    else if ((event.type as string) === 'session.idle' || (event.type as string) === 'session.task_complete') {
                        finishTurn?.();
                    }
                    if (event.type === 'assistant.usage') {
                        const usage = mapCopilotUsageToContextUsage(event, modelsById, activeContextTier);
                        if (usage) {
                            safeEnqueue(codexContextUsageToEventData(usage));
                            if (!seenUsageEventIds.has(event.id)) {
                                seenUsageEventIds.add(event.id);
                                turnOutputTokens += Math.max(0, event.data.outputTokens ?? 0);
                                reportTurnUsage(turnOutputTokens);
                            }
                        }
                    }
                    if (event.type === 'session.error') {
                        emittedError = true;
                        const error = new Error(event.data.message);
                        if (event.data.stack)
                            error.stack = event.data.stack;
                        failTurn?.(error);
                        safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: event.data.message })}\n\n`);
                        return;
                    }
                    safeEnqueue(`data: ${formatCopilotEvent(event)}\n\n`);
                };
                // Warm session pool: re-use a single Copilot session per id across
                // sends and bind a fresh listener for this turn only. The native CLI
                // keeps the JSON-RPC connection alive between turns; this matches.
                const copilotStartupTimeoutMs = providerStartupTimeoutMs(selectedModel, 20000);
                const [acquiredSession, availableModels] = await Promise.all([
                    withTimeout(acquireCopilotSession(sessionId), copilotStartupTimeoutMs, 'Copilot session resume'),
                    getCopilotClient()
                        .then((client) => withTimeout(client.listModels(), 15000, 'Copilot model list'))
                        .catch(() => [] as CopilotModelInfo[]),
                ]);
                session = acquiredSession;
                releasePooledSession = retainCopilotSession(sessionId, acquiredSession);
                if (permissionMode) {
                    await session.rpc.permissions.setMode({ mode: copilotPermissionModeToSdk(permissionMode) });
                }
                for (const model of availableModels)
                    modelsById.set(model.id, model);
                if (!activeContextTier) {
                    const currentModel = await withTimeout(session.rpc.model.getCurrent(), 5000, 'Copilot current model').catch(() => ({ modelId: undefined, contextTier: undefined }));
                    activeContextTier = parseCopilotContextTier(currentModel.contextTier) ?? 'default';
                }
                if (manualPermissions) {
                    setCopilotPermissionHandler(sessionId, createCopilotPermissionBridge(sessionId, safeEnqueue, bridgedPermissionIds, 
                    // Detached turns remain answerable through the process-global
                    // pending map and /running replay. Only a true turn teardown makes
                    // the user unavailable.
                    () => !cleanedUp && (!downstreamClosed || detachOnClientAbort)));
                    manualPermissionHandlerInstalled = true;
                }
                else {
                    setCopilotPermissionHandler(sessionId, approveAll);
                }
                setCopilotElicitationHandler(sessionId, createCopilotElicitationBridge(sessionId, safeEnqueue, bridgedElicitationIds, () => !cleanedUp && (!downstreamClosed || detachOnClientAbort)));
                elicitationHandlerInstalled = true;
                unsubscribe = session.on(handleEvent);
                const historyBaselineCount = await withTimeout(readCopilotHistoryFromSession(session), 5000, 'Copilot history baseline').then((events) => events.length).catch(() => null);
                safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`);
                broadcastLiveSessionTurnStart('copilot', sessionId);
                broadcastedTurnStart = true;
                setRunningSession(sessionId, {
                    provider: 'copilot',
                    requestId: turnRequestId,
                    interrupt: () => session?.abort() ?? Promise.resolve(),
                });
                signal.addEventListener('abort', () => {
                    requestAborted = true;
                    if (detachOnClientAbort) {
                        downstreamClosed = true;
                        // Keep pending permission and elicitation promises alive. They are
                        // replayed by /running and resolved by the reconnecting surface.
                        return;
                    }
                    resolvePendingCopilotPermissions(sessionId, bridgedPermissionIds, { kind: 'user-not-available' });
                    resolvePendingCopilotElicitations(sessionId, bridgedElicitationIds, { action: 'cancel' });
                    void interruptRunningSession(sessionId, turnRequestId).catch(() => { });
                });
                const copilotEffort = effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh'
                    ? effort
                    : undefined;
                if (selectedModel) {
                    await withTimeout(session.setModel(selectedModel, copilotModelOptions({ effort: copilotEffort, contextTier })), providerStartupTimeoutMs(selectedModel, 15000), 'Copilot model switch');
                }
                else if (copilotEffort || contextTier) {
                    const current = await withTimeout(session.rpc.model.getCurrent(), 5000, 'Copilot current model').catch(() => ({ modelId: undefined, contextTier: undefined }));
                    const nextModel = current.modelId;
                    if (nextModel && (copilotEffort || contextTier)) {
                        await withTimeout(session.setModel(nextModel, copilotModelOptions({
                            effort: copilotEffort,
                            contextTier: contextTier ?? parseCopilotContextTier(current.contextTier),
                        })), providerStartupTimeoutMs(nextModel, 15000), 'Copilot model switch');
                    }
                }
                // A user `!command` runs in the session runtime the way the Copilot
                // CLI's bash mode does (the SDK's user-requested shell), rather than
                // reaching the model as prompt text it may or may not choose to run.
                const bangCommand = nativeCommands && parsedAttachments.length === 0 && userMessage.trim().startsWith('!')
                    ? userMessage.trim().slice(1).trim()
                    : null;
                const shellRpc = (session.rpc as typeof session.rpc & {
                    shell?: {
                        executeUserRequested?: (params: {
                            requestId: string;
                            command: string;
                        }) => Promise<{
                            success: boolean;
                            output: string;
                            exitCode?: number | null;
                            error?: string;
                        }>;
                    };
                }).shell;
                if (bangCommand && shellRpc?.executeUserRequested) {
                    const result = await shellRpc.executeUserRequested({ requestId: turnRequestId ?? globalThis.crypto.randomUUID(), command: bangCommand });
                    const status = result.error ?? (result.exitCode != null && result.exitCode !== 0 ? `Exit code ${result.exitCode}` : '');
                    safeEnqueue(`event: bash-output\ndata: ${JSON.stringify({ command: bangCommand, stdout: result.output ?? '', stderr: result.success ? '' : status })}\n\n`);
                    return;
                }
                let promptToSend = composerPrompt;
                const slashCommand = nativeCommands && parsedAttachments.length === 0
                    ? parseOpenCodeSlashCommand(userMessage)
                    : null;
                if (slashCommand) {
                    const commandName = slashCommand.command.toLowerCase();
                    if (commandName === 'help') {
                        safeEnqueue(copilotCommandResultEvent({
                            message: 'Copilot commands: /mode [interactive|plan|autopilot|shell], /model [model].',
                        }));
                        return;
                    }
                    if (commandName === 'mode') {
                        const requestedMode = parseCopilotMode(slashCommand.arguments.split(/\s+/)[0]);
                        if (!requestedMode) {
                            const currentMode = await withTimeout(session.rpc.mode.get(), 5000, 'Copilot mode read').catch(() => 'interactive');
                            const parsedCurrentMode = parseCopilotModeResponse(currentMode) ?? 'interactive';
                            safeEnqueue(copilotCommandResultEvent({
                                message: `Copilot mode is ${parsedCurrentMode}. Use /mode interactive, /mode plan, /mode autopilot, or /mode shell.`,
                                mode: parsedCurrentMode,
                            }));
                            return;
                        }
                        if (isCopilotPersistentMode(requestedMode)) {
                            await withTimeout(session.rpc.mode.set({ mode: requestedMode }), 5000, 'Copilot mode switch');
                        }
                        safeEnqueue(copilotCommandResultEvent({
                            message: `Copilot mode set to ${requestedMode}.`,
                            mode: requestedMode,
                        }));
                        return;
                    }
                    if (commandName === 'model') {
                        const requestedModel = slashCommand.arguments.trim();
                        if (!requestedModel) {
                            const current = await withTimeout(session.rpc.model.getCurrent(), 5000, 'Copilot current model').catch(() => ({ modelId: undefined }));
                            safeEnqueue(copilotCommandResultEvent({
                                message: current.modelId ? `Copilot model is ${current.modelId}.` : 'No Copilot model is selected.',
                            }));
                            return;
                        }
                        await withTimeout(session.setModel(requestedModel, copilotModelOptions({ effort: copilotEffort, contextTier })), providerStartupTimeoutMs(requestedModel, 15000), 'Copilot model switch');
                        safeEnqueue(copilotCommandResultEvent({
                            message: `Copilot model set to ${requestedModel}.`,
                        }));
                        return;
                    }
                    const commandsRpc = (session.rpc as typeof session.rpc & {
                        commands?: typeof session.rpc.commands & {
                            invoke?: (params: {
                                name: string;
                                input?: string;
                            }) => Promise<unknown>;
                        };
                    }).commands;
                    if (commandsRpc?.invoke) {
                        let result: unknown;
                        try {
                            result = await withTimeout(commandsRpc.invoke({
                                name: slashCommand.command,
                                input: slashCommand.arguments || undefined,
                            }), 10000, 'Copilot slash command');
                        }
                        catch (err) {
                            // The CLI refuses a command it does not have ("Unknown slash
                            // command: /x") or cannot run now (/share before a sync). That is
                            // the command's answer, not a broken session: handled as an
                            // error it evicted the warm session and put the text back in the
                            // composer, where the next command was typed in front of it.
                            const message = (err instanceof Error ? err.message : String(err))
                                .replace(/^Request session\.commands\.invoke failed with message:\s*/, '');
                            // A command that starts work of its own (/fleet with no prompt)
                            // can outlast the wait; it is still running, not failed.
                            safeEnqueue(copilotCommandResultEvent({
                                message: /timed out/i.test(message)
                                    ? `/${slashCommand.command} is still running in Copilot; its output will appear as it lands.`
                                    : message,
                            }));
                            return;
                        }
                        const resultRecord = result && typeof result === 'object' && !Array.isArray(result)
                            ? result as unknown as Record<string, unknown>
                            : null;
                        if (resultRecord?.kind === 'agent-prompt' && typeof resultRecord.prompt === 'string') {
                            const mode = parseCopilotMode(resultRecord.mode);
                            if (mode)
                                turnAgentMode = mode;
                            promptToSend = resultRecord.prompt;
                        }
                        else if (resultRecord?.kind === 'text' && typeof resultRecord.text === 'string') {
                            safeEnqueue(copilotCommandResultEvent({
                                message: resultRecord.text,
                            }));
                            return;
                        }
                        else if (resultRecord?.kind === 'completed') {
                            safeEnqueue(copilotCommandResultEvent({
                                message: typeof resultRecord.message === 'string' && resultRecord.message.trim()
                                    ? resultRecord.message
                                    : `/${slashCommand.command} completed.`,
                                ...(parseCopilotMode(resultRecord.mode) ? { mode: parseCopilotMode(resultRecord.mode) } : {}),
                            }));
                            return;
                        }
                        else if (resultRecord?.kind === 'select-subcommand') {
                            const options = Array.isArray(resultRecord.options)
                                ? resultRecord.options as Array<{
                                    name?: string;
                                    description?: string;
                                }>
                                : [];
                            safeEnqueue(copilotCommandResultEvent({
                                message: [
                                    `${typeof resultRecord.title === 'string' ? resultRecord.title : `/${slashCommand.command}`}:`,
                                    ...options.map((option) => `  /${slashCommand.command} ${option.name ?? ''}${option.description ? ` — ${option.description}` : ''}`),
                                ].join('\n'),
                            }));
                            return;
                        }
                        else if (resultRecord?.kind === 'add-timeline-entry') {
                            const entry = resultRecord.entry as {
                                text?: string;
                                url?: string;
                            } | undefined;
                            safeEnqueue(copilotCommandResultEvent({
                                message: [entry?.text, entry?.url].filter(Boolean).join('\n') || `/${slashCommand.command} completed.`,
                                ...(typeof resultRecord.prefillInput === 'string' ? { prefillInput: resultRecord.prefillInput } : {}),
                            }));
                            return;
                        }
                        else if (resultRecord?.kind === 'show-dialog') {
                            // The only dialog is the model picker; the composer has its own.
                            safeEnqueue(copilotCommandResultEvent({ message: '', openModelPicker: true }));
                            return;
                        }
                        else if (resultRecord?.kind === 'set-model' && typeof resultRecord.model === 'string') {
                            await withTimeout(session.setModel(resultRecord.model, copilotModelOptions({ effort: copilotEffort, contextTier })), providerStartupTimeoutMs(resultRecord.model, 15000), 'Copilot model switch');
                            safeEnqueue(copilotCommandResultEvent({
                                message: [`Copilot model set to ${resultRecord.model}.`, resultRecord.warning].filter((part) => typeof part === 'string' && part).join(' '),
                                model: resultRecord.model,
                            }));
                            return;
                        }
                        else if (resultRecord?.kind === 'set-plan-model') {
                            safeEnqueue(copilotCommandResultEvent({
                                message: typeof resultRecord.message === 'string' ? resultRecord.message : 'Plan model updated.',
                            }));
                            return;
                        }
                    }
                }
                armTurnInactivityTimeout();
                const messageOptions: CopilotSendMessageOptions = {
                    prompt: promptToSend,
                    attachments: attachments.length > 0 ? attachments : undefined,
                };
                if (turnAgentMode)
                    messageOptions.agentMode = turnAgentMode;
                await session.send(messageOptions as CopilotMessageOptions);
                safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId, provider: 'copilot' })}\n\n`);
                // The initial send has now been accepted, so follow-up text can safely
                // use Copilot's immediate delivery mode to interject in this same run.
                // Registering this only after the first send avoids a rapid second tab
                // accidentally starting the session while model/mode setup is pending.
                setRunningSession(sessionId, {
                    provider: 'copilot',
                    requestId: turnRequestId,
                    interrupt: () => session?.abort() ?? Promise.resolve(),
                    steer: (text) => steerCopilotSession(session!, text),
                });
                const historyCompletion = historyBaselineCount == null
                    ? new Promise<never>(() => { })
                    : (async () => {
                        while (!historyPollCancelled && !cleanedUp) {
                            await sleep(1000);
                            if (historyPollCancelled || cleanedUp || !session)
                                return;
                            const events = await withTimeout(readCopilotHistoryFromSession(session), 5000, 'Copilot history poll').catch(() => null);
                            if (!events)
                                continue;
                            const finalMessage = findCopilotHistoryCompletion(events, historyBaselineCount, turnAgentMode !== 'autopilot');
                            if (!finalMessage)
                                continue;
                            if (!streamedAssistantMessageIds.has(finalMessage.data.messageId)) {
                                broadcastLiveSessionActivity('copilot', sessionId);
                                safeEnqueue(`data: ${formatCopilotEvent(finalMessage)}\n\n`);
                            }
                            return;
                        }
                    })();
                await Promise.race([turnComplete, historyCompletion]);
            }
            catch (err) {
                if (!emittedError && !requestAborted) {
                    safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`);
                }
                // If the session itself is hosed, evict so the next send reconnects.
                await evictCopilotSession(sessionId).catch(() => { });
            }
            finally {
                if (turnTimeoutTimer != null) {
                    clearTimeout(turnTimeoutTimer);
                    turnTimeoutTimer = null;
                }
                historyPollCancelled = true;
                clearFinalMessageFallback();
                resolvePendingCopilotPermissions(sessionId, bridgedPermissionIds, { kind: 'user-not-available' });
                resolvePendingCopilotElicitations(sessionId, bridgedElicitationIds, { action: 'cancel' });
                if (manualPermissionHandlerInstalled) {
                    setCopilotPermissionHandler(sessionId, approveAll);
                }
                if (elicitationHandlerInstalled) {
                    setCopilotElicitationHandler(sessionId, () => ({ action: 'decline' }));
                }
                clearRunningSession(sessionId, turnRequestId);
                try {
                    unsubscribe?.();
                }
                catch { /* ignore */ }
                // The turn has ended; whatever it left running in the background
                // decides whether the session is idle or waiting.
                if (session)
                    void refreshCopilotBackgroundTasks(sessionId, session);
                releasePooledSession?.();
                // Do NOT evict the warm session on a clean turn completion. Evicting
                // here disconnects the JSON-RPC session and forces a full resumeSession
                // (up to a 20s timeout) on the very next send, defeating the warm pool
                // for back-to-back turns. Rely on the 5-min TTL; the catch{} branch
                // above still evicts when the session is genuinely hosed.
                if (broadcastedTurnStart) {
                    broadcastLiveSessionTurnEnd('copilot', sessionId);
                    scheduleCopilotLiveTranscriptCleanup(sessionId);
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
    const provider = "copilot";
    {
        if (params.isPending)
            return;
        await withTimeout(acquireCopilotSession(params.sessionId), providerStartupTimeoutMs(params.model), 'Copilot session prewarm');
        return;
    }
}
/** Existing SDK dispatch, reached only through bundled extension runtime entries. */
export async function streamTurn(params: SendMessageParams, checkpoint?: Promise<TurnCheckpoint | null>): Promise<Response> {
    const provider = "copilot";
    // Other providers don't yet have that explicit submission boundary — keep
    // the original blocking ordering for them until they gain one.
    await checkpoint?.catch(() => null);
    {
        return createCopilotStream(params.sessionId, params.signal, params.body);
    }
}
export async function forkSession({ sessionId, body, provider }: ForkParams): Promise<{
    sessionId: string;
}> {
    const resolvedProvider = "copilot";
    {
        void sessionId;
        void body;
        throw new Error('Fork is not supported for GitHub Copilot sessions');
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
    const provider = "copilot";
    const resolvedCwd = (cwd && cwd.trim()) ? cwd : process.cwd();
    {
        const client = await getCopilotClient();
        const { approveAll } = await import('@github/copilot-sdk');
        const session = await client.createSession({
            workingDirectory: resolvedCwd,
            onPermissionRequest: approveAll,
            ...copilotSessionConfigOverrides(),
        });
        return { sessionId: session.sessionId, provider: "copilot", cwd: resolvedCwd, isPending: false };
    }
}
/** Release provider-side resources for an active session without deleting its durable history. */
export async function closeSession(sessionId: string, providerOverride?: AgentProvider): Promise<void> {
    const provider = "copilot";
    {
        await evictCopilotSession(sessionId).catch(() => { });
        return;
    }
}
export function listPendingPermissions(sessionId: string, provider?: AgentProvider): Record<string, unknown>[] {
    {
        const prefix = `${sessionId}:`;
        return [
            ...Array.from(pendingCopilotPermissions)
                .filter(([key]) => key.startsWith(prefix))
                .map(([, pending]) => pending.requestPayload),
            ...Array.from(pendingCopilotElicitations)
                .filter(([key]) => key.startsWith(prefix))
                .map(([, pending]) => pending.requestPayload),
        ];
    }
}
/** Process-local control-plane state for fleet and attention clients. */
export async function rewindSession({ sessionId, body, provider }: RewindParams): Promise<Record<string, unknown>> {
    const resolvedProvider = "copilot";
    {
        const userMessageId = typeof body.userMessageId === 'string' ? body.userMessageId : undefined;
        if (!userMessageId)
            throw new Error('userMessageId is required');
        const session = await acquireCopilotSession(sessionId);
        const releaseSession = retainCopilotSession(sessionId, session);
        try {
            const result = await rewindCopilotSessionFiles(session, userMessageId, Boolean(body.dryRun));
            if (!body.dryRun && result.canRewind)
                clearCopilotLiveTranscript(sessionId);
            return result;
        }
        finally {
            releaseSession();
        }
    }
}
export function readMemoryDiagnostics(): Record<string, number> {
    return {
        pendingCopilotPermissions: pendingCopilotPermissions.size,
        pendingCopilotElicitations: pendingCopilotElicitations.size,
        copilotPool: copilotPoolSize()
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
