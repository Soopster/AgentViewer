// Provider architecture extraction: SDK behavior preserved from the session backend.
import { parseQuestionAnswers, startTurnWatchdog, commandResultEvent, createTurnUsageReporter, parseAttachments, parseTurnRequestId } from '../runtimeCore'
import { steerViewSession } from '../../../sessionSteering'
import { listPendingProviderPermissionPayloads } from '../../../sessionControlPlane'
import { coordinatorPermissionToken } from "../../../coordinatorNativePermission";
import { extractPendingPermissions } from "../../../permissions";
import { basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getCoordinatorOpenCodeToolMask } from '../../../coordinatorProviderBindings'
import { withTimeout } from "../../../withTimeout";
import { providerStartupTimeoutMs } from "../../../providerWarmup";
import { OPENCODE_OPTIONS, getOpenCodeSession, openCodeData } from "../../../opencodeSessions";
import { PendingRequestGoneError } from "../../../pendingRequestGone";
import { clearRunningSession, interruptRunningSession, setRunningSession } from "../../../sessionRuntime";
import type { TurnCheckpoint } from "../../../checkpoints";
import { appendPortableComposerContext, assertComposerAttachmentsSupported, planComposerAttachments, resolveLocalComposerAttachmentPath } from "../../../composerAttachments";
import type { AgentProvider, ContextUsage, SendAttachment, ReasoningEffortLevel } from "../../../types";
import type { DynamicToolSpec } from "../../../codex-schema/v2";
import { getOpenCodeClient, getOpenCodeV2Client } from "../../../opencodeClient";
import { getOpenCodeSessionSnapshot, subscribeToOpenCodeEvents } from "../../../opencodeHarness";
import { decodeOpenCodeModelValue, currentOpenCodeModelValue, mapOpenCodeModelsToSessionModels, mapOpenCodeContextUsage, summarizeOpenCodeDiffs, updateOpenCodeTurnOutputUsage } from "../../../opencodeMapper";
import { openCodeStreamEnvelope, type OpenCodeMessageRole } from "../../../opencodeStreamEvents";
import type { Event as OpenCodeEvent, FileDiff as OpenCodeFileDiff, AgentPartInput as OpenCodeAgentPartInput, FilePartInput as OpenCodeFilePartInput, Session as OpenCodeSession, TextPartInput as OpenCodeTextPartInput } from '@opencode-ai/sdk';
import type { QuestionRequest as OpenCodeQuestionRequest } from '@opencode-ai/sdk/v2';
// OpenCode streams complete on a `session.idle` event. If that event is dropped
// (e.g. the shared harness subscription reconnects across a heartbeat gap), the
// consume loop would otherwise wait forever. After this much total silence the
// watchdog probes session.status to confirm the turn really finished.
export const OPENCODE_WATCHDOG_IDLE_MS = 30000;
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
export function buildOpenCodeParts(userMessage: string, attachments: SendAttachment[], cwd?: string): Array<OpenCodeTextPartInput | OpenCodeFilePartInput | OpenCodeAgentPartInput> {
    const plan = planComposerAttachments('opencode', attachments);
    assertComposerAttachmentsSupported('opencode', plan);
    const text = appendPortableComposerContext(userMessage, plan.portableText);
    const parts: Array<OpenCodeTextPartInput | OpenCodeFilePartInput | OpenCodeAgentPartInput> = [{ type: 'text', text }];
    for (const attachment of plan.native) {
        const path = attachmentPath(attachment);
        if (attachment.type === 'agent') {
            const name = attachmentName(attachment);
            const value = attachment.text?.trim() || `@${name}`;
            parts.push({
                type: 'agent',
                name,
                source: {
                    value,
                    start: 0,
                    end: value.length,
                },
            });
            continue;
        }
        if (attachment.type === 'blob' && attachment.data && attachment.mimeType?.startsWith('image/')) {
            parts.push({
                type: 'file',
                mime: attachment.mimeType,
                filename: attachmentName(attachment),
                url: `data:${attachment.mimeType};base64,${attachment.data}`,
            });
            continue;
        }
        if (!path || (attachment.type !== 'file' && attachment.type !== 'image' && attachment.type !== 'mention'))
            continue;
        const name = attachmentName(attachment);
        const resolved = isHttpUrl(path) ? path : resolveLocalComposerAttachmentPath(path, cwd);
        const label = `@${name}`;
        parts.push({
            type: 'file',
            mime: attachment.mimeType || inferMimeType(path, 'text/plain'),
            filename: name,
            url: isHttpUrl(resolved) ? resolved : pathToFileURL(resolved).toString(),
            source: {
                type: 'file',
                path: resolved,
                text: { value: label, start: 0, end: label.length },
            },
        });
    }
    return parts;
}
export function codexContextUsageToEventData(contextUsage: ContextUsage): string {
    return `event: context-usage\ndata: ${JSON.stringify(contextUsage)}\n\n`;
}
export function formatOpenCodeEvent(event: OpenCodeEvent, messageRoles?: Map<string, OpenCodeMessageRole>): string {
    return JSON.stringify(openCodeStreamEnvelope(event, messageRoles));
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
    const resolvedProvider = "opencode";
    const action = typeof body.action === 'string' ? body.action : '';
    // Guard again after provider resolution/pool awaits. Remote confirmation
    // cannot fall through to a different session's similarly named request.
    if ((action === 'respondPermission' || action === 'respondQuestion') && typeof body.expectedPermissionToken === 'string') {
        const pending = extractPendingPermissions(listPendingProviderPermissionPayloads(sessionId, "opencode"), { sessionId, provider: "opencode" });
        if (!pending.some(permission => permission.id === body.permissionId && coordinatorPermissionToken(permission) === body.expectedPermissionToken)) {
            throw new PendingRequestGoneError(action === 'respondQuestion' ? 'Question' : 'Permission request');
        }
    }
    // Provider-agnostic: deliver a user message into the running turn (native
    // steering). `delivered: false` means no running turn / no steer primitive /
    // the turn ended while the request was in flight — callers fall back to
    // queueing the message for the next turn.
    if (action === 'steer') {
        return steerViewSession(sessionId, body, "opencode");
    }
    {
        const client = await getOpenCodeClient();
        if (action === 'share') {
            const response = await client.session.share({
                ...OPENCODE_OPTIONS,
                path: { id: sessionId },
            });
            return { session: openCodeData<OpenCodeSession>(response) };
        }
        if (action === 'unshare') {
            await client.session.unshare({
                ...OPENCODE_OPTIONS,
                path: { id: sessionId },
            });
            return { ok: true };
        }
        if (action === 'summarize') {
            const response = await client.session.summarize({
                ...OPENCODE_OPTIONS,
                path: { id: sessionId },
            });
            return { ok: openCodeData<boolean>(response) };
        }
        if (action === 'unrevert') {
            const response = await client.session.unrevert({
                ...OPENCODE_OPTIONS,
                path: { id: sessionId },
            });
            return { session: openCodeData<OpenCodeSession>(response) };
        }
        if (action === 'respondPermission') {
            const permissionID = typeof body.permissionId === 'string' ? body.permissionId : '';
            const response = typeof body.response === 'string' ? body.response : '';
            if (!permissionID)
                throw new Error('permissionId is required');
            if (response !== 'once' && response !== 'always' && response !== 'reject') {
                throw new Error('response must be once, always, or reject');
            }
            const pendingQuestion = getOpenCodeSessionSnapshot(sessionId)?.questions?.find((question) => question.id === permissionID);
            if (pendingQuestion) {
                if (response !== 'reject')
                    throw new Error('OpenCode questions must be answered with respondQuestion');
                const [questionClient, session] = await Promise.all([
                    getOpenCodeV2Client(),
                    getOpenCodeSession(sessionId),
                ]);
                const result = await questionClient.question.reject({
                    requestID: permissionID,
                    directory: session.directory,
                }, OPENCODE_OPTIONS);
                return { ok: openCodeData<boolean>(result) };
            }
            // OpenCode keys a pending permission by the session that asked, and a
            // subagent asks from its own child session: answering it under the
            // chat's id fails and leaves the turn waiting (verified on 2.0.8).
            const askingSessionId = getOpenCodeSessionSnapshot(sessionId)?.permissions.find((entry) => entry.id === permissionID)?.sessionID
                ?? await openCodePendingPermissionSession(sessionId, permissionID)
                ?? sessionId;
            const result = await client.postSessionIdPermissionsPermissionId({
                ...OPENCODE_OPTIONS,
                path: { id: askingSessionId, permissionID },
                body: { response },
            });
            return { ok: openCodeData<boolean>(result) };
        }
        if (action === 'respondQuestion') {
            const permissionID = typeof body.permissionId === 'string' ? body.permissionId : '';
            if (!permissionID)
                throw new Error('permissionId is required');
            const answers = parseQuestionAnswers(body.answers);
            if (!answers)
                throw new Error('answers is required');
            const [questionClient, session] = await Promise.all([
                getOpenCodeV2Client(),
                getOpenCodeSession(sessionId),
            ]);
            let question = getOpenCodeSessionSnapshot(sessionId)?.questions?.find((entry) => entry.id === permissionID);
            if (!question) {
                const pending = await questionClient.question.list(session.directory ? { directory: session.directory } : undefined, OPENCODE_OPTIONS);
                // Request ids are unique on the server; a subagent's question carries
                // its child session's id, not this chat's.
                question = openCodeData<OpenCodeQuestionRequest[]>(pending).find((entry) => entry.id === permissionID);
            }
            if (!question)
                throw new PendingRequestGoneError('Question');
            const orderedAnswers = question.questions.map((entry, index) => answers[String(index)]
                ?? answers[entry.question]
                ?? answers[entry.header]
                ?? []);
            const result = await questionClient.question.reply({
                requestID: permissionID,
                directory: session.directory,
                answers: orderedAnswers,
            }, OPENCODE_OPTIONS);
            return { ok: openCodeData<boolean>(result) };
        }
    }
    throw new Error(`Action ${action || '(missing)'} is not supported for ${"opencode"} sessions`);
}
export async function createOpenCodeStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
    const userMessage = String(body.message ?? '').trim();
    const turnRequestId = parseTurnRequestId(body);
    const selectedModel = decodeOpenCodeModelValue(typeof body.model === 'string' ? body.model : null);
    const attachments = parseAttachments(body);
    const resumeSessionAt = typeof body.resumeSessionAt === 'string' ? body.resumeSessionAt : undefined;
    const requestedAgent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim() : undefined;
    // OpenCode CLI convention: a prompt starting with `!` is treated as a direct
    // shell invocation against the session, not as natural language. The CLI
    // routes it via the session.shell RPC. Match that here so the composer
    // feels native — but only when no attachments tag along, since shell takes
    // a single command string.
    const bangShell = userMessage.startsWith('!') && attachments.length === 0
        ? userMessage.slice(1).trim()
        : null;
    const slashCommand = attachments.length === 0
        ? parseOpenCodeSlashCommand(userMessage)
        : null;
    const detachOnClientAbort = body.detachOnClientAbort === true;
    const client = await getOpenCodeClient();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            let targetSessionId = sessionId;
            let cleanedUp = false;
            let downstreamClosed = false;
            let requestAborted = false;
            let consumeEvents: Promise<void> | null = null;
            let lastActivityAt = Date.now();
            let cancelWatchdog: (() => void) | null = null;
            const outputTokensByMessageId = new Map<string, number>();
            const messageRoles = new Map<string, OpenCodeMessageRole>();
            const modelContextLimits = new Map<string, number>();
            let latestUsageMessage: Parameters<typeof mapOpenCodeContextUsage>[0];
            const publishContextUsage = () => {
                const model = currentOpenCodeModelValue(latestUsageMessage);
                const usage = mapOpenCodeContextUsage(latestUsageMessage, model ? modelContextLimits.get(model) ?? 0 : 0);
                if (usage)
                    safeEnqueue(codexContextUsageToEventData(usage));
            };
            let turnOutputTokens = 0;
            // safeEnqueue is declared further down this stream body; the arrow defers
            // the lookup so the reporter can live beside the counter it reports.
            const reportTurnUsage = createTurnUsageReporter((chunk) => safeEnqueue(chunk));
            // Subscribe to the shared event harness — one upstream connection per
            // directory (opencode ≥1.17 only delivers session/message events on the
            // directory-scoped bus; the unscoped stream is server heartbeats only),
            // multiplexed by session. The directory is resolved from the session
            // record inside the try below, before the subscription opens.
            let subscription: ReturnType<typeof subscribeToOpenCodeEvents> | null = null;
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
            const close = () => {
                if (cleanedUp)
                    return;
                cleanedUp = true;
                subscription?.close();
                if (!downstreamClosed) {
                    downstreamClosed = true;
                    try {
                        controller.close();
                    }
                    catch {
                        /* downstream already closed */
                    }
                }
            };
            // Push an SSE comment immediately so any intermediate proxy starts
            // forwarding the response without waiting for the first real frame.
            // Mirrors how curl-friendly SSE servers prime the pipe.
            safeEnqueue(':ok\n\n');
            signal.addEventListener('abort', () => {
                requestAborted = true;
                if (detachOnClientAbort) {
                    downstreamClosed = true;
                    return;
                }
                void interruptRunningSession(sessionId, turnRequestId).catch(() => { });
            }, { once: true });
            try {
                // The event bus scopes on the session's directory exactly as the
                // server stores it — resolve it from the session record rather than
                // trusting the client-provided cwd (which can be a symlink variant).
                let isOpenCode2 = false;
                const sessionDirectory = await client.session.get({
                    ...OPENCODE_OPTIONS,
                    path: { id: sessionId },
                }).then((response) => {
                    const record = openCodeData<OpenCodeSession & {
                        directory?: string;
                    }>(response);
                    isOpenCode2 = record.version === '2';
                    return typeof record.directory === 'string' && record.directory ? record.directory : undefined;
                }).catch(() => (typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined));
                // Load limits alongside turn startup, so model discovery cannot delay
                // prompt acceptance. When it resolves, refresh only the latest usage.
                if (isOpenCode2) {
                    void withTimeout(client.config.providers({
                        ...OPENCODE_OPTIONS, query: sessionDirectory ? { directory: sessionDirectory } : undefined,
                    }), 5000, 'OpenCode model limits').then(response => {
                        for (const model of mapOpenCodeModelsToSessionModels(openCodeData(response))) {
                            if (model.contextWindowTokens)
                                modelContextLimits.set(model.value, model.contextWindowTokens);
                        }
                        publishContextUsage();
                    }).catch(() => { });
                }
                if (resumeSessionAt) {
                    const forkedResponse = await client.session.fork({
                        ...OPENCODE_OPTIONS,
                        path: { id: sessionId },
                        body: { messageID: resumeSessionAt },
                    });
                    targetSessionId = openCodeData<OpenCodeSession>(forkedResponse).id;
                }
                // Opened after the fork decision so it filters on the id whose
                // events we actually want — no dead-parent echo to unsubscribe.
                const activeSubscription = subscribeToOpenCodeEvents({ sessionId: targetSessionId, directory: sessionDirectory });
                subscription = activeSubscription;
                safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId: targetSessionId })}\n\n`);
                // Replay cached state so the client doesn't have to wait for the
                // next live event tick to render a stale permission prompt or busy
                // indicator — this is what opencode-web does on every subscribe.
                const cached = activeSubscription.snapshot;
                if (cached?.status) {
                    safeEnqueue(`event: opencode-status\ndata: ${JSON.stringify(cached.status)}\n\n`);
                }
                if (cached?.todos && cached.todos.length > 0) {
                    safeEnqueue(`event: opencode-todos\ndata: ${JSON.stringify(cached.todos)}\n\n`);
                }
                for (const permission of cached?.permissions ?? []) {
                    safeEnqueue(`data: ${formatOpenCodeEvent({ type: 'permission.updated', properties: permission } as OpenCodeEvent)}\n\n`);
                }
                for (const question of cached?.questions ?? []) {
                    safeEnqueue(`data: ${formatOpenCodeEvent({
                        type: 'question.asked',
                        properties: question,
                    } as unknown as OpenCodeEvent)}\n\n`);
                }
                // Sending another prompt while the session is busy queues it server-side
                // (the native opencode TUI's type-while-running flow). The session stays
                // busy until the queue drains, so this same stream keeps delivering the
                // queued turn's events and closes on the final session.idle.
                const steerOpenCode = (text: string) => client.session.promptAsync({
                    ...OPENCODE_OPTIONS,
                    path: { id: targetSessionId },
                    body: {
                        model: selectedModel ?? undefined,
                        agent: requestedAgent,
                        tools: getCoordinatorOpenCodeToolMask(sessionId),
                        parts: buildOpenCodeParts(text, []),
                    },
                });
                setRunningSession(sessionId, {
                    provider: 'opencode',
                    requestId: turnRequestId,
                    interrupt: () => client.session.abort({
                        ...OPENCODE_OPTIONS,
                        path: { id: targetSessionId },
                    }),
                    steer: steerOpenCode,
                });
                if (targetSessionId !== sessionId) {
                    setRunningSession(targetSessionId, {
                        provider: 'opencode',
                        requestId: turnRequestId,
                        interrupt: () => client.session.abort({
                            ...OPENCODE_OPTIONS,
                            path: { id: targetSessionId },
                        }),
                        steer: steerOpenCode,
                    });
                }
                consumeEvents = (async () => {
                    for await (const harnessEvent of activeSubscription.events) {
                        if (harnessEvent.type === 'snapshot') {
                            const snapshot = harnessEvent.snapshot;
                            if (snapshot.status) {
                                safeEnqueue(`event: opencode-status\ndata: ${JSON.stringify(snapshot.status)}\n\n`);
                            }
                            if (snapshot.todos && snapshot.todos.length > 0) {
                                safeEnqueue(`event: opencode-todos\ndata: ${JSON.stringify(snapshot.todos)}\n\n`);
                            }
                            for (const permission of snapshot.permissions) {
                                safeEnqueue(`data: ${formatOpenCodeEvent({ type: 'permission.updated', properties: permission } as OpenCodeEvent)}\n\n`);
                            }
                            for (const question of snapshot.questions) {
                                safeEnqueue(`data: ${formatOpenCodeEvent({
                                    type: 'question.asked',
                                    properties: question,
                                } as unknown as OpenCodeEvent)}\n\n`);
                            }
                            continue;
                        }
                        if (harnessEvent.type !== 'event')
                            continue;
                        const event = harnessEvent.event;
                        if (event.type === 'message.updated' && event.properties.info.role === 'assistant') {
                            latestUsageMessage = event.properties.info;
                            publishContextUsage();
                            turnOutputTokens = updateOpenCodeTurnOutputUsage(outputTokensByMessageId, event.properties.info, turnOutputTokens);
                            reportTurnUsage(turnOutputTokens);
                        }
                        if (event.type === 'session.status') {
                            safeEnqueue(`event: opencode-status\ndata: ${JSON.stringify(event.properties.status)}\n\n`);
                        }
                        if (event.type === 'todo.updated') {
                            safeEnqueue(`event: opencode-todos\ndata: ${JSON.stringify(event.properties.todos)}\n\n`);
                        }
                        if (event.type === 'session.error') {
                            const message = event.properties.error?.data && 'message' in event.properties.error.data
                                ? String(event.properties.error.data.message)
                                : 'Unknown OpenCode session error';
                            safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
                            break;
                        }
                        safeEnqueue(`data: ${formatOpenCodeEvent(event, messageRoles)}\n\n`);
                        if (event.type === 'session.idle' && event.properties.sessionID === targetSessionId) {
                            break;
                        }
                    }
                })();
                if (bangShell) {
                    await client.session.shell({
                        ...OPENCODE_OPTIONS,
                        path: { id: targetSessionId },
                        body: {
                            agent: requestedAgent ?? 'build',
                            model: selectedModel ?? undefined,
                            command: bangShell,
                        },
                    });
                }
                else if (slashCommand) {
                    const commandName = slashCommand.command.toLowerCase();
                    // TUI built-ins are not server-side custom commands — session.command
                    // would 500 on them. Map them to their native RPCs instead, exactly
                    // like the opencode TUI does.
                    if (commandName === 'summarize' || commandName === 'compact') {
                        // The summarize RPC requires an explicit model. Like the opencode
                        // TUI, fall back to the model the session last ran with.
                        const summarizeModel = selectedModel ?? await client.session.messages({
                            ...OPENCODE_OPTIONS,
                            path: { id: targetSessionId },
                        }).then((response) => {
                            const records = openCodeData<Array<{
                                info?: {
                                    role?: string;
                                    providerID?: string;
                                    modelID?: string;
                                };
                            }>>(response);
                            for (let i = records.length - 1; i >= 0; i -= 1) {
                                const info = records[i]?.info;
                                if (info?.role === 'assistant' && info.providerID && info.modelID) {
                                    return { providerID: info.providerID, modelID: info.modelID };
                                }
                            }
                            return null;
                        }).catch(() => null);
                        if (!summarizeModel) {
                            throw new Error('Pick a model before running /summarize — this session has no prior model to reuse.');
                        }
                        safeEnqueue(commandResultEvent('opencode', { message: 'Summarizing the conversation…', transcriptExpected: true }));
                        await client.session.summarize({
                            ...OPENCODE_OPTIONS,
                            path: { id: targetSessionId },
                            body: summarizeModel,
                        });
                        // Summarize runs a busy→idle turn; the event loop closes on idle.
                    }
                    else if (commandName === 'share') {
                        const shared = await client.session.share({ ...OPENCODE_OPTIONS, path: { id: targetSessionId } });
                        const record = openCodeData<OpenCodeSession & {
                            share?: {
                                url?: string;
                            };
                        }>(shared);
                        safeEnqueue(commandResultEvent('opencode', {
                            message: record.share?.url ? `Session shared: ${record.share.url}` : 'Session shared.',
                            transcriptExpected: false,
                        }));
                        activeSubscription.close();
                    }
                    else if (commandName === 'unshare') {
                        await client.session.unshare({ ...OPENCODE_OPTIONS, path: { id: targetSessionId } });
                        safeEnqueue(commandResultEvent('opencode', { message: 'Session sharing disabled.', transcriptExpected: false }));
                        activeSubscription.close();
                    }
                    else if (commandName === 'help' || commandName === 'models') {
                        // OpenCode TUI built-ins that are views, not server commands: answer
                        // them here rather than reporting them "not available".
                        let message: string;
                        if (commandName === 'help') {
                            const serverCommands = await client.command.list({
                                ...OPENCODE_OPTIONS,
                                ...(sessionDirectory ? { query: { directory: sessionDirectory } } : {}),
                            }).then((response) => openCodeData<Array<{
                                name?: string;
                            }>>(response)).catch(() => []);
                            const names = serverCommands.map((command) => command?.name).filter((name): name is string => Boolean(name));
                            message = [
                                'OpenCode commands: /compact (/summarize), /share, /unshare, /models, !<shell>',
                                names.length ? `Project commands: ${names.map((name) => `/${name}`).join(', ')}` : '',
                            ].filter(Boolean).join(' · ');
                        }
                        else {
                            const lastModel = selectedModel ?? await client.session.messages({
                                ...OPENCODE_OPTIONS,
                                path: { id: targetSessionId },
                            }).then((response) => {
                                const records = openCodeData<Array<{
                                    info?: {
                                        role?: string;
                                        providerID?: string;
                                        modelID?: string;
                                    };
                                }>>(response);
                                for (let i = records.length - 1; i >= 0; i -= 1) {
                                    const info = records[i]?.info;
                                    if (info?.role === 'assistant' && info.providerID && info.modelID)
                                        return { providerID: info.providerID, modelID: info.modelID };
                                }
                                return null;
                            }).catch(() => null);
                            message = `${lastModel ? `OpenCode model is ${lastModel.providerID}/${lastModel.modelID}.` : 'No OpenCode model has run in this session yet.'} Switch with ⌥M.`;
                        }
                        safeEnqueue(commandResultEvent('opencode', { message, transcriptExpected: false }));
                        activeSubscription.close();
                    }
                    else {
                        // Validate against the server's command list first — an unknown
                        // name would otherwise surface as an opaque 500 from the server.
                        const knownCommands = await client.command.list({
                            ...OPENCODE_OPTIONS,
                            ...(sessionDirectory ? { query: { directory: sessionDirectory } } : {}),
                        }).then((response) => openCodeData<Array<{
                            name?: string;
                        }>>(response)).catch(() => null);
                        const isKnown = knownCommands?.some((command) => command?.name?.toLowerCase() === commandName);
                        if (knownCommands && !isKnown) {
                            safeEnqueue(commandResultEvent('opencode', {
                                message: `/${slashCommand.command} is not available on this opencode server.`,
                                transcriptExpected: false,
                            }));
                            activeSubscription.close();
                        }
                        else {
                            await client.session.command({
                                ...OPENCODE_OPTIONS,
                                path: { id: targetSessionId },
                                body: {
                                    agent: requestedAgent,
                                    model: selectedModel ? `${selectedModel.providerID}/${selectedModel.modelID}` : undefined,
                                    // v2 selects the session model before invoking a command.
                                    ...(isOpenCode2 ? { openCodeModel: selectedModel ?? undefined } : {}),
                                    command: slashCommand.command,
                                    arguments: slashCommand.arguments,
                                },
                            });
                        }
                    }
                }
                else {
                    await client.session.promptAsync({
                        ...OPENCODE_OPTIONS,
                        path: { id: targetSessionId },
                        body: {
                            model: selectedModel ?? undefined,
                            agent: requestedAgent,
                            tools: getCoordinatorOpenCodeToolMask(sessionId),
                            parts: buildOpenCodeParts(userMessage, attachments, sessionDirectory),
                        },
                    });
                    safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId: targetSessionId, provider: 'opencode' })}\n\n`);
                }
                // Backstop a dropped session.idle: if the event subscription goes
                // silent we probe session.status and, once OpenCode confirms the turn
                // is no longer busy, synthesize the idle frame so the consume loop ends
                // instead of hanging until the request is forcibly torn down.
                cancelWatchdog = startTurnWatchdog({
                    label: 'opencode',
                    idleTimeoutMs: OPENCODE_WATCHDOG_IDLE_MS,
                    isClosed: () => cleanedUp || (downstreamClosed && !detachOnClientAbort),
                    lastActivityAt: () => lastActivityAt,
                    probe: async () => {
                        try {
                            const statusMap = await client.session.status({ ...OPENCODE_OPTIONS });
                            const status = (statusMap as Record<string, {
                                type?: string;
                            }>)?.[targetSessionId];
                            if (!status)
                                return 'idle';
                            return status.type === 'busy' || status.type === 'retry' ? 'running' : 'idle';
                        }
                        catch {
                            return 'unknown';
                        }
                    },
                    onResolved: () => {
                        safeEnqueue(`data: ${formatOpenCodeEvent({ type: 'session.idle', properties: { sessionID: targetSessionId } } as OpenCodeEvent)}\n\n`);
                        // Ends the for-await over the subscription's events, resolving consumeEvents.
                        activeSubscription.close();
                    },
                });
                await consumeEvents;
            }
            catch (err) {
                if (!requestAborted) {
                    safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`);
                }
            }
            finally {
                cancelWatchdog?.();
                subscription?.close();
                await consumeEvents?.catch(() => { });
                clearRunningSession(sessionId, turnRequestId);
                if (targetSessionId !== sessionId) {
                    clearRunningSession(targetSessionId, turnRequestId);
                }
                close();
            }
        },
    });
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
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
    const provider = "opencode";
    {
        // The first call starts this process's managed `opencode serve`; nothing
        // else on a browse-only path does any more, so the composer warms it.
        await withTimeout(getOpenCodeClient(), providerStartupTimeoutMs(params.model), 'OpenCode server prewarm');
        return;
    }
}
/** Existing SDK dispatch, reached only through bundled extension runtime entries. */
export async function streamTurn(params: SendMessageParams, checkpoint?: Promise<TurnCheckpoint | null>): Promise<Response> {
    const provider = "opencode";
    // Other providers don't yet have that explicit submission boundary — keep
    // the original blocking ordering for them until they gain one.
    await checkpoint?.catch(() => null);
    {
        return createOpenCodeStream(params.sessionId, params.signal, params.body);
    }
}
export async function forkSession({ sessionId, body, provider }: ForkParams): Promise<{
    sessionId: string;
}> {
    const resolvedProvider = "opencode";
    {
        const client = await getOpenCodeClient();
        const forkedResponse = await client.session.fork({
            ...OPENCODE_OPTIONS,
            path: { id: sessionId },
            body: {
                messageID: typeof body.upToMessageId === 'string' ? body.upToMessageId : undefined,
            },
        });
        const forked = openCodeData<OpenCodeSession>(forkedResponse);
        if (typeof body.title === 'string' && body.title.trim()) {
            await client.session.update({
                ...OPENCODE_OPTIONS,
                path: { id: forked.id },
                body: { title: body.title.trim() },
            });
        }
        return { sessionId: forked.id };
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
    const provider = "opencode";
    const resolvedCwd = (cwd && cwd.trim()) ? cwd : process.cwd();
    {
        const client = await getOpenCodeClient();
        const response = await client.session.create({
            ...OPENCODE_OPTIONS,
            query: { directory: resolvedCwd },
            body: title && title.trim() ? { title: title.trim() } : undefined,
        });
        const session = openCodeData<OpenCodeSession>(response);
        return { sessionId: session.id, provider: "opencode", cwd: resolvedCwd, isPending: false };
    }
}
/** Release provider-side resources for an active session without deleting its durable history. */
export async function closeSession(sessionId: string, providerOverride?: AgentProvider): Promise<void> {
    const provider = "opencode";
}
export function listPendingPermissions(sessionId: string, provider?: AgentProvider): Record<string, unknown>[] {
    {
        const snapshot = getOpenCodeSessionSnapshot(sessionId);
        return [
            ...(snapshot?.permissions ?? []).map((permission) => ({
                type: 'opencode_event',
                event: { type: 'permission.updated', properties: permission },
            })),
            ...(snapshot?.questions ?? []).map((question) => ({
                type: 'opencode_event',
                event: { type: 'question.asked', properties: question },
            })),
        ];
    }
}
/** Process-local control-plane state for fleet and attention clients. */
export async function rewindSession({ sessionId, body, provider }: RewindParams): Promise<Record<string, unknown>> {
    const resolvedProvider = "opencode";
    {
        const userMessageId = typeof body.userMessageId === 'string' ? body.userMessageId : undefined;
        if (!userMessageId) {
            throw new Error('userMessageId is required');
        }
        const client = await getOpenCodeClient();
        const diffResponse = await client.session.diff({
            ...OPENCODE_OPTIONS,
            path: { id: sessionId },
            query: { messageID: userMessageId },
        });
        const filesChanged = summarizeOpenCodeDiffs(openCodeData<OpenCodeFileDiff[]>(diffResponse));
        if (body.dryRun) {
            return {
                mode: 'rewind',
                canRewind: true,
                filesChanged,
            };
        }
        await client.session.revert({
            ...OPENCODE_OPTIONS,
            path: { id: sessionId },
            body: { messageID: userMessageId },
        });
        return {
            mode: 'rewind',
            canRewind: true,
            filesChanged,
        };
    }
}
export function readMemoryDiagnostics(): Record<string, number> {
    return {};
}
/** The session a pending OpenCode permission belongs to, read from the server when the harness has not seen it. */
export async function openCodePendingPermissionSession(sessionId: string, permissionID: string): Promise<string | undefined> {
    const [clientV2, session] = await Promise.all([getOpenCodeV2Client(), getOpenCodeSession(sessionId).catch(() => null)]);
    const pending = await clientV2.permission.list(session?.directory ? { directory: session.directory } : undefined, {
        responseStyle: 'data',
        throwOnError: true,
    }).catch(() => null);
    const list = pending ? openCodeData<Array<{
        id?: string;
        sessionID?: string;
    }>>(pending) : [];
    return list.find((entry) => entry.id === permissionID)?.sessionID;
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
