// Provider architecture extraction: SDK behavior preserved from the session backend.
import { pendingClaudeDialogs, pendingClaudeElicitations, pendingClaudePermissions, listPendingClaudeElicitations, listPendingClaudePrompts, CLAUDE_PERMISSION_MODES, type PendingClaudePermission, claudePermissionDecision, type ClaudePermissionModeValue, pendingClaudePermissionKey, claudeResultErrorMessage, createClaudeUserDialogBridge, createClaudeDeltaCoalescer } from './helpers'
import { parseQuestionAnswers, parseAttachments, parseEffort, parseTurnRequestId } from '../runtimeCore'
import { steerViewSession } from '../../../sessionSteering'
import { listPendingProviderPermissionPayloads } from '../../../sessionControlPlane'
import { claudeArtifactStore } from "../../../claudeArtifactStore";
import { readClaudeMcpApp } from "../../../claudeMcpApps";
import { coordinatorPermissionToken } from "../../../coordinatorNativePermission";
import { extractPendingPermissions } from "../../../permissions";
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve as resolvePath } from 'node:path';
import { forkSession as forkClaudeSession, getSessionInfo, query, resolveSettings, type CanUseTool, type ElicitationResult as ClaudeElicitationResult, type PermissionResult, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeBridgeBox, ClaudeElicitationHandler, ClaudePoolEntry } from "../../../claudePool";
import { claudePoolIfLoaded, claudePoolModule, ensureClaudePool } from "../../../claudePoolHandle";
import { claudeDynamicMcpServerNames, getClaudeDynamicMcpServers, parseClaudeDynamicMcpServers, setClaudeDynamicMcpServers } from "../../../claudeDynamicMcp";
import { listClaudeHookEvents } from "../../../claudeHookEvents";
import { broadcastClaudeMessage, broadcastClaudeRecycled, broadcastClaudeTurnEnd, broadcastClaudeTurnStart } from "../../../claudeHarness";
import { noteClaudeCommandsChanged } from "../../../claudeCommandsStore";
import { claudeAgentPolicyOptions, claudeQueryBudgetOptions, parseClaudeAgentPolicy, type ClaudeAgentPolicy } from "../../../claudeRuntimePolicy";
import { claudeSessionPersistenceQueryOptions, claudeSessionStoreOptions } from "../../../claudeSessionStore";
import { withClaudeResumeTouchRecorded } from "../../../claudeResumeTouch";
import { claudeProcessSpawnOptions, claudeProcessTransportStatus } from "../../../claudeProcessSpawner";
import type { ContentBlockParam as ClaudeContentBlockParam } from '@anthropic-ai/sdk/resources';
import { readClaudeSessionMessages } from "../../../claudeSessionReads";
import { withTimeout } from "../../../withTimeout";
import { claudeFallbackModelChain } from "../../../claudeModels";
import { providerStartupTimeoutMs } from "../../../providerWarmup";
import { PendingRequestGoneError } from "../../../pendingRequestGone";
import { backgroundRunningSession, clearRunningSession, setRunningSession } from "../../../sessionRuntime";
import { retagCheckpointSession, type TurnCheckpoint } from "../../../checkpoints";
import { appendPortableComposerContext, assertComposerAttachmentsSupported, planComposerAttachments, resolveLocalComposerAttachmentPath } from "../../../composerAttachments";
import type { AgentProvider, ContextUsage, SendAttachment, ReasoningEffortLevel } from "../../../types";
import { createSessionControlQuery } from "../../../sdkControlQuery";
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
/**
 * Plan rate-limit utilization — the data behind Claude Code's `/usage` command
 * (5-hour and 7-day windows, per-model buckets, extra-usage credits). There is
 * no other source for it: `rate_limit_event` only arrives once the API decides
 * to warn, so without this a user can't see how close they are until they are
 * already there.
 *
 * The SDK method is explicitly marked unstable and expected to be renamed when
 * it stabilizes, so it is called through a defensive lookup: a rename degrades
 * this section to "Unavailable" instead of throwing and taking the whole
 * diagnostics panel down with it.
 */
/**
 * Absolute paths the session has authoritatively observed through Claude's
 * native Read tool. Restore flows use this set to repair the resumed Query's
 * edit-safety cache without granting read state for unrelated files.
 */
export async function readClaudeObservedFilePaths(sessionId: string, cwd: string): Promise<string[]> {
    const messages = await readClaudeSessionMessages(sessionId);
    const observed = new Set<string>();
    for (let messageIndex = messages.length - 1; messageIndex >= 0 && observed.size < 200; messageIndex -= 1) {
        const content = messages[messageIndex]?.message.content;
        if (!Array.isArray(content))
            continue;
        for (let blockIndex = content.length - 1; blockIndex >= 0 && observed.size < 200; blockIndex -= 1) {
            const block = content[blockIndex];
            if (block?.type !== 'tool_use' || String(block.name).toLowerCase() !== 'read')
                continue;
            const input = block.input && typeof block.input === 'object'
                ? block.input as Record<string, unknown>
                : {};
            const rawPath = typeof input.file_path === 'string'
                ? input.file_path
                : typeof input.path === 'string'
                    ? input.path
                    : '';
            if (rawPath)
                observed.add(resolvePath(cwd, rawPath));
        }
    }
    return [...observed];
}
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
export function isSupportedClaudeImageMime(mimeType: string): mimeType is 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    return mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/gif' || mimeType === 'image/webp';
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
export async function buildClaudePromptParts(userMessage: string, attachments: SendAttachment[], cwd?: string): Promise<{
    text: string;
    imageBlocks: ClaudeContentBlockParam[];
}> {
    const plan = planComposerAttachments('claude', attachments);
    assertComposerAttachmentsSupported('claude', plan);
    const imageBlocks: ClaudeContentBlockParam[] = [];
    for (const attachment of plan.native) {
        const image = await readLocalImageAttachment(attachment, cwd);
        if (!image)
            continue;
        if (!isSupportedClaudeImageMime(image.mimeType)) {
            throw new Error(`Claude image attachment ${image.name} has unsupported MIME type ${image.mimeType}`);
        }
        imageBlocks.push({
            type: 'image',
            source: {
                type: 'base64',
                media_type: image.mimeType,
                data: image.data,
            },
        });
    }
    const text = appendPortableComposerContext(userMessage, plan.portableText);
    return { text, imageBlocks };
}
export async function buildClaudeUserMessage(userMessage: string, attachments: SendAttachment[], cwd?: string): Promise<SDKUserMessage> {
    const { text, imageBlocks } = await buildClaudePromptParts(userMessage, attachments, cwd);
    return {
        type: 'user',
        message: {
            role: 'user',
            content: imageBlocks.length === 0
                ? text
                : [{ type: 'text', text }, ...imageBlocks],
        },
        parent_tool_use_id: null,
        // uuid-stamp every outgoing message: command_lifecycle frames
        // (queued/started/completed/cancelled/discarded) and interrupt
        // still_queued receipts only reference uuid-stamped messages.
        uuid: crypto.randomUUID(),
    } as SDKUserMessage;
}
export function claudeUserMessageUuid(message: SDKUserMessage): string | undefined {
    const uuid = (message as {
        uuid?: unknown;
    }).uuid;
    return typeof uuid === 'string' ? uuid : undefined;
}
// ── Claude input-box bash mode (`!command`) ─────────────────────────────────
// Mirrors the Claude Code CLI: the command runs locally in the session cwd,
// then two user messages are appended to the session in the CLI's native
// transcript shape — `<bash-input>cmd</bash-input>` (persisted silently via
// shouldQuery:false) and `<bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>`
// (which starts a turn so Claude responds to the output, matching the CLI's
// respondToBashCommands default).
export const CLAUDE_BANG_SHELL_TIMEOUT_MS = 5 * 60 * 1000;
export const CLAUDE_BANG_SHELL_OUTPUT_CAP = 100000;
// The CLI XML-escapes text before wrapping it in bash-* transcript tags
// (observed in native session files: `bun &lt;command&gt;`).
export function escapeBashTagContent(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function buildClaudeBashInputMessage(command: string): SDKUserMessage {
    return {
        type: 'user',
        message: { role: 'user', content: `<bash-input>${escapeBashTagContent(command)}</bash-input>` },
        parent_tool_use_id: null,
        // Append to the transcript without starting an assistant turn — the output
        // message that follows is what queries.
        shouldQuery: false,
    };
}
export function buildClaudeBashOutputMessage(result: {
    stdout: string;
    stderr: string;
}): SDKUserMessage {
    return {
        type: 'user',
        message: {
            role: 'user',
            content: `<bash-stdout>${escapeBashTagContent(result.stdout)}</bash-stdout><bash-stderr>${escapeBashTagContent(result.stderr)}</bash-stderr>`,
        },
        parent_tool_use_id: null,
    };
}
// The output entry reaches the transcript only once it is persisted, which is
// after Claude has started (often finished) responding to it — so the command
// looked as if it had taken as long as the reply. The native CLI prints it the
// moment the command exits; this frame lets the surfaces do the same.
export function claudeBashOutputEvent(command: string, result: {
    stdout: string;
    stderr: string;
}): string {
    return `event: bash-output\ndata: ${JSON.stringify({ command, stdout: result.stdout, stderr: result.stderr })}\n\n`;
}
export async function runClaudeBangShellCommand(command: string, cwd: string | undefined, opts: {
    registerKill?: (kill: () => void) => void;
} = {}): Promise<{
    stdout: string;
    stderr: string;
}> {
    const { spawn } = await import('node:child_process');
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let truncated = false;
        let child: ReturnType<typeof spawn>;
        try {
            child = spawn('bash', ['-c', command], {
                cwd: cwd || process.cwd(),
                env: process.env,
                stdio: ['ignore', 'pipe', 'pipe'],
                // Own process group so interrupt/timeout kills the whole tree —
                // signalling just the `bash -c` parent orphans its children.
                detached: process.platform !== 'win32',
            });
        }
        catch (err) {
            resolve({ stdout: '', stderr: err instanceof Error ? err.message : 'Failed to run command' });
            return;
        }
        const killTree = (signal: NodeJS.Signals) => {
            const pid = child.pid;
            try {
                if (pid != null && process.platform !== 'win32') {
                    process.kill(-pid, signal);
                    return;
                }
            }
            catch { /* group already gone — fall through to direct kill */ }
            try {
                child.kill(signal);
            }
            catch { /* already gone */ }
        };
        const append = (current: string, chunk: Buffer): string => {
            if (current.length >= CLAUDE_BANG_SHELL_OUTPUT_CAP) {
                truncated = true;
                return current;
            }
            const next = current + chunk.toString('utf8');
            if (next.length > CLAUDE_BANG_SHELL_OUTPUT_CAP) {
                truncated = true;
                return next.slice(0, CLAUDE_BANG_SHELL_OUTPUT_CAP);
            }
            return next;
        };
        child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
        child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
        let settled = false;
        const settle = (extraStderr?: string) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            const parts = [stderr, truncated ? '… [output truncated]' : '', extraStderr ?? ''];
            resolve({ stdout, stderr: parts.filter(Boolean).join('\n') });
        };
        const timer = setTimeout(() => {
            killTree('SIGKILL');
            settle(`Command timed out after ${Math.round(CLAUDE_BANG_SHELL_TIMEOUT_MS / 1000)}s`);
        }, CLAUDE_BANG_SHELL_TIMEOUT_MS);
        opts.registerKill?.(() => {
            killTree('SIGTERM');
            settle('Command interrupted');
        });
        child.on('error', (err) => settle(err.message));
        child.on('close', (code) => {
            settle(code != null && code !== 0 ? `Exit code ${code}` : undefined);
        });
    });
}
export function codexContextUsageToEventData(contextUsage: ContextUsage): string {
    return `event: context-usage\ndata: ${JSON.stringify(contextUsage)}\n\n`;
}
/**
 * Context meter for a Claude turn, read out of the turn's own result message.
 *
 * The obvious source is Query.getContextUsage(), but that is a control RPC the
 * CLI answers on the same queue it accepts prompts on, taking ~1.4s on a warm
 * subprocess — asking for it around every turn parked that 1.4s in front of the
 * user's next send. The result message already carries what the meter shows:
 * `usage` is the main loop's per-turn usage in streaming-input sessions, so its
 * input side (fresh + both cache buckets) is the prompt the model was just
 * given — i.e. the context in use — and modelUsage carries the window it was
 * measured against. Free, and it refreshes on every turn.
 */
export function claudeResultContextUsage(msg: SDKMessage): ContextUsage | null {
    if (msg.type !== 'result')
        return null;
    const result = msg as unknown as {
        usage?: {
            input_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
            output_tokens?: number;
        };
        modelUsage?: Record<string, {
            contextWindow?: number;
        }>;
    };
    const usage = result.usage;
    if (!usage)
        return null;
    const totalTokens = (usage.input_tokens ?? 0)
        + (usage.cache_read_input_tokens ?? 0)
        + (usage.cache_creation_input_tokens ?? 0)
        + (usage.output_tokens ?? 0);
    if (totalTokens <= 0)
        return null;
    const models = Object.entries(result.modelUsage ?? {});
    // The main-loop model is the one with a window; several entries can appear
    // once subagents run, so take the largest window rather than an arbitrary
    // first key — a small subagent model's window would overstate the meter.
    const maxTokens = models.reduce((widest, [, entry]) => Math.max(widest, entry.contextWindow ?? 0), 0);
    if (maxTokens <= 0)
        return null;
    return {
        totalTokens,
        maxTokens,
        percentage: (totalTokens / maxTokens) * 100,
        model: models.find(([, entry]) => entry.contextWindow === maxTokens)?.[0] ?? '',
        categories: [],
    };
}
// Resolve an AskUserQuestion by allowing the tool with the user's answers
// merged into its input — the SDK's AskUserQuestion tool echoes `answers`
// (and optional freeform `response`/`annotations`) straight into its output.
export function claudeQuestionDecision(pending: Pick<PendingClaudePermission, 'input'>, payload: {
    answers: Record<string, string>;
    response?: string;
    annotations?: Record<string, {
        preview?: string;
        notes?: string;
    }>;
}): PermissionResult {
    return {
        behavior: 'allow',
        updatedInput: {
            ...(pending.input ?? {}),
            answers: payload.answers,
            ...(payload.response ? { response: payload.response } : {}),
            ...(payload.annotations ? { annotations: payload.annotations } : {}),
        },
    };
}
export function claudePermissionEvent(type: 'permission.requested' | 'permission.completed', data: Record<string, unknown>): string {
    return JSON.stringify({
        type: 'claude_permission',
        event: {
            timestamp: new Date().toISOString(),
            type,
            data,
        },
    });
}
export function createClaudePermissionBridge(sessionId: string, controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, activeIds: Set<string>): CanUseTool {
    const enqueuePermissionEvent = (type: 'permission.requested' | 'permission.completed', data: Record<string, unknown>) => {
        try {
            controller.enqueue(encoder.encode(`data: ${claudePermissionEvent(type, data)}\n\n`));
        }
        catch {
            // The client may disconnect while Claude is still resolving a tool permission.
        }
    };
    return (toolName, input, options) => {
        // SDK 0.3.199+ dropped requestId from the CanUseTool options type but the
        // CLI still sends it — read it loosely so ids stay stable across versions.
        const requestId = (options as {
            requestId?: string;
        }).requestId
            || options.toolUseID
            || `claude-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        activeIds.add(requestId);
        const requestData: Record<string, unknown> = {
            requestId,
            toolUseID: options.toolUseID,
            sessionId,
            toolName,
            input,
            title: options.title,
            displayName: options.displayName,
            description: options.description,
            blockedPath: options.blockedPath,
            decisionReason: options.decisionReason,
            suggestions: options.suggestions,
            // Which MCP server serves an `mcp__*` tool, and where it was configured
            // (SDK 0.3.274). The tool-name prefix alone cannot tell a server this
            // host registered from a project config that picked the same name.
            mcpServer: options.mcpServer,
            // Presentation constraints the CLI attaches to the ask (SDK 0.3.270).
            // They must ride the wire or a reattaching surface re-derives the card
            // without them and offers the affordance the CLI said to withhold.
            defaultToNo: options.defaultToNo,
            suppressAlwaysAllowRule: options.suppressAlwaysAllowRule,
        };
        enqueuePermissionEvent('permission.requested', requestData);
        return new Promise((resolve) => {
            const key = pendingClaudePermissionKey(sessionId, requestId);
            const deny = (message: string): PermissionResult => ({
                behavior: 'deny',
                message,
            });
            const cleanup = () => {
                pendingClaudePermissions.delete(key);
                activeIds.delete(requestId);
                options.signal.removeEventListener('abort', onAbort);
            };
            const onAbort = () => {
                cleanup();
                resolve(deny('Permission request was cancelled'));
            };
            options.signal.addEventListener('abort', onAbort, { once: true });
            pendingClaudePermissions.set(key, {
                suggestions: options.suggestions,
                input,
                requestData,
                resolve: (result) => {
                    cleanup();
                    enqueuePermissionEvent('permission.completed', { requestId });
                    resolve(result);
                },
            });
        });
    };
}
// Bridge MCP elicitation into the same reattachable interactive surface as
// tool permissions. URL requests wait for an explicit "open & continue";
// form requests render their JSON-schema fields and return typed content.
export function createClaudeElicitationBridge(sessionId: string, controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder): ClaudeElicitationHandler {
    const enqueue = (payload: Record<string, unknown>) => {
        try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        }
        catch {
            // Client may have disconnected while the turn keeps running server-side.
        }
    };
    return async (request, options) => {
        if (options.signal.aborted)
            return { action: 'cancel' };
        const requestId = request.elicitationId
            || `claude-elicitation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const requestData: Record<string, unknown> = {
            requestId,
            sessionId,
            serverName: request.serverName,
            message: request.message,
            mode: request.mode ?? 'form',
            url: request.url,
            elicitationId: request.elicitationId,
            requestedSchema: request.requestedSchema,
            // 0.3.300 declares this on the wire but drops it from OnElicitation.
            // Accept it when a future SDK forwards it; schema order remains the fallback.
            property_order: (request as typeof request & {
                property_order?: string[];
            }).property_order,
            title: request.title,
            displayName: request.displayName,
            description: request.description,
        };
        enqueue({
            type: 'claude_elicitation',
            event: { type: 'elicitation.requested', data: requestData },
        });
        return new Promise<ClaudeElicitationResult>((resolve) => {
            const key = pendingClaudePermissionKey(sessionId, requestId);
            const cleanup = () => {
                pendingClaudeElicitations.delete(key);
                options.signal.removeEventListener('abort', onAbort);
            };
            const finish = (result: ClaudeElicitationResult) => {
                cleanup();
                enqueue({
                    type: 'claude_elicitation',
                    event: { type: 'elicitation.completed', data: { requestId, action: result.action } },
                });
                resolve(result);
            };
            const onAbort = () => finish({ action: 'cancel' });
            options.signal.addEventListener('abort', onAbort, { once: true });
            pendingClaudeElicitations.set(key, {
                resolve: finish,
                requestData,
                requestedSchema: request.requestedSchema,
            });
        });
    };
}
export function resolvePendingClaudePermissions(sessionId: string, ids: Set<string>, message: string): void {
    for (const id of Array.from(ids)) {
        const key = pendingClaudePermissionKey(sessionId, id);
        const pending = pendingClaudePermissions.get(key);
        if (!pending)
            continue;
        pendingClaudePermissions.delete(key);
        ids.delete(id);
        pending.resolve({
            behavior: 'deny',
            message,
        });
    }
}
export function summarizeResolvedClaudeSettings(resolved: Awaited<ReturnType<typeof resolveSettings>>): Record<string, unknown> {
    const effectiveKeys = Object.keys(resolved.effective);
    return {
        effectiveKeys,
        effectiveKeyCount: effectiveKeys.length,
        sources: resolved.sources.map((source) => ({
            source: source.source,
            path: source.path,
            policyOrigin: source.policyOrigin,
            keys: Object.keys(source.settings),
        })),
        sourceCount: resolved.sources.length,
        provenance: Object.fromEntries(Object.entries(resolved.provenance).map(([key, entry]) => [
            key,
            entry ? { source: entry.source, path: entry.path, policyOrigin: entry.policyOrigin } : null,
        ])),
    };
}
export async function runAction({ sessionId, body, provider }: SessionActionParams): Promise<Record<string, unknown>> {
    const resolvedProvider = "claude";
    await ensureClaudePool();
    const action = typeof body.action === 'string' ? body.action : '';
    // Guard again after provider resolution/pool awaits. Remote confirmation
    // cannot fall through to a different session's similarly named request.
    if ((action === 'respondPermission' || action === 'respondQuestion') && typeof body.expectedPermissionToken === 'string') {
        const pending = extractPendingPermissions(listPendingProviderPermissionPayloads(sessionId, "claude"), { sessionId, provider: "claude" });
        if (!pending.some(permission => permission.id === body.permissionId && coordinatorPermissionToken(permission) === body.expectedPermissionToken)) {
            throw new PendingRequestGoneError(action === 'respondQuestion' ? 'Question' : 'Permission request');
        }
    }
    // Provider-agnostic: deliver a user message into the running turn (native
    // steering). `delivered: false` means no running turn / no steer primitive /
    // the turn ended while the request was in flight — callers fall back to
    // queueing the message for the next turn.
    if (action === 'steer') {
        return steerViewSession(sessionId, body, "claude");
    }
    {
        // Phase 2: prefer the warm pool entry's persistent Query for control RPCs
        // — avoids spinning a fresh CLI subprocess just to swap a model or
        // reconnect an MCP server. Falls back to createSessionControlQuery only
        // when the session isn't pooled (no recent send → no warm Query).
        if (action === 'respondPermission') {
            const permissionId = typeof body.permissionId === 'string' ? body.permissionId : '';
            const response = typeof body.response === 'string' ? body.response : '';
            if (!permissionId)
                throw new Error('permissionId is required');
            if (response !== 'once' && response !== 'always' && response !== 'reject') {
                throw new Error('response must be once, always, or reject');
            }
            const key = pendingClaudePermissionKey(sessionId, permissionId);
            let pending = pendingClaudePermissions.get(key);
            if (!pending) {
                for (const [pendingKey, candidate] of pendingClaudePermissions) {
                    if (!pendingKey.endsWith(`:${permissionId}`))
                        continue;
                    pending = candidate;
                    break;
                }
            }
            if (!pending) {
                let dialog = pendingClaudeDialogs.get(key);
                if (!dialog) {
                    for (const [pendingKey, candidate] of pendingClaudeDialogs) {
                        if (!pendingKey.endsWith(`:${permissionId}`))
                            continue;
                        dialog = candidate;
                        break;
                    }
                }
                if (dialog) {
                    dialog.resolve(response === 'reject'
                        ? { behavior: 'cancelled' }
                        : { behavior: 'completed', result: { continue: true } });
                    return { ok: true };
                }
                let elicitation = pendingClaudeElicitations.get(key);
                if (!elicitation) {
                    for (const [pendingKey, candidate] of pendingClaudeElicitations) {
                        if (!pendingKey.endsWith(`:${permissionId}`))
                            continue;
                        elicitation = candidate;
                        break;
                    }
                }
                if (!elicitation)
                    throw new PendingRequestGoneError('Permission request');
                elicitation.resolve({
                    action: response === 'reject' ? 'decline' : 'accept',
                    ...(response === 'reject' ? {} : { content: {} }),
                });
                return { ok: true };
            }
            const permissionMode = CLAUDE_PERMISSION_MODES.includes(body.permissionMode as ClaudePermissionModeValue)
                ? body.permissionMode as ClaudePermissionModeValue
                : undefined;
            pending.resolve(claudePermissionDecision(response, pending, permissionMode));
            return { ok: true };
        }
        // Answer an AskUserQuestion prompt: allow the tool with the user's selected
        // options (and any freeform text) merged into its input.
        if (action === 'respondQuestion') {
            const permissionId = typeof body.permissionId === 'string' ? body.permissionId : '';
            if (!permissionId)
                throw new Error('permissionId is required');
            const answers = parseQuestionAnswers(body.answers);
            if (!answers)
                throw new Error('answers is required');
            const response = typeof body.response === 'string' && body.response.trim() ? body.response.trim() : undefined;
            const annotations = (body.annotations && typeof body.annotations === 'object' && !Array.isArray(body.annotations))
                ? body.annotations as Record<string, {
                    preview?: string;
                    notes?: string;
                }>
                : undefined;
            const key = pendingClaudePermissionKey(sessionId, permissionId);
            let pending = pendingClaudePermissions.get(key);
            if (!pending) {
                for (const [pendingKey, candidate] of pendingClaudePermissions) {
                    if (!pendingKey.endsWith(`:${permissionId}`))
                        continue;
                    pending = candidate;
                    break;
                }
            }
            if (!pending) {
                let dialog = pendingClaudeDialogs.get(key);
                if (!dialog) {
                    for (const [pendingKey, candidate] of pendingClaudeDialogs) {
                        if (!pendingKey.endsWith(`:${permissionId}`))
                            continue;
                        dialog = candidate;
                        break;
                    }
                }
                if (dialog) {
                    const continueValue = answers.continue?.[0];
                    dialog.resolve(continueValue === 'false'
                        ? { behavior: 'cancelled' }
                        : { behavior: 'completed', result: { continue: true, answers, response, annotations } });
                    return { ok: true };
                }
                let elicitation = pendingClaudeElicitations.get(key);
                if (!elicitation) {
                    for (const [pendingKey, candidate] of pendingClaudeElicitations) {
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
            pending.resolve(claudeQuestionDecision(pending, {
                answers: Object.fromEntries(Object.entries(answers).map(([key, values]) => [key, values.join(', ')])),
                response,
                annotations,
            }));
            return { ok: true };
        }
        if (action === 'setModel') {
            const model = typeof body.model === 'string' ? body.model.trim() : '';
            if (!model)
                throw new Error('model is required');
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            if (warm) {
                await warm.setModel(model);
                return { ok: true, applied: 'live' };
            }
            // No warm entry — the next send will apply it via body.model on /messages/events.
            return { ok: true, applied: 'next-send' };
        }
        if (action === 'setMcpPermissionModeOverride') {
            const serverName = typeof body.serverName === 'string' ? body.serverName.trim() : '';
            const mode = body.mode === null || body.mode === 'default' || body.mode === 'auto'
                ? body.mode
                : undefined;
            if (!serverName)
                throw new Error('serverName is required');
            if (mode === undefined)
                throw new Error("mode must be 'default', 'auto', or null");
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            const q = warm?.query ?? createSessionControlQuery(sessionId);
            try {
                const result = await q.setMcpPermissionModeOverride(serverName, mode);
                return { ok: true, applied: warm ? 'live' : 'cold', ...result };
            }
            finally {
                if (!warm)
                    q.close();
            }
        }
        if (action === 'setPermissionMode') {
            const mode = parseClaudePermissionMode(body);
            if (!mode)
                throw new Error('permissionMode is required');
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            if (warm) {
                await warm.setPermissionMode(mode);
                return { ok: true, applied: 'live' };
            }
            return { ok: true, applied: 'next-send' };
        }
        if (action === 'getContextUsage') {
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            if (!warm) {
                // Don't spin a subprocess for a getter — the next pooled send will
                // emit a fresh usage event at the top of its stream anyway.
                return { ok: true, applied: 'cold', usage: null };
            }
            // The meter is the same number the turn's own result message carries, so
            // ask for the estimate rather than a token-count API call per category
            // (SDK 0.3.261's `summary` detail) — this getter sits on the same control
            // queue the CLI accepts prompts on, and a full read costs ~1.4s there.
            const usage = await warm.query.getContextUsage({ detail: 'summary' });
            return { ok: true, applied: 'live', usage };
        }
        if (action === 'getMcpApp') {
            const serverName = typeof body.serverName === 'string' ? body.serverName : '';
            const toolName = typeof body.toolName === 'string' ? body.toolName : '';
            if (!serverName || !toolName)
                throw new Error('serverName and toolName are required');
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            if (!warm)
                throw new Error('Continue this Claude session before opening its MCP App.');
            return readClaudeMcpApp(warm.query, serverName, toolName);
        }
        if (action === 'backgroundTasks') {
            const backgrounded = await backgroundRunningSession(sessionId);
            return { ok: true, backgrounded };
        }
        if (action === 'stopTask') {
            const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
            if (!taskId)
                throw new Error('taskId is required');
            // A background task only exists inside the live Query that spawned it; a
            // fresh control query (different subprocess) wouldn't know about it. So
            // unlike the MCP RPCs above there's no cold fallback — without a warm
            // entry there's nothing running to stop.
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            if (!warm)
                return { ok: true, applied: 'cold', stopped: false };
            await warm.query.stopTask(taskId);
            return { ok: true, applied: 'live', stopped: true };
        }
        if (action === 'getTaskOutput') {
            const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
            if (!taskId)
                throw new Error('taskId is required');
            // The task output belongs to the same live Query that started it.
            // Do not start a fresh Claude process just to read a tail.
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            if (!warm)
                return { ok: true, applied: 'cold', available: false, output: '', totalBytes: 0, truncated: false };
            // The installed SDK runtime exposes this control helper, although
            // its Query declaration currently omits it.
            const result = await (warm.query as unknown as {
                getTaskOutput: (id: string) => Promise<{ output: string; total_bytes: number; truncated: boolean }>;
            }).getTaskOutput(taskId);
            return {
                ok: true,
                applied: 'live',
                available: true,
                output: result.output,
                totalBytes: result.total_bytes,
                truncated: result.truncated,
            };
        }
        if (action === 'reconnectMcpServer') {
            const serverName = typeof body.serverName === 'string' ? body.serverName : '';
            if (!serverName)
                throw new Error('serverName is required');
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            if (warm) {
                await warm.query.reconnectMcpServer(serverName);
                return { ok: true, applied: 'live' };
            }
            const q = createSessionControlQuery(sessionId);
            try {
                await q.reconnectMcpServer(serverName);
                return { ok: true, applied: 'cold' };
            }
            finally {
                q.close();
            }
        }
        if (action === 'toggleMcpServer') {
            const serverName = typeof body.serverName === 'string' ? body.serverName : '';
            const enabled = typeof body.enabled === 'boolean' ? body.enabled : null;
            if (!serverName)
                throw new Error('serverName is required');
            if (enabled === null)
                throw new Error('enabled (boolean) is required');
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            if (warm) {
                await warm.query.toggleMcpServer(serverName, enabled);
                return { ok: true, applied: 'live' };
            }
            const q = createSessionControlQuery(sessionId);
            try {
                await q.toggleMcpServer(serverName, enabled);
                return { ok: true, applied: 'cold' };
            }
            finally {
                q.close();
            }
        }
        if (action === 'setMcpServers') {
            const previousServers = getClaudeDynamicMcpServers(sessionId);
            let servers;
            if (body.operation === 'add') {
                const serverName = typeof body.serverName === 'string' ? body.serverName.trim() : '';
                if (!serverName)
                    throw new Error('serverName is required');
                const parsed = parseClaudeDynamicMcpServers({ [serverName]: body.config });
                servers = { ...getClaudeDynamicMcpServers(sessionId), ...parsed };
            }
            else if (body.operation === 'remove') {
                const serverName = typeof body.serverName === 'string' ? body.serverName.trim() : '';
                if (!serverName)
                    throw new Error('serverName is required');
                servers = getClaudeDynamicMcpServers(sessionId);
                delete servers[serverName];
            }
            else {
                servers = parseClaudeDynamicMcpServers(body.servers);
            }
            setClaudeDynamicMcpServers(sessionId, servers);
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            if (!warm) {
                return { ok: true, applied: 'next-send', dynamicServers: Object.keys(servers).sort(), added: [], removed: [], errors: {} };
            }
            const info = await getSessionInfo(sessionId, claudeSessionStoreOptions()).catch(() => undefined);
            const context = { getSessionId: () => sessionId, getCwd: () => info?.cwd };
            try {
                const result = await warm.query.setMcpServers(claudePoolModule().claudeIntegratedMcpServers(context, sessionId));
                const statuses = await warm.query.mcpServerStatus();
                const authRequired = statuses.filter((status) => status.status === 'needs-auth').map((status) => status.name);
                return { ok: true, applied: 'live', dynamicServers: Object.keys(servers).sort(), statuses, authRequired, ...result };
            }
            catch (error) {
                // Keep the next spawn/recycle compatible with the live query when the
                // SDK rejects the replacement atomically. Connection/auth errors are
                // returned in McpSetServersResult.errors and intentionally remain
                // configured so the user can authenticate or reconnect them.
                setClaudeDynamicMcpServers(sessionId, previousServers);
                throw error;
            }
        }
        if (action === 'reloadPlugins') {
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            if (warm) {
                const result = await warm.query.reloadPlugins();
                return {
                    applied: 'live',
                    plugins: result.plugins ?? [],
                    commands: result.commands?.length ?? 0,
                    agents: result.agents?.length ?? 0,
                    mcpServers: result.mcpServers?.length ?? 0,
                };
            }
            const q = createSessionControlQuery(sessionId);
            try {
                const result = await q.reloadPlugins();
                return {
                    applied: 'cold',
                    plugins: result.plugins ?? [],
                    commands: result.commands?.length ?? 0,
                    agents: result.agents?.length ?? 0,
                    mcpServers: result.mcpServers?.length ?? 0,
                };
            }
            finally {
                q.close();
            }
        }
        if (action === 'reloadSkills') {
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            const q = warm?.query ?? createSessionControlQuery(sessionId);
            try {
                const result = await q.reloadSkills();
                return { ok: true, applied: warm ? 'live' : 'cold', ...result };
            }
            finally {
                if (!warm)
                    q.close();
            }
        }
        if (action === 'resolveSettings') {
            const info = await getSessionInfo(sessionId, claudeSessionStoreOptions()).catch(() => undefined);
            return { ok: true, ...summarizeResolvedClaudeSettings(await resolveSettings({ cwd: info?.cwd })) };
        }
        if (action === 'inspectClaudeRuntime') {
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            const q = warm?.query ?? createSessionControlQuery(sessionId);
            try {
                const info = await getSessionInfo(sessionId, claudeSessionStoreOptions()).catch(() => undefined);
                const [settings, commands, agents, mcpServers] = await Promise.all([
                    resolveSettings({ cwd: info?.cwd }),
                    q.supportedCommands(),
                    q.supportedAgents(),
                    q.mcpServerStatus(),
                ]);
                return {
                    ok: true,
                    applied: warm ? 'live' : 'cold',
                    settings: summarizeResolvedClaudeSettings(settings),
                    commands,
                    agents,
                    mcpServers,
                    dynamicMcpServers: claudeDynamicMcpServerNames(sessionId),
                    processTransport: claudeProcessTransportStatus(),
                };
            }
            finally {
                if (!warm)
                    q.close();
            }
        }
        if (action === 'listHookEvents') {
            const query = typeof body.query === 'string' ? body.query : undefined;
            const limit = typeof body.limit === 'number' ? body.limit : undefined;
            const events = await listClaudeHookEvents(sessionId, { query, limit });
            return { ok: true, events, query: query ?? '', count: events.length };
        }
        if (action === 'readFile') {
            const path = typeof body.path === 'string' ? body.path.trim() : '';
            const encoding = body.encoding === 'base64' ? 'base64' as const : 'utf-8' as const;
            const maxBytes = typeof body.maxBytes === 'number' && Number.isFinite(body.maxBytes)
                ? Math.max(1, Math.min(10 * 1024 * 1024, Math.floor(body.maxBytes)))
                : 512 * 1024;
            if (!path || path.includes('\0'))
                throw new Error('path is required');
            const warm = claudePoolModule().peekClaudeSession(sessionId);
            const q = warm?.query ?? createSessionControlQuery(sessionId);
            try {
                const file = await q.readFile(path, { maxBytes, encoding });
                return { ok: file !== null, applied: warm ? 'live' : 'cold', file };
            }
            finally {
                if (!warm)
                    q.close();
            }
        }
    }
    throw new Error(`Action ${action || '(missing)'} is not supported for ${"claude"} sessions`);
}
export type ClaudePermissionMode = typeof CLAUDE_PERMISSION_MODES[number];
export function parseClaudePermissionMode(body: Record<string, unknown>): ClaudePermissionMode | undefined {
    const mode = typeof body.permissionMode === 'string' ? body.permissionMode : '';
    return CLAUDE_PERMISSION_MODES.includes(mode as ClaudePermissionMode)
        ? mode as ClaudePermissionMode
        : undefined;
}
// Pool-internal failures surface with implementation-detail wording
// ("Claude pool entry was recycled mid-turn", "Claude turn exceeded hard
// timeout") that reads as a cryptic app error rather than what actually
// happened — the subprocess died or stalled. Map the known ones to plain
// language; anything else (a real SDK/API error) passes through unchanged
// since its message is already meant for a user.
export function friendlyClaudePoolError(err: unknown): string {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('exceeded hard timeout')) {
        return 'Claude stopped responding and the turn was cancelled after 10 minutes of silence. Please try again.';
    }
    if (message.includes('recycled mid-turn') || message.includes('recycled before turn could start') || message.includes('entry was recycled')) {
        return 'Lost connection to Claude mid-turn. Please try again.';
    }
    return message;
}
// Heartbeat cadence for the Claude POST send stream. Unlike the GET events SSE,
// the send stream can legitimately go quiet for long stretches (waiting on the
// first token, a slow tool call) with no frames. A periodic heartbeat keeps
// intermediaries (proxies, load balancers) from idle-closing the connection and
// gives the client a liveness pulse so it can distinguish "model still working"
// from "socket silently died" — the client stall watchdog keys off it. 15s sits
// comfortably under common 30–60s proxy idle timeouts.
export const CLAUDE_STREAM_HEARTBEAT_MS = 15000;
// A reused warm pool subprocess can die silently between turns (the model API
// socket drops, the OS reaps the child, or an internal CLI fault hasn't yet
// surfaced as an iterator throw). Its `isAlive()` flag still reads true, so
// acquire() hands it back and the pushed user message lands in an input stream
// nothing drains — the turn then hangs until the pool's 10-min hard timeout
// while server heartbeats keep the client's socket watchdog satisfied (so the
// existing stall-reconnect never fires either). getContextUsage() is a
// control-channel RPC, so a reused entry that can't answer within this window
// — and has emitted no turn frames — is treated as dead: we recycle it and
// respawn a fresh subprocess for one transparent retry. A false positive costs
// only one invisible respawn, not a broken turn.
export const CLAUDE_WARM_LIVENESS_PROBE_MS = 4000;
export const CLAUDE_WARM_MAX_RESPAWN = 1;
// How long a reused entry may stay silent after the prompt before the liveness
// probe above is issued. The probe cannot run up front: the CLI answers
// getContextUsage() on the same queue it accepts prompts on, taking ~1.4s on a
// warm subprocess, so probing first prepends that to every warm send. A healthy
// warm turn emits its first frame (hook events, then init) in ~0.2s, and even a
// cold-ish resume is well inside this window, so the probe only ever fires on a
// subprocess that really has gone quiet.
export const CLAUDE_WARM_SILENCE_BEFORE_PROBE_MS = 6000;
export async function createClaudeStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>, checkpoint?: Promise<TurnCheckpoint | null>): Promise<Response> {
    await ensureClaudePool();
    const userMessage = String(body.message ?? '').trim();
    const turnRequestId = parseTurnRequestId(body);
    const agentPolicy = parseClaudeAgentPolicy(body.claudeAgentPolicy);
    const explicitModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
    const isPendingSession = Boolean(body.isPendingSession);
    const manualPermissions = body.manualPermissions === true;
    const detachOnClientAbort = body.detachOnClientAbort === true;
    const permissionMode = agentPolicy?.permissionMode ?? parseClaudePermissionMode(body);
    // Leave model unset when the composer hasn't picked one yet — for both
    // pending and resumed sessions. The SDK/CLI already falls back to its own
    // configured default (respecting ANTHROPIC_MODEL, settings.json, or a
    // custom base URL/Bedrock/Vertex deployment) when `model` is omitted; a
    // hardcoded literal here would override that and throw "invalid model" on
    // machines where that literal isn't a recognized model id.
    const model = agentPolicy?.model ?? explicitModel;
    const fallbackModel = claudeFallbackModelChain();
    const effort = agentPolicy?.effort ?? parseEffort(body);
    const attachments = parseAttachments(body);
    // Input-box bash mode (`!command`) — runs locally then persists in the CLI's
    // native transcript shape. With attachments it falls back to a normal send.
    const bangShell = userMessage.startsWith('!') && attachments.length === 0
        ? userMessage.slice(1).trim()
        : null;
    if (bangShell !== null && !bangShell) {
        return Response.json({ error: 'Enter a shell command after !' }, { status: 400 });
    }
    const resumeSessionAt = typeof body.resumeSessionAt === 'string' ? body.resumeSessionAt : undefined;
    const resumeDropsTurn = typeof body.resumeDropsTurn === 'string' ? body.resumeDropsTurn : undefined;
    const forkSessionOnSend = Boolean(body.forkSession);
    const cwdOverride = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined;
    const taskBudgetTotal = typeof body.taskBudgetTokens === 'number' && body.taskBudgetTokens > 0
        ? Math.floor(body.taskBudgetTokens)
        : undefined;
    const maxBudgetUsd = typeof body.maxBudgetUsd === 'number' && Number.isFinite(body.maxBudgetUsd) && body.maxBudgetUsd > 0
        ? body.maxBudgetUsd
        : undefined;
    const enableWorkflow = body.enableWorkflow === true;
    // /add-dir: extra working-directory roots, fixed at spawn (no live control).
    const additionalDirectories = Array.isArray(body.additionalDirectories)
        ? body.additionalDirectories.filter((dir): dir is string => typeof dir === 'string' && dir.trim() !== '')
        : undefined;
    // Cold-path conditions: brand-new session (no id yet), fork (creates a new
    // conversation root), or rewind (changes the resume point). These mutate
    // the conversation root or don't have a stable id to key the pool on, so we
    // run the legacy single-shot query() and let the pool catch up on turn 2.
    // manualPermissions is no longer a cold-path trigger — the pool supports
    // per-turn bridges via the bridgeBox delegation pattern.
    //
    // Exception: a pending session that was already prewarmed (composer focus
    // triggers claudePoolModule().acquireClaudeSession with a forced `sessionId` — see
    // prewarmViewSession) has a warm entry sitting in the pool under this exact
    // id already. Route straight to the pooled path so the first real send
    // reuses it instead of cold-spawning a redundant second subprocess. If
    // prewarm hasn't completed yet (or never ran), peek finds nothing and this
    // falls through to the cold path exactly as before.
    const pendingWarmEntry = isPendingSession && !forkSessionOnSend && !resumeSessionAt
        ? claudePoolModule().peekClaudeSession(sessionId)
        : null;
    const useColdPath = (isPendingSession && !pendingWarmEntry) || forkSessionOnSend || Boolean(resumeSessionAt);
    if (useColdPath) {
        return createClaudeStreamCold({
            sessionId,
            signal,
            userMessage,
            attachments,
            bangShell,
            isPendingSession,
            permissionMode,
            manualPermissions,
            detachOnClientAbort,
            model,
            effort,
            resumeSessionAt,
            resumeDropsTurn,
            forkSessionOnSend,
            cwdOverride,
            taskBudgetTotal,
            maxBudgetUsd,
            enableWorkflow,
            additionalDirectories,
            turnRequestId,
            fallbackModel,
            agentPolicy,
            checkpoint,
        });
    }
    return createClaudeStreamPooled({
        sessionId,
        signal,
        userMessage,
        attachments,
        bangShell,
        permissionMode,
        manualPermissions,
        model,
        effort,
        cwdOverride,
        taskBudgetTotal,
        maxBudgetUsd,
        enableWorkflow,
        additionalDirectories,
        turnRequestId,
        fallbackModel,
        agentPolicy,
        checkpoint,
        // Threaded through even though the common case (prewarm already spawned
        // a compatible entry) never uses it — if the warm entry turns out
        // incompatible (cwd/effort/taskBudget changed since prewarm) or died,
        // claudePoolModule().acquireClaudeSession recycles and respawns; a pending session has
        // nothing on disk yet, so that respawn must still force `sessionId`
        // instead of trying to `resume` a conversation that doesn't exist.
        isPendingSession: isPendingSession && Boolean(pendingWarmEntry),
    });
}
export type ClaudeStreamColdArgs = {
    sessionId: string;
    signal: AbortSignal;
    userMessage: string;
    attachments: SendAttachment[];
    /** Non-null when the message is an input-box `!command` (bash mode). */
    bangShell: string | null;
    isPendingSession: boolean;
    permissionMode: ClaudePermissionMode | undefined;
    manualPermissions: boolean;
    detachOnClientAbort: boolean;
    model: string | undefined;
    effort: ReasoningEffortLevel | undefined;
    resumeSessionAt: string | undefined;
    resumeDropsTurn: string | undefined;
    forkSessionOnSend: boolean;
    cwdOverride: string | undefined;
    taskBudgetTotal: number | undefined;
    maxBudgetUsd: number | undefined;
    enableWorkflow: boolean;
    additionalDirectories: string[] | undefined;
    turnRequestId: string | undefined;
    fallbackModel: string | undefined;
    agentPolicy: ClaudeAgentPolicy | undefined;
    checkpoint?: Promise<TurnCheckpoint | null>;
};
export async function createClaudeStreamCold(args: ClaudeStreamColdArgs): Promise<Response> {
    const { sessionId, signal, userMessage, attachments, bangShell, isPendingSession, permissionMode, manualPermissions, detachOnClientAbort, model, effort, resumeSessionAt, resumeDropsTurn, forkSessionOnSend, cwdOverride, taskBudgetTotal, maxBudgetUsd, enableWorkflow, additionalDirectories, turnRequestId, fallbackModel, agentPolicy, checkpoint, } = args;
    // Build the user message in the same SDKUserMessage shape the pool uses,
    // and push it onto a queue-based input stream. Two reasons:
    //   1) The stream stays open after turn 1 ends, so the SDK's Query
    //      iterator stays open and we can hand the Query off to the pool.
    //   2) The pool can keep pushing future turns onto the same stream.
    // Bash mode (`!command`) defers its pushes until the command has run — see
    // the bang branch inside start() below.
    const { pushUserMessage, endInput, iterable } = claudePoolModule().createInputStream();
    let userMessageUuid: string | undefined;
    if (bangShell == null) {
        const message = await buildClaudeUserMessage(userMessage, attachments, cwdOverride);
        userMessageUuid = claudeUserMessageUuid(message);
        pushUserMessage(message);
    }
    const encoder = new TextEncoder();
    const abortController = new AbortController();
    const reportedPluginFailures = new Set<string>();
    // Snapshot of the options we constructed the Query with — passed to the
    // pool on adopt so future acquires can compatibility-check against it.
    const adoptOptions = {
        sessionId,
        cwd: cwdOverride,
        model,
        fallbackModel,
        permissionMode,
        effort,
        resumeSessionAt,
        forkSession: forkSessionOnSend,
        taskBudgetTokens: taskBudgetTotal,
        maxBudgetUsd,
        enableWorkflow,
        additionalDirectories,
        agentPolicy,
    };
    // Bridge is only needed for interactive approval modes; bypass and plan
    // handle all tool decisions automatically via permissionMode.
    const bridgeInstalled = manualPermissions
        && permissionMode !== 'bypassPermissions'
        && permissionMode !== 'plan';
    const stream = new ReadableStream({
        async start(controller) {
            const bridgedPermissionIds = new Set<string>();
            let downstreamClosed = false;
            let clientDetached = false;
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
            const coldDeltaCoalescer = createClaudeDeltaCoalescer(safeEnqueue);
            // Commit headers/body immediately, before CLI startup or initialization.
            // SSE comments are ignored by both clients and do not count as model output.
            safeEnqueue(':ok\n\n');
            // Named handler so we can detach it on successful adoption — otherwise a
            // post-turn client disconnect would abort the Query we just gave to the pool.
            const propagateAbort = () => {
                if (detachOnClientAbort) {
                    clientDetached = true;
                    downstreamClosed = true;
                    // The turn and its permission resolver remain alive. A replacement
                    // client retrieves the retained request through /running and answers
                    // it by id; navigation must not silently deny provider work.
                    return;
                }
                abortController.abort();
            };
            if (signal.aborted) {
                propagateAbort();
            }
            else {
                signal.addEventListener('abort', propagateAbort);
            }
            // Mutable per-turn bridge installed in the query at construction time so
            // the delegation closure survives pool adoption. The bridge is set below
            // (after q is created) and cleared in the finally block so future pool
            // turns can swap in a fresh bridge without recycling the subprocess.
            const bridgeBox: ClaudeBridgeBox = { fn: null, elicit: null, dialog: null };
            const viewerContext = {
                sessionId,
                getSessionId: () => viewerContext.sessionId,
                getCwd: () => cwdOverride,
            };
            const q = query({
                prompt: iterable,
                options: {
                    env: claudePoolModule().CLAUDE_QUERY_ENV,
                    stderr: (data) => claudePoolModule().logClaudeSubprocessStderr(sessionId, data),
                    ...(isPendingSession ? { sessionId } : { resume: sessionId }),
                    ...(cwdOverride ? { cwd: cwdOverride } : {}),
                    ...(model ? { model } : {}),
                    ...(fallbackModel ? { fallbackModel } : {}),
                    // An omitted mode starts in 'auto' on SDK 0.3.289+; ours means 'default'.
                    permissionMode: permissionMode ?? 'default',
                    // The SDK requires allowDangerouslySkipPermissions whenever
                    // permissionMode is 'bypassPermissions'; without it the query rejects
                    // on send and BYPASS appears broken. Mirror the CLI's
                    // --dangerously-skip-permissions guard.
                    ...(permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
                    canUseTool: (toolName, input, toolOpts) => bridgeBox.fn
                        ? bridgeBox.fn(toolName, input, toolOpts)
                        : Promise.resolve({ behavior: 'allow' as const, updatedInput: input }),
                    onElicitation: (request, elicitOpts) => bridgeBox.elicit
                        ? bridgeBox.elicit(request, elicitOpts)
                        : Promise.resolve({ action: 'decline' as const }),
                    onUserDialog: (request, dialogOpts) => bridgeBox.dialog
                        ? bridgeBox.dialog(request, dialogOpts)
                        : Promise.resolve({ behavior: 'cancelled' as const }),
                    supportedDialogKinds: ['refusal_fallback_prompt'],
                    ...claudePoolModule().claudeIntegratedQueryExtensions(viewerContext, sessionId),
                    ...claudeAgentPolicyOptions(agentPolicy),
                    ...claudePoolModule().effortToSdk(effort),
                    abortController,
                    ...claudeSessionPersistenceQueryOptions(),
                    ...claudeProcessSpawnOptions(),
                    resumeSessionAt,
                    ...(resumeDropsTurn ? { resumeDropsTurn } : {}),
                    forkSession: forkSessionOnSend,
                    includePartialMessages: true,
                    // Interrupt only the foreground turn; Agent Viewer already exposes
                    // background agents/workflows through Query.backgroundTasks().
                    perTaskStopAffordance: true,
                    agentProgressSummaries: true,
                    includeHookEvents: true,
                    promptSuggestions: true,
                    forwardSubagentText: true,
                    // Recorded for the conversation — see lib/claudePool.ts's spawn()
                    // for what that buys and what it costs. Both paths must agree, or a
                    // session's first (cold) turn would record a prompt the pooled turns
                    // then decline to reuse.
                    systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true, snapshot: true },
                    ...claudeQueryBudgetOptions(taskBudgetTotal, maxBudgetUsd),
                    ...(enableWorkflow ? { settings: { enableWorkflows: true } } : {}),
                    ...(additionalDirectories?.length ? { additionalDirectories } : {}),
                    // See lib/claudePool.ts's spawn() for why this needs no compat-check
                    // entry: a Coordinator-owned session's tools are bound once here, on
                    // its first (cold) turn, and never change for its lifetime.
                },
            });
            // Must be set BEFORE the for-await below, not before query() above —
            // the iterator drives SDK processing, so no tool call can arrive until
            // the first pull of the iterator at the for-await.
            if (bridgeInstalled) {
                bridgeBox.fn = createClaudePermissionBridge(sessionId, controller, encoder, bridgedPermissionIds);
            }
            // Elicitation isn't gated on manual permissions — an MCP server can elicit
            // in any mode, so always install the handler.
            bridgeBox.elicit = createClaudeElicitationBridge(sessionId, controller, encoder);
            bridgeBox.dialog = createClaudeUserDialogBridge(sessionId, controller, encoder);
            // While a bash-mode command runs locally, interrupt kills the child
            // process instead of poking the (idle) query.
            let killBangShell: (() => void) | null = null;
            const interruptTurn = async (cancelQueued = false) => {
                if (killBangShell) {
                    killBangShell();
                    return undefined;
                }
                // On interrupt_receipt_v1 CLIs this resolves to { still_queued }: uuids
                // of queued async messages that WILL still run unless cancelled.
                return await claudePoolModule().interruptClaudeQuery(q, cancelQueued);
            };
            setRunningSession(sessionId, {
                provider: 'claude',
                requestId: turnRequestId,
                interrupt: interruptTurn,
                background: () => q.backgroundTasks(),
                steer: async (text) => {
                    const message = await buildClaudeUserMessage(text, []);
                    pushUserMessage(message);
                    return claudeUserMessageUuid(message);
                },
            });
            // Keep the connection warm and the client's stall watchdog fed during the
            // cold path's first-token wait (the highest-latency window). Routed through
            // safeEnqueue so it no-ops once downstream closes.
            const heartbeat = setInterval(() => {
                safeEnqueue(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
            }, CLAUDE_STREAM_HEARTBEAT_MS);
            if (typeof heartbeat === 'object' && heartbeat && 'unref' in heartbeat) {
                (heartbeat as {
                    unref?: () => void;
                }).unref?.();
            }
            let emittedSessionEvent = false;
            let realizedSessionId: string | undefined;
            let adopted = false;
            let turnAccepted = false;
            const acceptTurn = (acceptedSessionId: string) => {
                if (turnAccepted)
                    return;
                turnAccepted = true;
                safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId: acceptedSessionId, provider: 'claude', messageUuid: userMessageUuid })}\n\n`);
            };
            let broadcastSessionId: string | undefined;
            let broadcastTurnStarted = false;
            const fallbackBroadcastSessionId = isPendingSession || forkSessionOnSend ? undefined : sessionId;
            const noteClaudeBroadcastSession = (nextSessionId: string | undefined): string | undefined => {
                if (!nextSessionId)
                    return undefined;
                if (!broadcastSessionId)
                    broadcastSessionId = nextSessionId;
                if (!broadcastTurnStarted) {
                    try {
                        broadcastClaudeTurnStart(broadcastSessionId);
                    }
                    catch { /* never let an observer break the send stream */ }
                    broadcastTurnStarted = true;
                }
                return broadcastSessionId;
            };
            // The bash-input push (shouldQuery:false) is acknowledged by the CLI with
            // an immediate empty result — swallow it so the client only sees the real
            // turn's result.
            let bangResultsToSkip = 0;
            try {
                if (bangShell != null) {
                    // Native order: the input entry is recorded at submit time, then the
                    // command runs, then its output entry starts the responding turn.
                    pushUserMessage(buildClaudeBashInputMessage(bangShell));
                    bangResultsToSkip = 1;
                    const bangResult = await runClaudeBangShellCommand(bangShell, cwdOverride, {
                        registerKill: (kill) => { killBangShell = kill; },
                    });
                    killBangShell = null;
                    safeEnqueue(claudeBashOutputEvent(bangShell, bangResult));
                    pushUserMessage(buildClaudeBashOutputMessage(bangResult));
                }
                // Do not put a control-channel usage RPC in front of the first model
                // event. The native CLI starts consuming the prompt immediately; the
                // usage frame is auxiliary and can be fetched concurrently.
                void q.getContextUsage({ detail: 'summary' })
                    .then((usage) => safeEnqueue(codexContextUsageToEventData(usage)))
                    .catch(() => { });
                await checkpoint?.catch(() => null);
                // This is the CLI's cold spawn — no pool watchdog covers it yet (that
                // only guards turns already adopted into claudePool). On a machine
                // where the subprocess hangs during startup (custom ANTHROPIC_MODEL
                // resolution, proxied base URL auth, Bedrock/Vertex discovery), the
                // stream would otherwise sit silent forever with no way for the
                // client to recover. Bound each message wait so a stuck first turn
                // fails into the existing isTransientSendError retry instead.
                const coldIterator = q[Symbol.asyncIterator]();
                while (true) {
                    const step = await withTimeout(coldIterator.next(), providerStartupTimeoutMs(model, 60000), 'Claude cold-start turn');
                    if (step.done)
                        break;
                    const msg = step.value;
                    const messageSessionId = typeof msg.session_id === 'string' && msg.session_id ? msg.session_id : undefined;
                    try {
                        claudePoolModule().reportClaudePluginLoadFailures(messageSessionId ?? realizedSessionId ?? sessionId, msg, reportedPluginFailures);
                    }
                    catch { /* attention bookkeeping must not stop the cold turn */ }
                    if (!emittedSessionEvent && messageSessionId) {
                        emittedSessionEvent = true;
                        realizedSessionId = messageSessionId;
                        viewerContext.sessionId = messageSessionId;
                        // The checkpoint was stamped with the id this turn was addressed
                        // to, but a cold resume realizes its own — and the viewer follows
                        // the realized one. Left alone, every turn's snapshot would be
                        // filed under a session that is no longer on screen, and the
                        // session's own turn list would come back empty.
                        if (messageSessionId !== sessionId && cwdOverride) {
                            void checkpoint
                                ?.then((snapshot) => snapshot && retagCheckpointSession(cwdOverride, snapshot, messageSessionId))
                                .catch(() => null);
                        }
                        // Mirror the registry entry under the realized id — a pending
                        // session registers under its draft id, but reattach polls and
                        // interrupts address the turn by the real id once it's known.
                        if (messageSessionId !== sessionId) {
                            setRunningSession(messageSessionId, {
                                provider: 'claude',
                                requestId: turnRequestId,
                                interrupt: interruptTurn,
                                background: () => q.backgroundTasks(),
                                steer: async (text) => {
                                    const message = await buildClaudeUserMessage(text, []);
                                    pushUserMessage(message);
                                    return claudeUserMessageUuid(message);
                                },
                            });
                        }
                        safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId: messageSessionId })}\n\n`);
                    }
                    if (msg.type === 'result' && bangResultsToSkip > 0) {
                        bangResultsToSkip -= 1;
                        continue;
                    }
                    const eventSessionId = noteClaudeBroadcastSession(messageSessionId ?? fallbackBroadcastSessionId);
                    if (eventSessionId) {
                        try {
                            broadcastClaudeMessage(eventSessionId, msg.type);
                        }
                        catch { /* observer-only signal */ }
                    }
                    if (msg.type === 'user')
                        await claudeArtifactStore.capture(messageSessionId ?? sessionId, msg).catch(() => { });
                    noteClaudeCommandsChanged(messageSessionId ?? sessionId, msg);
                    const resultError = msg.type === 'result'
                        ? claudeResultErrorMessage(msg as unknown as Record<string, unknown>)
                        : null;
                    if (!resultError)
                        acceptTurn(messageSessionId ?? realizedSessionId ?? sessionId);
                    coldDeltaCoalescer.emit(msg);
                    // Break after the result so we can adopt the Query into the pool.
                    // The pool's pump loop takes over consuming for any tail messages
                    // (notably prompt_suggestion, which the SDK emits after `result`)
                    // and for future turns.
                    if (msg.type === 'result') {
                        if (resultError) {
                            safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: resultError.message, apiErrorStatus: resultError.apiErrorStatus, usageLimit: resultError.usageLimit })}\n\n`);
                        }
                        break;
                    }
                }
                // Adopt into the pool when we can: a clean result was seen, the
                // session_id is known, and the client hasn't disconnected. The bridge
                // is now cleared before adoption — the query's canUseTool delegates
                // through bridgeBox.fn which will be set fresh for each future turn.
                if (realizedSessionId && !abortController.signal.aborted) {
                    // Clear the turn-1 bridge so the pool entry starts idle.
                    bridgeBox.fn = null;
                    bridgeBox.elicit = null;
                    bridgeBox.dialog = null;
                    signal.removeEventListener('abort', propagateAbort);
                    claudePoolModule().adoptClaudeSession({
                        sessionId: realizedSessionId,
                        query: q,
                        pushUserMessage,
                        endInput,
                        options: { ...adoptOptions, sessionId: realizedSessionId },
                        bridgeBox,
                        reportedPluginFailures,
                    });
                    adopted = true;
                }
            }
            catch (err) {
                if (!abortController.signal.aborted && !clientDetached) {
                    safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: friendlyClaudePoolError(err) })}\n\n`);
                }
            }
            finally {
                coldDeltaCoalescer.flush();
                clearInterval(heartbeat);
                // Clear the bridge in case adoption didn't happen (error, abort) so the
                // box isn't left pointing at a dead stream controller.
                bridgeBox.fn = null;
                bridgeBox.elicit = null;
                bridgeBox.dialog = null;
                clearRunningSession(sessionId, turnRequestId);
                if (realizedSessionId && realizedSessionId !== sessionId)
                    clearRunningSession(realizedSessionId, turnRequestId);
                resolvePendingClaudePermissions(sessionId, bridgedPermissionIds, 'Permission request ended before a response was received');
                if (!adopted) {
                    signal.removeEventListener('abort', propagateAbort);
                    q.close();
                }
                if (broadcastSessionId && broadcastTurnStarted) {
                    try {
                        broadcastClaudeTurnEnd(broadcastSessionId);
                    }
                    catch { /* observer-only signal */ }
                }
                if (broadcastSessionId && !adopted) {
                    try {
                        broadcastClaudeRecycled(broadcastSessionId);
                    }
                    catch { /* observer-only signal */ }
                }
                if (!downstreamClosed) {
                    try {
                        controller.close();
                    }
                    catch { /* downstream already closed */ }
                }
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
export type ClaudeStreamPooledArgs = {
    sessionId: string;
    signal: AbortSignal;
    userMessage: string;
    attachments: SendAttachment[];
    /** Non-null when the message is an input-box `!command` (bash mode). */
    bangShell: string | null;
    permissionMode: ClaudePermissionMode | undefined;
    manualPermissions: boolean;
    model: string | undefined;
    effort: ReasoningEffortLevel | undefined;
    cwdOverride: string | undefined;
    taskBudgetTotal: number | undefined;
    maxBudgetUsd: number | undefined;
    enableWorkflow: boolean;
    additionalDirectories: string[] | undefined;
    turnRequestId: string | undefined;
    fallbackModel: string | undefined;
    agentPolicy: ClaudeAgentPolicy | undefined;
    /** See ClaudePoolAcquireOptions.isPendingSession. Only relevant if the entry needs a fresh spawn. */
    isPendingSession?: boolean;
    checkpoint?: Promise<unknown>;
};
export async function createClaudeStreamPooled(args: ClaudeStreamPooledArgs): Promise<Response> {
    const { sessionId, signal, userMessage, attachments, bangShell, permissionMode, manualPermissions, model, effort, cwdOverride, taskBudgetTotal, maxBudgetUsd, enableWorkflow, additionalDirectories, isPendingSession, turnRequestId, fallbackModel, agentPolicy, checkpoint, } = args;
    // Bash mode builds its own transcript-shaped messages after the command runs.
    let pushMessage: SDKUserMessage | null = null;
    if (bangShell == null) {
        try {
            pushMessage = await buildClaudeUserMessage(userMessage, attachments, cwdOverride);
        }
        catch (err) {
            return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to build prompt' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            // Per-stream state that survives a warm respawn. The pooled path never
            // pends, so the session id is fixed for the whole stream — running-session
            // registration, permission cleanup, and the session frame all key off
            // `sessionId` directly rather than a particular pool entry.
            const bridgedPermissionIds = new Set<string>();
            const poolDeltaCoalescer = createClaudeDeltaCoalescer((chunk) => controller.enqueue(encoder.encode(chunk)));
            const bridgeInstalled = manualPermissions
                && permissionMode !== 'bypassPermissions'
                && permissionMode !== 'plan';
            const bridge = bridgeInstalled
                ? createClaudePermissionBridge(sessionId, controller, encoder, bridgedPermissionIds)
                : undefined;
            // Elicitation isn't gated on manual permissions — install it every turn.
            const elicit = createClaudeElicitationBridge(sessionId, controller, encoder);
            const dialog = createClaudeUserDialogBridge(sessionId, controller, encoder);
            // Decouple the turn lifecycle from this HTTP request. A client disconnect
            // (tab closed, navigation, network blip) must NOT interrupt an in-flight
            // turn — the pool keeps draining the Query, the turn completes, messages
            // persist, and the Claude harness keeps observers' transcripts live so a
            // reconnect immediately resumes streaming. Explicit cancellation is a
            // separate, deliberate action that flows through the /interrupt route
            // (→ getRunningSession().interrupt()), not a side effect of disconnecting.
            const turnAbort = new AbortController();
            // While a bash-mode (`!command`) child process runs, this kills it —
            // consulted by the running-session interrupt closure below.
            let killBangShell: (() => void) | null = null;
            // We already know the session id — emit immediately so the client doesn't
            // have to wait for the SDK's init message.
            controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`));
            // Keep the connection warm and the client's stall watchdog fed while the
            // turn runs. Heartbeats are best-effort: a throw means downstream closed,
            // which the turn-decoupling logic already tolerates.
            const heartbeat = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`));
                }
                catch { /* downstream closed; turn keeps running in the pool */ }
            }, CLAUDE_STREAM_HEARTBEAT_MS);
            if (typeof heartbeat === 'object' && heartbeat && 'unref' in heartbeat) {
                (heartbeat as {
                    unref?: () => void;
                }).unref?.();
            }
            const emitUsage = (usage: ContextUsage) => {
                try {
                    controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)));
                }
                catch { /* downstream already closed */ }
            };
            // Liveness probe for a reused warm entry. NOTE the scheduling: this must
            // never be issued *before* the user's message. getContextUsage() is a
            // control request the CLI answers on the same queue it uses to accept a
            // prompt, and on a warm subprocess it takes ~1.4s — so probing first put
            // that 1.4s in front of every single warm send (measured: first frame
            // 1.3s vs 0.2s, whole turn 3.3s vs 1.8s against the native CLI). The
            // probe is a backstop for a subprocess that has silently died, and a
            // dead subprocess produces no frames at all, so it loses nothing by
            // running only once the turn has gone quiet for longer than a healthy
            // turn ever takes to say something. If it cannot answer, the caller
            // first asks the SDK to reinitialize its transport; only a failed
            // reconnect pays the subprocess-respawn cost.
            const probeWarmLiveness = (e: ClaudePoolEntry): Promise<'live' | 'dead'> => {
                let timer: ReturnType<typeof setTimeout> | null = null;
                const timeout = new Promise<'dead'>((resolve) => {
                    timer = setTimeout(() => resolve('dead'), CLAUDE_WARM_LIVENESS_PROBE_MS);
                    if (typeof timer === 'object' && timer && 'unref' in timer) {
                        (timer as {
                            unref?: () => void;
                        }).unref?.();
                    }
                });
                // `summary` detail (SDK 0.3.261) skips the per-category token-count
                // calls. The probe only needs the subprocess to answer at all, and a
                // cheaper answer is one that more often beats CLAUDE_WARM_LIVENESS_PROBE_MS.
                const answered: Promise<'live' | 'dead'> = e.query.getContextUsage({ detail: 'summary' }).then((usage) => { emitUsage(usage); return 'live'; }, () => 'dead');
                return Promise.race([answered, timeout]).finally(() => { if (timer)
                    clearTimeout(timer); });
            };
            let attempt = 0;
            let turnAccepted = false;
            // Set per attempt by the warm-entry branch below. armWarmProbe runs when
            // the message actually reaches the subprocess; the first frame after that
            // cancels the pending probe, so a healthy turn never issues it.
            let armWarmProbe: (() => void) | null = null;
            let cancelWarmProbe: (() => void) | null = null;
            let runWarmProbe: () => Promise<void> = async () => { };
            try {
                while (true) {
                    attempt += 1;
                    let entry: ClaudePoolEntry;
                    try {
                        entry = claudePoolModule().acquireClaudeSession({
                            sessionId,
                            cwd: cwdOverride,
                            model,
                            fallbackModel,
                            permissionMode,
                            effort,
                            taskBudgetTokens: taskBudgetTotal,
                            maxBudgetUsd,
                            enableWorkflow,
                            additionalDirectories,
                            agentPolicy,
                            isPendingSession,
                        });
                    }
                    catch (err) {
                        if (!signal.aborted) {
                            try {
                                controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`));
                            }
                            catch { /* ignore */ }
                        }
                        break;
                    }
                    const activeEntry = entry;
                    setRunningSession(sessionId, {
                        provider: 'claude',
                        requestId: turnRequestId,
                        // While a bash-mode command runs locally, interrupt kills the child
                        // process instead of poking the (idle) query.
                        interrupt: async (cancelQueued = false) => {
                            if (killBangShell) {
                                killBangShell();
                                return undefined;
                            }
                            return await claudePoolModule().interruptClaudeQuery(activeEntry.query, cancelQueued);
                        },
                        background: () => activeEntry.query.backgroundTasks(),
                        // Mid-turn user input rides the warm query's persistent input stream —
                        // the CLI queues it as steering, exactly like typing in Claude Code.
                        steer: async (text) => {
                            const message = await buildClaudeUserMessage(text, []);
                            activeEntry.pushUserMessage(message);
                            return claudeUserMessageUuid(message);
                        },
                    });
                    let sawActivity = false;
                    // Distinct from sawActivity: run() replays messages buffered since
                    // the last turn before it submits, and a replayed frame proves
                    // nothing about whether the subprocess is still answering *now*.
                    // Only frames seen after onSubmitted retire the liveness probe.
                    let sawFrameSinceSubmit = false;
                    // Set when we deliberately recycle a dead-looking warm entry, so the
                    // catch below knows the run() rejection is our own doing — not a real
                    // turn failure to surface — and the retry path stays silent.
                    let respawnRequested = false;
                    if (activeEntry.reused && attempt <= CLAUDE_WARM_MAX_RESPAWN) {
                        armWarmProbe = () => {
                            // Replay happens before submission, so anything it set is stale.
                            sawFrameSinceSubmit = false;
                            let cancelled = false;
                            let probeTimer: ReturnType<typeof setTimeout> | null = null;
                            const scheduleProbe = () => {
                                if (cancelled || sawFrameSinceSubmit)
                                    return;
                                probeTimer = setTimeout(() => {
                                    probeTimer = null;
                                    if (cancelled || sawFrameSinceSubmit)
                                        return;
                                    void runWarmProbe();
                                }, CLAUDE_WARM_SILENCE_BEFORE_PROBE_MS);
                                if (typeof probeTimer === 'object' && probeTimer && 'unref' in probeTimer) {
                                    (probeTimer as {
                                        unref?: () => void;
                                    }).unref?.();
                                }
                            };
                            cancelWarmProbe = () => {
                                cancelled = true;
                                if (probeTimer)
                                    clearTimeout(probeTimer);
                            };
                            if (activeEntry.isInitialized()) {
                                scheduleProbe();
                                return;
                            }
                            // A selection-time prewarm places the Query in the pool as soon
                            // as the subprocess is spawned, before initialize has answered.
                            // Slow custom endpoints can legitimately stay in that state for
                            // tens of seconds. Do not run the dead-process probe until the
                            // warmup has either completed or exceeded its bounded startup
                            // allowance; otherwise the probe/reinitialize cycle kills a
                            // healthy custom-model boot around the 10–14 second mark.
                            void withTimeout(activeEntry.whenInitialized(), providerStartupTimeoutMs(model), 'Claude warm initialization').then(scheduleProbe, () => {
                                if (!cancelled && !sawFrameSinceSubmit)
                                    void runWarmProbe();
                            });
                        };
                        runWarmProbe = async () => {
                            const verdict = await probeWarmLiveness(activeEntry);
                            if (verdict !== 'dead' || sawFrameSinceSubmit)
                                return;
                            let timer: ReturnType<typeof setTimeout> | null = null;
                            const timeout = new Promise<false>((resolve) => {
                                timer = setTimeout(() => resolve(false), CLAUDE_WARM_LIVENESS_PROBE_MS);
                                if (typeof timer === 'object' && timer && 'unref' in timer) {
                                    (timer as {
                                        unref?: () => void;
                                    }).unref?.();
                                }
                            });
                            const reinitialized = Promise.resolve()
                                .then(() => activeEntry.query.reinitialize())
                                .then(() => true, () => false);
                            const recovered = await Promise.race([reinitialized, timeout]).finally(() => {
                                if (timer)
                                    clearTimeout(timer);
                            });
                            if (recovered || sawFrameSinceSubmit)
                                return;
                            respawnRequested = true;
                            // Recycling pushes null to the turn subscriber, so the pending
                            // run() below rejects promptly — caught and respawned fresh.
                            claudePoolModule().recycleClaudeSession(sessionId);
                        };
                    }
                    const onTurnMessage = (msg: SDKMessage) => {
                        // Any frame proves the subprocess is alive — cancels a pending
                        // dead verdict so a slow-but-healthy turn is never respawned, and
                        // retires the scheduled liveness probe before it can be issued.
                        sawActivity = true;
                        if (!sawFrameSinceSubmit) {
                            sawFrameSinceSubmit = true;
                            cancelWarmProbe?.();
                            cancelWarmProbe = null;
                        }
                        const usage = claudeResultContextUsage(msg);
                        if (usage)
                            emitUsage(usage);
                        try {
                            const resultError = claudeResultErrorMessage(msg as unknown as Record<string, unknown>);
                            if (!turnAccepted && !resultError) {
                                turnAccepted = true;
                                controller.enqueue(encoder.encode(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId, provider: 'claude', messageUuid: pushMessage ? claudeUserMessageUuid(pushMessage) : undefined })}\n\n`));
                            }
                            poolDeltaCoalescer.emit(msg);
                            if (resultError) {
                                controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: resultError.message, apiErrorStatus: resultError.apiErrorStatus, usageLimit: resultError.usageLimit })}\n\n`));
                            }
                        }
                        catch {
                            /* downstream closed; ignore — the turn keeps running in the pool */
                        }
                    };
                    const onBufferedTurnMessage = (msg: SDKMessage) => {
                        // Catch-up frames were produced before this prompt reached the
                        // subprocess. Forward useful output/usage, but never use them to
                        // acknowledge the new turn, retire its liveness probe, or suppress
                        // a safe pre-output retry.
                        const usage = claudeResultContextUsage(msg);
                        if (usage)
                            emitUsage(usage);
                        try {
                            poolDeltaCoalescer.emit(msg);
                        }
                        catch { /* downstream closed */ }
                    };
                    const onTurnError = (_err: Error) => {
                        // A respawn we triggered ourselves already recycled the entry.
                        if (respawnRequested)
                            return;
                        // Drop the dead entry so the next acquire — whether the retry
                        // below or a later turn — gets a fresh subprocess. run() always
                        // rejects with this same error right after calling onError, so
                        // the outer catch below is the single place that decides
                        // whether to retry silently or surface something to the client;
                        // surfacing here too would leak a raw pool-internal message even
                        // on attempts that go on to retry invisibly.
                        claudePoolModule().recycleClaudeSession(sessionId);
                    };
                    try {
                        await checkpoint?.catch(() => null);
                        if (bangShell != null) {
                            // Input-box bash mode, in the CLI's native order: persist the
                            // input entry silently (its empty ack result is not forwarded),
                            // run the command locally, then persist the output entry — which
                            // starts the turn where Claude responds to the output.
                            await activeEntry.run(buildClaudeBashInputMessage(bangShell), {
                                signal: turnAbort.signal,
                                model,
                                onMessage: (msg) => {
                                    sawActivity = true;
                                    if ((msg as {
                                        type?: string;
                                    }).type === 'result')
                                        return;
                                    onTurnMessage(msg);
                                },
                                onBufferedMessage: (msg) => {
                                    if ((msg as {
                                        type?: string;
                                    }).type === 'result')
                                        return;
                                    onBufferedTurnMessage(msg);
                                },
                                onError: onTurnError,
                                onSubmitted: () => armWarmProbe?.(),
                            });
                            const bangResult = await runClaudeBangShellCommand(bangShell, cwdOverride, {
                                registerKill: (kill) => { killBangShell = kill; },
                            });
                            killBangShell = null;
                            try {
                                controller.enqueue(encoder.encode(claudeBashOutputEvent(bangShell, bangResult)));
                            }
                            catch { /* client gone — the persisted entry still lands */ }
                            await activeEntry.run(buildClaudeBashOutputMessage(bangResult), {
                                signal: turnAbort.signal,
                                model,
                                bridge,
                                elicit,
                                dialog,
                                onMessage: onTurnMessage,
                                onBufferedMessage: onBufferedTurnMessage,
                                onError: onTurnError,
                                onSubmitted: () => armWarmProbe?.(),
                            });
                        }
                        else {
                            await activeEntry.run(pushMessage!, {
                                signal: turnAbort.signal,
                                model,
                                bridge,
                                elicit,
                                dialog,
                                onMessage: onTurnMessage,
                                onBufferedMessage: onBufferedTurnMessage,
                                onError: onTurnError,
                                onSubmitted: () => armWarmProbe?.(),
                            });
                        }
                        break;
                    }
                    catch (err) {
                        // Transparent recovery: nothing was ever shown to the client for
                        // this attempt, so a fresh acquire+retry is invisible to them
                        // aside from a small added delay. Covers both our own proactive
                        // dead-entry respawn (respawnRequested) and a reused/fresh entry
                        // that simply threw on its own (unexpected subprocess death, the
                        // inactivity hard-timeout firing before any output, etc.) — the
                        // failure mode doesn't matter when there's nothing to lose by
                        // retrying once. Once activity was seen, a retry could duplicate
                        // or contradict what the client already rendered, so that case
                        // always surfaces (below) instead.
                        if (!sawActivity && attempt <= CLAUDE_WARM_MAX_RESPAWN) {
                            if (!respawnRequested)
                                claudePoolModule().recycleClaudeSession(sessionId);
                            continue;
                        }
                        if (!signal.aborted) {
                            try {
                                controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: friendlyClaudePoolError(err) })}\n\n`));
                            }
                            catch {
                                /* ignore */
                            }
                        }
                        break;
                    }
                }
            }
            finally {
                try {
                    poolDeltaCoalescer.flush();
                }
                catch { /* downstream closed */ }
                clearInterval(heartbeat);
                clearRunningSession(sessionId, turnRequestId);
                resolvePendingClaudePermissions(sessionId, bridgedPermissionIds, 'Permission request ended before a response was received');
                try {
                    controller.close();
                }
                catch { /* idempotent */ }
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
    const provider = "claude";
    await ensureClaudePool();
    {
        const warm = claudePoolModule().peekClaudeSession(params.sessionId);
        if (warm) {
            // Re-acquire with the latest composer model/effort. acquire() queues
            // live-settable changes onto the entry's configuration gate; awaiting
            // that gate here lets selection-time prewarm absorb a slow custom-model
            // switch, while runTurn independently waits the same gate if the user
            // presses Enter before this request returns.
            const entry = claudePoolModule().acquireClaudeSession({
                sessionId: params.sessionId,
                cwd: params.cwd,
                model: params.model,
                fallbackModel: claudeFallbackModelChain(),
                effort: params.effort,
                isPendingSession: params.isPending,
            });
            await withTimeout(Promise.all([entry.whenInitialized(), entry.whenConfigured()]).then(() => undefined), providerStartupTimeoutMs(params.model), 'Claude session prewarm');
            return;
        }
        // The SDK's `sessionId` create-time option forces the CLI to adopt the
        // client's own pending UUID as its real session id — spawning now (while
        // the user is still typing their first message) runs the CLI's
        // SessionStart hooks and MCP init in the background instead of eating
        // the delay synchronously after they hit send. createClaudeStream picks
        // this warm entry up via the pooled path once a message actually arrives
        // (see the pendingWarm check there); if it isn't ready in time, the cold
        // path spawns fresh exactly as before — no regression either way.
        // Spawning resumes the session, which rewrites its transcript and moves its
        // mtime even though nothing was said. Callers should defer existing-session
        // prewarm until the composer is engaged; record the touch as a fallback for
        // any other caller (lib/claudeResumeTouch.ts). A pending session has no
        // transcript to touch.
        const spawn = async () => {
            const entry = claudePoolModule().acquireClaudeSession({
                sessionId: params.sessionId,
                cwd: params.cwd,
                // Leave model unset when not provided — see createClaudeStream for why
                // a hardcoded literal breaks custom-model deployments.
                model: params.model,
                fallbackModel: claudeFallbackModelChain(),
                effort: params.effort,
                isPendingSession: params.isPending,
            });
            await withTimeout(Promise.all([entry.whenInitialized(), entry.whenConfigured()]).then(() => undefined), providerStartupTimeoutMs(params.model), 'Claude session prewarm');
        };
        if (params.isPending)
            await spawn();
        else
            await withClaudeResumeTouchRecorded(params.sessionId, spawn);
        return;
    }
}
/** Existing SDK dispatch, reached only through bundled extension runtime entries. */
export async function streamTurn(params: SendMessageParams, checkpoint?: Promise<TurnCheckpoint | null>): Promise<Response> {
    const provider = "claude";
    {
        return createClaudeStream(params.sessionId, params.signal, params.body, checkpoint);
    }
}
export async function forkSession({ sessionId, body, provider }: ForkParams): Promise<{
    sessionId: string;
}> {
    const resolvedProvider = "claude";
    const result = await forkClaudeSession(sessionId, {
        title: typeof body.title === 'string' ? body.title : undefined,
        upToMessageId: typeof body.upToMessageId === 'string' ? body.upToMessageId : undefined,
        ...claudeSessionStoreOptions(),
    });
    return { sessionId: result.sessionId };
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
    const provider = "claude";
    const resolvedCwd = (cwd && cwd.trim()) ? cwd : process.cwd();
    {
        const { randomUUID } = await import('node:crypto');
        return { sessionId: randomUUID(), provider: "claude", cwd: resolvedCwd, isPending: true };
    }
}
/** Release provider-side resources for an active session without deleting its durable history. */
export async function closeSession(sessionId: string, providerOverride?: AgentProvider): Promise<void> {
    const provider = "claude";
    await ensureClaudePool();
    {
        claudePoolModule().recycleClaudeSession(sessionId);
        return;
    }
}
export function listPendingPermissions(sessionId: string, provider?: AgentProvider): Record<string, unknown>[] {
    {
        return [
            ...listPendingClaudePrompts(sessionId).map((data) => ({
                type: 'claude_permission',
                event: { type: 'permission.requested', data },
            })),
            ...listPendingClaudeElicitations(sessionId).map((data) => ({
                type: 'claude_elicitation',
                event: { type: 'elicitation.requested', data },
            })),
        ];
    }
}
/** Process-local control-plane state for fleet and attention clients. */
export async function rewindSession({ sessionId, body, provider }: RewindParams): Promise<Record<string, unknown>> {
    const resolvedProvider = "claude";
    await ensureClaudePool();
    const userMessageId = typeof body.userMessageId === 'string' ? body.userMessageId : undefined;
    const model = typeof body.model === 'string' ? body.model : undefined;
    if (!userMessageId) {
        throw new Error('userMessageId is required');
    }
    if (claudeSessionStoreOptions().sessionStore) {
        throw new Error('File rewind is unavailable while the Claude SQLite session store is enabled; the Agent SDK does not mirror checkpoint blobs');
    }
    const q = createSessionControlQuery(sessionId, model);
    try {
        await q.initializationResult();
        const result = await q.rewindFiles(userMessageId, { dryRun: Boolean(body.dryRun) });
        if (!body.dryRun && result.canRewind && result.filesChanged?.length) {
            const info = await getSessionInfo(sessionId, claudeSessionStoreOptions()).catch(() => undefined);
            if (info?.cwd) {
                const observedPaths = await readClaudeObservedFilePaths(sessionId, info.cwd).catch(() => []);
                await claudePoolModule().queueClaudeReadStateSeeds(sessionId, info.cwd, observedPaths);
            }
        }
        return result;
    }
    finally {
        q.close();
    }
}
export function readMemoryDiagnostics(): Record<string, number> {
    return {
        pendingClaudePermissions: pendingClaudePermissions.size,
        pendingClaudeElicitations: pendingClaudeElicitations.size,
        pendingClaudeDialogs: pendingClaudeDialogs.size,
        // Not loaded means no pool exists, so its size is genuinely zero — this
        // must not be the thing that drags the pool into a diagnostics read.
        claudePool: claudePoolIfLoaded()?.claudePoolSize() ?? 0
    };
}

import type { ProviderRuntime } from '../types'
export const runtime = {
  async afterFileRestore({ sessionId, cwd }: { sessionId: string; cwd: string }) {
    const observedPaths = await readClaudeObservedFilePaths(sessionId, cwd).catch(() => []);
    await ensureClaudePool();
    await claudePoolModule().queueClaudeReadStateSeeds(sessionId, cwd, observedPaths);
  },
  createSession: createSession,
  streamTurn: streamTurn,
  prewarm: prewarm,
  runAction: runAction,
  forkSession: forkSession,
  rewindSession: rewindSession,
  closeSession: closeSession,
  listPendingPermissions: listPendingPermissions,
  listPendingPrompts: listPendingClaudePrompts,
  getMemoryDiagnostics: readMemoryDiagnostics,
} satisfies ProviderRuntime
