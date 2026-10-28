// Provider architecture extraction: SDK behavior preserved from the session backend.
import { parseQuestionAnswers, commandResultEvent, createTurnUsageReporter, parseAttachments, parseEffort, parseTurnRequestId } from '../runtimeCore'
import { steerViewSession } from '../../../sessionSteering'
import { listPendingProviderPermissionPayloads } from '../../../sessionControlPlane'
import { coordinatorPermissionToken } from "../../../coordinatorNativePermission";
import { extractPendingPermissions } from "../../../permissions";
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { broadcastLiveSessionActivity, broadcastLiveSessionTurnEnd, broadcastLiveSessionTurnStart } from "../../../liveSessionHarness";
import { withTimeout } from "../../../withTimeout";
import { providerStartupTimeoutMs } from "../../../providerWarmup";
import { PI_THINKING_LEVELS } from "../../../piComposer";
import { schedulePiLiveTranscriptCleanup, recordPiLiveBashMessage, recordPiLiveTranscriptEvent } from "../../../liveTranscripts";
import { PendingRequestGoneError } from "../../../pendingRequestGone";
import { clearRunningSession, getRunningSession, interruptRunningSession, setRunningSession } from "../../../sessionRuntime";
import type { TurnCheckpoint } from "../../../checkpoints";
import { appendPortableComposerContext, assertComposerAttachmentsSupported, planComposerAttachments, resolveLocalComposerAttachmentPath } from "../../../composerAttachments";
import type { AgentProvider, SendAttachment, ReasoningEffortLevel } from "../../../types";
import type { DynamicToolSpec } from "../../../codex-schema/v2";
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core';
import { beginPiSessionOperation, compactPiSession, createPiAgentSession, evictPiAgentSession, forkPiSession, markPiAgentSessionUsed, openPiAgentSession, piPoolSize, piSessionEntryCacheDiagnostics, piSessionOperationCount, setPiSessionName } from "../../../piClient";
import { cancelPendingPiUiRequests, createPiUiBridge, ensurePiExtensionUiBound, installPiUiHandler, listPendingPiUiPayloads, pendingPiUiRequestCount, respondPiUiPermission, respondPiUiQuestion, type PiUiHandler } from "../../../piExtensionUi";
import { decodePiModelValue } from "../../../piMapper";
import { reducePiTurnLifecycle } from "../../../piTurnLifecycle";
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
export function attachmentName(attachment: SendAttachment): string {
    const path = attachmentPath(attachment);
    if (attachment.type === 'agent') {
        const textName = attachment.text?.trim().replace(/^@/, '');
        return attachment.displayName || textName || path || 'agent';
    }
    return attachment.displayName || (path ? basename(path) : attachment.type);
}
export function isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
}
export function inferMimeType(path: string | undefined, fallback = 'application/octet-stream'): string {
    const extension = extname(path ?? '').toLowerCase();
    if (extension === '.jpg' || extension === '.jpeg')
        return 'image/jpeg';
    if (extension === '.png')
        return 'image/png';
    if (extension === '.gif')
        return 'image/gif';
    if (extension === '.webp')
        return 'image/webp';
    if (extension === '.svg')
        return 'image/svg+xml';
    if (extension === '.json')
        return 'application/json';
    if (extension === '.md' || extension === '.markdown')
        return 'text/markdown';
    if (extension === '.txt' || extension === '.log')
        return 'text/plain';
    if (extension === '.ts' || extension === '.tsx' || extension === '.js' || extension === '.jsx' || extension === '.css' || extension === '.html')
        return 'text/plain';
    return fallback;
}
export async function readLocalImageAttachment(attachment: SendAttachment, cwd?: string): Promise<{
    data: string;
    mimeType: string;
    name: string;
} | null> {
    if (attachment.type !== 'image' && attachment.mimeType?.startsWith('image/') !== true)
        return null;
    if (attachment.type === 'blob' && attachment.data && attachment.mimeType) {
        return { data: attachment.data, mimeType: attachment.mimeType, name: attachmentName(attachment) };
    }
    const path = attachmentPath(attachment);
    if (!path || isHttpUrl(path))
        return null;
    const mimeType = attachment.mimeType || inferMimeType(path);
    const data = await readFile(resolveLocalComposerAttachmentPath(path, cwd), 'base64');
    return { data, mimeType, name: attachmentName(attachment) };
}
export async function buildPiImages(attachments: SendAttachment[], cwd?: string): Promise<Array<{
    type: 'image';
    data: string;
    mimeType: string;
}>> {
    const images: Array<{
        type: 'image';
        data: string;
        mimeType: string;
    }> = [];
    for (const attachment of attachments) {
        const image = await readLocalImageAttachment(attachment, cwd);
        if (image)
            images.push({ type: 'image', data: image.data, mimeType: image.mimeType });
    }
    return images;
}
export function parsePiDirectShell(message: string): {
    command: string;
    excludeFromContext: boolean;
} | null {
    const trimmed = message.trim();
    if (!trimmed.startsWith('!'))
        return null;
    const excludeFromContext = trimmed.startsWith('!!');
    const command = trimmed.slice(excludeFromContext ? 2 : 1).trim();
    return { command, excludeFromContext };
}
export function findPiModelByReference(modelReference: string, models: readonly {
    provider: string;
    id: string;
}[]): {
    provider: string;
    id: string;
} | undefined {
    const trimmed = modelReference.trim();
    if (!trimmed)
        return undefined;
    const normalized = trimmed.toLowerCase();
    const canonicalMatches = models.filter((model) => `${model.provider}/${model.id}`.toLowerCase() === normalized);
    if (canonicalMatches.length === 1)
        return canonicalMatches[0];
    if (canonicalMatches.length > 1)
        return undefined;
    const slashIndex = trimmed.indexOf('/');
    if (slashIndex !== -1) {
        const provider = trimmed.slice(0, slashIndex).trim().toLowerCase();
        const modelId = trimmed.slice(slashIndex + 1).trim().toLowerCase();
        if (provider && modelId) {
            const providerMatches = models.filter((model) => model.provider.toLowerCase() === provider && model.id.toLowerCase() === modelId);
            if (providerMatches.length === 1)
                return providerMatches[0];
            if (providerMatches.length > 1)
                return undefined;
        }
    }
    const idMatches = models.filter((model) => model.id.toLowerCase() === normalized);
    return idMatches.length === 1 ? idMatches[0] : undefined;
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
    const resolvedProvider = "pi";
    const action = typeof body.action === 'string' ? body.action : '';
    // Guard again after provider resolution/pool awaits. Remote confirmation
    // cannot fall through to a different session's similarly named request.
    if ((action === 'respondPermission' || action === 'respondQuestion') && typeof body.expectedPermissionToken === 'string') {
        const pending = extractPendingPermissions(listPendingProviderPermissionPayloads(sessionId, "pi"), { sessionId, provider: "pi" });
        if (!pending.some(permission => permission.id === body.permissionId && coordinatorPermissionToken(permission) === body.expectedPermissionToken)) {
            throw new PendingRequestGoneError(action === 'respondQuestion' ? 'Question' : 'Permission request');
        }
    }
    // Provider-agnostic: deliver a user message into the running turn (native
    // steering). `delivered: false` means no running turn / no steer primitive /
    // the turn ended while the request was in flight — callers fall back to
    // queueing the message for the next turn.
    if (action === 'steer') {
        return steerViewSession(sessionId, body, "pi");
    }
    {
        if (action === 'respondPermission') {
            const permissionId = typeof body.permissionId === 'string' ? body.permissionId : '';
            if (!permissionId)
                throw new Error('permissionId is required');
            const response = body.response;
            if (response !== 'once' && response !== 'always' && response !== 'reject') {
                throw new Error('response must be once, always, or reject');
            }
            respondPiUiPermission(sessionId, permissionId, response);
            return { ok: true };
        }
        if (action === 'respondQuestion') {
            const permissionId = typeof body.permissionId === 'string' ? body.permissionId : '';
            if (!permissionId)
                throw new Error('permissionId is required');
            const answers = parseQuestionAnswers(body.answers);
            if (!answers)
                throw new Error('answers is required');
            respondPiUiQuestion(sessionId, permissionId, answers);
            return { ok: true };
        }
        if (action === 'summarize') {
            await compactPiSession(sessionId);
            return { ok: true };
        }
    }
    throw new Error(`Action ${action || '(missing)'} is not supported for ${"pi"} sessions`);
}
export async function createPiStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
    const userMessage = String(body.message ?? '').trim();
    const turnRequestId = parseTurnRequestId(body);
    const isPendingSession = Boolean(body.isPendingSession);
    const cwdOverride = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined;
    const selectedModel = decodePiModelValue(typeof body.model === 'string' ? body.model : null);
    const effort = parseEffort(body);
    const attachments = parseAttachments(body);
    const attachmentPlan = planComposerAttachments('pi', attachments);
    assertComposerAttachmentsSupported('pi', attachmentPlan);
    const directShell = parsePiDirectShell(userMessage);
    const detachOnClientAbort = body.detachOnClientAbort === true;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            let cleanedUp = false;
            let downstreamClosed = false;
            let requestAborted = false;
            let broadcastedTurnStart = false;
            let targetSessionId = sessionId;
            let unsubscribePi: (() => void) | undefined;
            let turnOutputTokens = 0;
            // safeEnqueue is declared further down this stream body; the arrow defers
            // the lookup so the reporter can live beside the counter it reports.
            const reportTurnUsage = createTurnUsageReporter((chunk) => safeEnqueue(chunk));
            const activePiUiIds = new Set<string>();
            let piUiHandler: PiUiHandler | undefined;
            let clearPiUiHandler: (() => void) | undefined;
            let piTurnTerminalError: string | undefined;
            let releasePiOperation: (() => void) | undefined;
            let interruptOnAbort: (() => void) | undefined;
            const onAbort = () => {
                requestAborted = true;
                if (detachOnClientAbort) {
                    downstreamClosed = true;
                    return;
                }
                interruptOnAbort?.();
            };
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted)
                onAbort();
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
            // Commit the response before a cold AgentSession open/resource reload.
            safeEnqueue(':ok\n\n');
            const close = () => {
                if (cleanedUp)
                    return;
                cleanedUp = true;
                markPiAgentSessionUsed(targetSessionId);
                cancelPendingPiUiRequests(targetSessionId, activePiUiIds);
                clearPiUiHandler?.();
                releasePiOperation?.();
                signal.removeEventListener('abort', onAbort);
                flushPendingPiDelta();
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
            // Pi's AssistantMessageEvent stream emits one text_delta/thinking_delta/
            // toolcall_delta per chunk, each embedding the full cumulative `partial`
            // AssistantMessage — so forwarding every one verbatim resends the whole
            // in-progress message on every chunk (O(n^2) bytes for an n-length
            // reply). Nothing on the client reads `.partial` off these sub-events
            // (only `.delta`/`.type`/`.message`), so it's dropped entirely, and
            // consecutive deltas of the same kind/contentIndex are merged into one
            // SSE frame, spilling early past PI_DELTA_SPILL_CHARS so a long
            // uninterrupted stream still flushes periodically. Any other event is
            // an interaction boundary and flushes the pending delta first.
            const PI_DELTA_SPILL_CHARS = 4000;
            // Without a timed flush a prose-only reply showed nothing until it ended
            // (one update at 3.9s, the rest at 11.3s) — see DELTA_FLUSH_MS for Codex.
            const PI_DELTA_FLUSH_MS = 40;
            const PI_DELTA_SUBTYPES = new Set(['text_delta', 'thinking_delta', 'toolcall_delta']);
            let pendingPiDelta: {
                type: 'message_update';
                message: PiAgentMessage;
                assistantMessageEvent: Record<string, unknown>;
            } | null = null;
            let piDeltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
            const flushPendingPiDelta = () => {
                if (piDeltaFlushTimer) {
                    clearTimeout(piDeltaFlushTimer);
                    piDeltaFlushTimer = null;
                }
                if (!pendingPiDelta)
                    return;
                const event = pendingPiDelta;
                pendingPiDelta = null;
                safeEnqueue(`data: ${JSON.stringify({ type: 'pi_event', event })}\n\n`);
            };
            const emitPiEvent = (event: PiAgentEvent) => {
                if (event.type !== 'message_update') {
                    flushPendingPiDelta();
                    safeEnqueue(`data: ${JSON.stringify({ type: 'pi_event', event })}\n\n`);
                    return;
                }
                // Strip `.partial` off every sub-event, not just deltas — it's never
                // read client-side and duplicating the whole in-progress message on
                // every start/end frame is wasted bandwidth too.
                const { partial: _partial, ...lightSubEvent } = event.assistantMessageEvent as Record<string, unknown> & {
                    partial?: unknown;
                };
                const subType = lightSubEvent.type;
                if (typeof subType !== 'string' || !PI_DELTA_SUBTYPES.has(subType) || typeof lightSubEvent.delta !== 'string') {
                    flushPendingPiDelta();
                    safeEnqueue(`data: ${JSON.stringify({ type: 'pi_event', event: { ...event, assistantMessageEvent: lightSubEvent } })}\n\n`);
                    return;
                }
                const pendingSub = pendingPiDelta?.assistantMessageEvent;
                if (!pendingPiDelta || pendingSub?.type !== subType || pendingSub?.contentIndex !== lightSubEvent.contentIndex) {
                    flushPendingPiDelta();
                    pendingPiDelta = { type: 'message_update', message: event.message, assistantMessageEvent: lightSubEvent };
                    piDeltaFlushTimer ??= setTimeout(flushPendingPiDelta, PI_DELTA_FLUSH_MS);
                    return;
                }
                const mergedDelta = `${String(pendingSub.delta ?? '')}${lightSubEvent.delta}`;
                const merged = { type: 'message_update' as const, message: event.message, assistantMessageEvent: { ...lightSubEvent, delta: mergedDelta } };
                if (mergedDelta.length >= PI_DELTA_SPILL_CHARS) {
                    pendingPiDelta = merged;
                    flushPendingPiDelta();
                    return;
                }
                pendingPiDelta = merged;
                piDeltaFlushTimer ??= setTimeout(flushPendingPiDelta, PI_DELTA_FLUSH_MS);
            };
            try {
                releasePiOperation = beginPiSessionOperation(sessionId, 'turn');
                const agentSession = isPendingSession
                    ? await createPiAgentSession(cwdOverride ?? process.cwd(), { id: sessionId })
                    : await openPiAgentSession(sessionId);
                targetSessionId = agentSession.sessionId;
                // The warm Pi session is single-turn: a concurrent send (another tab, a
                // rapid double-fire) would otherwise hit the raw SDK "Agent is already
                // processing" throw after we'd already mutated model/thinking state.
                // Detect it up front and surface a clear message instead — the catch
                // below turns this into a tidy error frame and closes cleanly.
                if (agentSession.isStreaming) {
                    throw new Error('Pi is still finishing the previous message. Wait for it to complete before sending another.');
                }
                // Claim the session before any async model/image/extension setup. Two
                // tabs can otherwise both pass isStreaming while Pi is still idle and
                // race into prompt(), with the later stream stealing the UI bridge.
                // The registry check + set are synchronous, so this closes that window.
                if (getRunningSession(sessionId)) {
                    throw new Error('Pi is already preparing or running another message for this session.');
                }
                setRunningSession(sessionId, {
                    provider: 'pi',
                    requestId: turnRequestId,
                    interrupt: () => agentSession.abort(),
                    steer: (text) => agentSession.steer(text),
                });
                interruptOnAbort = () => { void interruptRunningSession(sessionId, turnRequestId).catch(() => { }); };
                if (requestAborted && !detachOnClientAbort) {
                    throw new Error('Pi request aborted before the turn started.');
                }
                if (selectedModel) {
                    const model = agentSession.modelRuntime.getModel(selectedModel.providerID, selectedModel.modelID);
                    if (!model) {
                        throw new Error(`Pi model not found: ${selectedModel.providerID}/${selectedModel.modelID}`);
                    }
                    if (agentSession.model?.provider !== selectedModel.providerID || agentSession.model?.id !== selectedModel.modelID) {
                        await withTimeout(agentSession.setModel(model), providerStartupTimeoutMs(`${selectedModel.providerID}/${selectedModel.modelID}`), 'Pi model switch');
                    }
                }
                if (effort && PI_THINKING_LEVELS.includes(effort as typeof PI_THINKING_LEVELS[number])) {
                    agentSession.setThinkingLevel(effort as typeof PI_THINKING_LEVELS[number]);
                }
                const images = await buildPiImages(attachmentPlan.native, cwdOverride);
                safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId: targetSessionId })}\n\n`);
                broadcastLiveSessionTurnStart('pi', targetSessionId);
                broadcastedTurnStart = true;
                // Execute native Pi slash commands instead of sending them as prompt text.
                const piSlash = !directShell && attachments.length === 0 ? parseOpenCodeSlashCommand(userMessage) : null;
                const finishPiCommand = (message: string) => {
                    safeEnqueue(commandResultEvent('pi', { message, transcriptExpected: false }));
                    clearRunningSession(sessionId, turnRequestId);
                    broadcastLiveSessionTurnEnd('pi', targetSessionId);
                    schedulePiLiveTranscriptCleanup(targetSessionId);
                    close();
                };
                if (piSlash && piSlash.command.toLowerCase() === 'help') {
                    finishPiCommand('Pi commands: /model [provider/model], /thinking [off|minimal|low|medium|high|xhigh|max], /compact [instructions], /name <name>, /session, /reload.');
                    return;
                }
                if (piSlash && piSlash.command.toLowerCase() === 'model') {
                    const requestedModel = piSlash.arguments.trim();
                    if (!requestedModel) {
                        finishPiCommand(agentSession.model
                            ? `Pi model is ${agentSession.model.provider}/${agentSession.model.id}.`
                            : 'No Pi model is selected.');
                        return;
                    }
                    const scopedModels = agentSession.scopedModels.map((entry) => entry.model);
                    const availableModels = scopedModels.length > 0
                        ? scopedModels
                        : await agentSession.modelRuntime.getAvailable();
                    const modelRef = findPiModelByReference(requestedModel, availableModels);
                    if (!modelRef) {
                        finishPiCommand(`Pi model not found or ambiguous: ${requestedModel}.`);
                        return;
                    }
                    const model = agentSession.modelRuntime.getModel(modelRef.provider, modelRef.id);
                    if (!model) {
                        finishPiCommand(`Pi model not found: ${modelRef.provider}/${modelRef.id}.`);
                        return;
                    }
                    await agentSession.setModel(model);
                    finishPiCommand(`Pi model set to ${model.provider}/${model.id}.`);
                    return;
                }
                if (piSlash && piSlash.command.toLowerCase() === 'thinking') {
                    const level = piSlash.arguments.trim();
                    if (!level) {
                        finishPiCommand(`Pi thinking level is ${agentSession.thinkingLevel}.`);
                        return;
                    }
                    if (!PI_THINKING_LEVELS.includes(level as typeof PI_THINKING_LEVELS[number])) {
                        finishPiCommand('Use /thinking off, /thinking minimal, /thinking low, /thinking medium, /thinking high, /thinking xhigh, or /thinking max.');
                        return;
                    }
                    agentSession.setThinkingLevel(level as typeof PI_THINKING_LEVELS[number]);
                    finishPiCommand(`Pi thinking level set to ${level}.`);
                    return;
                }
                if (piSlash && piSlash.command.toLowerCase() === 'compact') {
                    setRunningSession(sessionId, {
                        provider: 'pi',
                        requestId: turnRequestId,
                        interrupt: () => agentSession.abort(),
                    });
                    safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'compaction_start', reason: 'manual' })}\n\n`);
                    try {
                        await agentSession.compact(piSlash.arguments || undefined);
                        safeEnqueue(commandResultEvent('pi', { message: 'Compacted the conversation.' }));
                    }
                    finally {
                        safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'compaction_end', reason: 'manual' })}\n\n`);
                        clearRunningSession(sessionId, turnRequestId);
                        broadcastLiveSessionTurnEnd('pi', targetSessionId);
                        schedulePiLiveTranscriptCleanup(targetSessionId);
                        close();
                    }
                    return;
                }
                if (piSlash && piSlash.command.toLowerCase() === 'name') {
                    const name = piSlash.arguments.trim();
                    if (!name) {
                        finishPiCommand(agentSession.sessionName
                            ? `Pi session name is "${agentSession.sessionName}".`
                            : 'This Pi session has no display name.');
                        return;
                    }
                    await setPiSessionName(sessionId, name);
                    finishPiCommand(`Pi session named "${name}".`);
                    return;
                }
                if (piSlash && piSlash.command.toLowerCase() === 'session') {
                    const stats = agentSession.getSessionStats();
                    const contextUsage = stats.contextUsage;
                    const contextTokens = contextUsage?.tokens ?? 0;
                    const contextWindow = contextUsage?.contextWindow ?? 0;
                    const contextPercent = contextUsage?.percent
                        ?? (contextWindow > 0 ? contextTokens / contextWindow * 100 : 0);
                    const context = contextUsage
                        ? ` Context: ${contextTokens}/${contextWindow} tokens (${contextPercent.toFixed(1)}%).`
                        : '';
                    finishPiCommand(`Pi session ${stats.sessionId}: ${stats.userMessages} user, ${stats.assistantMessages} assistant, ${stats.toolCalls} tool calls; ${stats.tokens.total} tokens; $${stats.cost.toFixed(4)}.${context}`);
                    return;
                }
                if (piSlash && piSlash.command.toLowerCase() === 'reload') {
                    piUiHandler = createPiUiBridge(targetSessionId, safeEnqueue, activePiUiIds);
                    clearPiUiHandler = installPiUiHandler(targetSessionId, piUiHandler);
                    await ensurePiExtensionUiBound(agentSession, targetSessionId);
                    await agentSession.reload();
                    finishPiCommand('Reloaded Pi extensions, skills, prompts, settings, and context files.');
                    return;
                }
                if (directShell) {
                    if (!directShell.command) {
                        throw new Error('Pi shell command cannot be empty');
                    }
                    if (attachments.length > 0) {
                        throw new Error('Pi shell commands do not support attachments');
                    }
                    setRunningSession(sessionId, {
                        provider: 'pi',
                        requestId: turnRequestId,
                        interrupt: async () => { agentSession.abortBash(); },
                    });
                    let directShellOutput = '';
                    const bashResult = await agentSession.executeBash(directShell.command, (chunk) => {
                        directShellOutput += chunk;
                        recordPiLiveBashMessage(targetSessionId, {
                            command: directShell.command,
                            output: directShellOutput,
                            excludeFromContext: directShell.excludeFromContext,
                        });
                        broadcastLiveSessionActivity('pi', targetSessionId);
                        safeEnqueue(`data: ${JSON.stringify({
                            type: 'pi_bash_delta',
                            command: directShell.command,
                            delta: chunk,
                            excludeFromContext: directShell.excludeFromContext,
                        })}\n\n`);
                    }, {
                        excludeFromContext: directShell.excludeFromContext,
                    });
                    recordPiLiveBashMessage(targetSessionId, {
                        command: directShell.command,
                        output: typeof bashResult.output === 'string' ? bashResult.output : directShellOutput,
                        excludeFromContext: directShell.excludeFromContext,
                        exitCode: typeof bashResult.exitCode === 'number' ? bashResult.exitCode : undefined,
                        cancelled: Boolean(bashResult.cancelled),
                        truncated: Boolean(bashResult.truncated),
                        fullOutputPath: typeof bashResult.fullOutputPath === 'string' ? bashResult.fullOutputPath : undefined,
                    });
                    clearRunningSession(sessionId, turnRequestId);
                    broadcastLiveSessionActivity('pi', targetSessionId);
                    broadcastLiveSessionTurnEnd('pi', targetSessionId);
                    schedulePiLiveTranscriptCleanup(targetSessionId);
                    close();
                    return;
                }
                // Pi extensions use an RPC-style UI contract for select/confirm/input
                // dialogs. Bind a stable dispatcher once per warm AgentSession and aim
                // its current handler at this turn so extension prompts become the same
                // reattachable structured questions used by every other provider. The
                // running entry is installed first because extension session-start hooks
                // can themselves request input before prompt() begins.
                piUiHandler = createPiUiBridge(targetSessionId, safeEnqueue, activePiUiIds);
                clearPiUiHandler = installPiUiHandler(targetSessionId, piUiHandler);
                await ensurePiExtensionUiBound(agentSession, targetSessionId);
                // Subscribe to the AgentSession event stream (not the raw Agent): only
                // AgentSession surfaces willRetry on agent_end plus auto_retry/compaction/
                // queue progress. Subscribing to the raw Agent makes transient,
                // auto-retried errors look fatal (false "Pi turn failed" toast) and closes
                // the stream on the first agent_end — cutting off the retry the user never
                // sees. Native Pi instead shows a quiet "retrying…" and recovers; the
                // later agent_settled event is the only terminal boundary.
                unsubscribePi = agentSession.subscribe((event) => {
                    if (cleanedUp)
                        return;
                    if (event.type === 'agent_start') {
                        safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId: targetSessionId, provider: 'pi' })}\n\n`);
                    }
                    // Session-level progress is not part of the transcript. Surface it as
                    // non-fatal status frames so the composer can show "Retrying…" /
                    // "Compacting…" / the live queue instead of looking hung — never as an
                    // error, and never closing the stream.
                    switch (event.type) {
                        case 'auto_retry_start':
                            safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'retry_start', attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs, message: event.errorMessage })}\n\n`);
                            return;
                        case 'auto_retry_end':
                            safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'retry_end', success: event.success, attempt: event.attempt })}\n\n`);
                            return;
                        case 'summarization_retry_scheduled':
                            safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'summarization_retry_start', attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs, message: event.errorMessage })}\n\n`);
                            return;
                        case 'summarization_retry_attempt_start':
                            return;
                        case 'summarization_retry_finished':
                            safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'summarization_retry_end' })}\n\n`);
                            return;
                        case 'compaction_start':
                            safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'compaction_start', reason: event.reason })}\n\n`);
                            return;
                        case 'compaction_end':
                            safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'compaction_end', reason: event.reason, aborted: event.aborted })}\n\n`);
                            return;
                        case 'queue_update':
                            safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'queue_update', steering: event.steering, followUp: event.followUp })}\n\n`);
                            return;
                        case 'session_info_changed':
                            // Pi auto-titles sessions mid-turn; forward the new name immediately
                            // instead of waiting for the next 5s session-list poll to pick it up.
                            if (event.name) {
                                safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'title_changed', name: event.name })}\n\n`);
                            }
                            return;
                        case 'thinking_level_changed':
                            return;
                        case 'agent_settled': {
                            const lifecycle = reducePiTurnLifecycle(piTurnTerminalError, event);
                            if (lifecycle.terminalError) {
                                safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: lifecycle.terminalError })}\n\n`);
                            }
                            clearRunningSession(sessionId, turnRequestId);
                            unsubscribePi?.();
                            broadcastLiveSessionTurnEnd('pi', targetSessionId);
                            schedulePiLiveTranscriptCleanup(targetSessionId);
                            close();
                            return;
                        }
                        default:
                            break;
                    }
                    // A will-retry agent_end is interim — an auto-retry or auto-compaction
                    // will re-run the agent on the same prompt() call. Suppress it while
                    // the client waits for the authoritative agent_settled event.
                    if (event.type === 'agent_end' && event.willRetry)
                        return;
                    // From here on `event` is a core transcript AgentEvent.
                    const agentEvent = event as PiAgentEvent;
                    recordPiLiveTranscriptEvent(targetSessionId, agentEvent);
                    broadcastLiveSessionActivity('pi', targetSessionId);
                    emitPiEvent(agentEvent);
                    if (event.type === 'message_end' && event.message.role === 'assistant') {
                        turnOutputTokens += Math.max(0, event.message.usage.output);
                        reportTurnUsage(turnOutputTokens);
                    }
                    if (event.type === 'agent_end') {
                        // agent_end is not terminal for AgentSession: extension agent_end
                        // hooks can queue another continuation. Defer close/error delivery
                        // until the authoritative agent_settled event.
                        piTurnTerminalError = reducePiTurnLifecycle(piTurnTerminalError, event).terminalError;
                    }
                });
                const text = appendPortableComposerContext(userMessage, attachmentPlan.portableText);
                await agentSession.prompt(text, images.length > 0 ? { images } : undefined);
                // prompt() resolving means the turn is genuinely over. Normally the
                // agent_settled handler above already ran cleanup + close (and set
                // cleanedUp). But if that event was never delivered to our subscriber,
                // without this backstop the AgentSession subscription would leak and the
                // stream would hang open forever. Guard on cleanedUp so it's a no-op on
                // the happy path.
                if (!cleanedUp) {
                    unsubscribePi?.();
                    clearRunningSession(sessionId, turnRequestId);
                    broadcastLiveSessionTurnEnd('pi', targetSessionId);
                    schedulePiLiveTranscriptCleanup(targetSessionId);
                    close();
                }
            }
            catch (err) {
                unsubscribePi?.();
                if (!requestAborted) {
                    safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`);
                }
                clearRunningSession(sessionId, turnRequestId);
                if (broadcastedTurnStart) {
                    broadcastLiveSessionTurnEnd('pi', targetSessionId);
                    schedulePiLiveTranscriptCleanup(targetSessionId);
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
    const provider = "pi";
    {
        // Pi's cold open is the slowest (~19s) so a pending session is exactly where
        // prewarm pays off. createPiAgentSession is idempotent on the id, so the
        // first send reuses this pooled session instead of recreating it.
        if (params.isPending) {
            await withTimeout(createPiAgentSession(params.cwd ?? process.cwd(), { id: params.sessionId }), providerStartupTimeoutMs(params.model), 'Pi session prewarm');
            return;
        }
        await withTimeout(openPiAgentSession(params.sessionId), providerStartupTimeoutMs(params.model), 'Pi session prewarm');
        return;
    }
}
/** Existing SDK dispatch, reached only through bundled extension runtime entries. */
export async function streamTurn(params: SendMessageParams, checkpoint?: Promise<TurnCheckpoint | null>): Promise<Response> {
    const provider = "pi";
    // Other providers don't yet have that explicit submission boundary — keep
    // the original blocking ordering for them until they gain one.
    await checkpoint?.catch(() => null);
    {
        return createPiStream(params.sessionId, params.signal, params.body);
    }
}
export async function forkSession({ sessionId, body, provider }: ForkParams): Promise<{
    sessionId: string;
}> {
    const resolvedProvider = "pi";
    {
        const entryId = typeof body.upToMessageId === 'string' ? body.upToMessageId : undefined;
        const newId = await forkPiSession(sessionId, entryId);
        if (!newId) {
            throw new Error('Failed to fork Pi session');
        }
        return { sessionId: newId };
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
    const provider = "pi";
    const resolvedCwd = (cwd && cwd.trim()) ? cwd : process.cwd();
    {
        const { randomUUID } = await import('node:crypto');
        return { sessionId: randomUUID(), provider: "pi", cwd: resolvedCwd, isPending: true };
    }
}
/** Release provider-side resources for an active session without deleting its durable history. */
export async function closeSession(sessionId: string, providerOverride?: AgentProvider): Promise<void> {
    const provider = "pi";
    {
        await evictPiAgentSession(sessionId);
        return;
    }
}
export function listPendingPermissions(sessionId: string, provider?: AgentProvider): Record<string, unknown>[] {
    {
        return listPendingPiUiPayloads(sessionId);
    }
}
/** Process-local control-plane state for fleet and attention clients. */
export async function rewindSession({ sessionId, body, provider }: RewindParams): Promise<Record<string, unknown>> {
    const resolvedProvider = "pi";
    {
        void sessionId;
        void body;
        throw new Error('Rewind is not supported for Pi sessions');
    }
}
export function readMemoryDiagnostics(): Record<string, number> {
    const piEntryCache = piSessionEntryCacheDiagnostics();
    return {
        pendingPiUiRequests: pendingPiUiRequestCount(),
        piPool: piPoolSize(),
        piOperations: piSessionOperationCount(),
        piEntryCacheSessions: piEntryCache.sessions,
        piEntryCacheEntries: piEntryCache.entries
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
