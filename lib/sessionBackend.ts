// Provider architecture extraction: SDK behavior preserved from the session backend.
import { steerViewSession } from './sessionSteering'
import { listPendingProviderPermissionPayloads } from './sessionControlPlane'
import { getProviderRuntime } from "./extensions/providers/registry";
import type { ProviderCreateRequest, ProviderPrewarmRequest, ProviderSessionRequest } from "./extensions/providers/types";
import { projectComposerContext } from "./composerContext";
import { coordinatorPermissionToken } from "./coordinatorNativePermission";
import { extractPendingPermissions } from "./permissions";
import { recordContextTransfer } from "./contextTransfers";
import { PendingRequestGoneError } from "./pendingRequestGone";
import { interruptRunningSession } from "./sessionRuntime";
import { createTurnCheckpoint } from "./checkpoints";
import { currentProviderInstanceId } from "./providerInstances";
import { updateSessionInboxState } from "./sessionInbox";
import type { AgentProvider, SendAttachment } from "./types";
// The read half of this router lives in lib/sessionReads.ts, which deliberately
// imports no provider client, SDK, or send-path module: reading a session used
// to evaluate the machinery for sending one (~72MB of footprint against ~16MB),
// and the TUI's transcript Worker is a separate JS VM that only ever reads.
// Re-exported here so every existing caller of sessionBackend is unaffected.
import { resolveProvider } from "./sessionReads";
type SendMessageParams = {
    sessionId: string;
    signal: AbortSignal;
    body: Record<string, unknown>;
    provider?: AgentProvider;
};
type ForkParams = {
    sessionId: string;
    body: Record<string, unknown>;
    provider?: AgentProvider;
};
export async function streamViewSessionTurn(params: SendMessageParams): Promise<Response> {
    try {
        const raw = Array.isArray(params.body.attachments) ? params.body.attachments.filter((a): a is SendAttachment => !!a && typeof a === 'object') : [];
        const projected = projectComposerContext(String(params.body.message ?? ''), raw);
        params = { ...params, body: { ...params.body, message: projected.text, attachments: projected.attachments } };
    }
    catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Invalid context' }, { status: 400 });
    }
    const userMessage = String(params.body.message ?? '').trim();
    if (!userMessage) {
        return Response.json({ error: 'message is required' }, { status: 400 });
    }
    const provider = await resolveProvider(params.provider);
    void updateSessionInboxState({
        provider,
        sessionId: params.sessionId,
        providerInstanceId: currentProviderInstanceId(provider),
        action: 'reopen',
    }).catch(() => { });
    // Start the checkpoint immediately, but overlap it with provider setup. Each
    // provider awaits it at the final turn-submission boundary, preserving the
    // race-free "snapshot before agent writes" guarantee without making the UI
    // wait through all Git work before it can open the SSE stream.
    const checkpointCwd = typeof params.body.cwd === 'string' && params.body.cwd.trim()
        ? params.body.cwd.trim()
        : null;
    const checkpoint = checkpointCwd
        ? createTurnCheckpoint(checkpointCwd, {
            sessionId: params.sessionId,
            provider,
            message: userMessage,
        }).catch(() => null)
        : undefined;
    const runtime = await getProviderRuntime(provider);
    return runtime.streamTurn({ ...params, provider, providerInstanceId: currentProviderInstanceId(provider) }, checkpoint);
}
export async function forkViewSession(params: ForkParams): Promise<{
    sessionId: string;
}> {
    const provider = await resolveProvider(params.provider);
    const runtime = await getProviderRuntime(provider);
    if (!runtime.forkSession)
        throw new Error(`forkSession is not supported for ${provider} sessions`);
    const forked = await runtime.forkSession({ ...params, provider, providerInstanceId: currentProviderInstanceId(provider) });
    recordContextTransfer({
        type: 'fork',
        source: {
            provider,
            sessionId: params.sessionId,
            point: typeof params.body.upToMessageId === 'string' ? params.body.upToMessageId : undefined,
        },
        target: { provider, sessionId: forked.sessionId },
        strategy: 'native',
    });
    return forked;
}
/**
 * Interrupt the session's running turn. Returns the uuids of queued async
 * messages that survive the interrupt (Claude interrupt_receipt_v1), or
 * undefined when the provider has no receipt.
 */
export async function interruptViewSession(sessionId: string, turnRequestId?: string, cancelQueued = false): Promise<string[] | undefined> {
    const receipt = await interruptRunningSession(sessionId, turnRequestId, cancelQueued);
    const stillQueued = (receipt as {
        still_queued?: unknown;
    } | undefined)?.still_queued;
    return Array.isArray(stillQueued)
        ? stillQueued.filter((uuid): uuid is string => typeof uuid === 'string')
        : undefined;
}
// Extension-neutral public lifecycle entry points. The host resolves provider
// identity once; implementations run inside the caller's instance scope.
export async function runViewSessionAction(params: ProviderSessionRequest): Promise<Record<string, unknown>> {
    const provider = await resolveProvider(params.provider);
    if (params.body.action === 'steer')
        return steerViewSession(params.sessionId, params.body, provider);
    const runtime = await getProviderRuntime(provider);
    if ((params.body.action === 'respondPermission' || params.body.action === 'respondQuestion') && typeof params.body.expectedPermissionToken === 'string') {
        const pending = extractPendingPermissions(listPendingProviderPermissionPayloads(params.sessionId, provider), { sessionId: params.sessionId, provider });
        if (!pending.some(permission => permission.id === params.body.permissionId && coordinatorPermissionToken(permission) === params.body.expectedPermissionToken)) {
            throw new PendingRequestGoneError(params.body.action === 'respondQuestion' ? 'Question' : 'Permission request');
        }
    }
    if (!runtime.runAction)
        throw new Error(`runAction is not supported for ${provider} sessions`);
    return runtime.runAction({ ...params, provider, providerInstanceId: currentProviderInstanceId(provider) });
}
export async function prewarmViewSession(params: ProviderPrewarmRequest): Promise<void> {
    const provider = await resolveProvider(params.provider);
    const runtime = await getProviderRuntime(provider);
    await runtime.prewarm?.({ ...params, provider, providerInstanceId: currentProviderInstanceId(provider) });
}
export async function createNewViewSession(params: ProviderCreateRequest) {
    const provider = await resolveProvider(params.provider);
    const runtime = await getProviderRuntime(provider);
    return runtime.createSession({ ...params, provider, providerInstanceId: currentProviderInstanceId(provider) });
}
export async function closeViewSession(sessionId: string, providerOverride?: AgentProvider): Promise<void> {
    const provider = await resolveProvider(providerOverride);
    const runtime = await getProviderRuntime(provider);
    await interruptViewSession(sessionId, undefined, true).catch(() => { });
    await runtime.closeSession(sessionId, provider, currentProviderInstanceId(provider));
}
export async function rewindOrRollbackViewSession(params: ProviderSessionRequest): Promise<Record<string, unknown>> {
    const provider = await resolveProvider(params.provider);
    const runtime = await getProviderRuntime(provider);
    if (!runtime.rewindSession)
        throw new Error(`rewindSession is not supported for ${provider} sessions`);
    return runtime.rewindSession({ ...params, provider, providerInstanceId: currentProviderInstanceId(provider) });
}


export const maxDuration = 3600
export {
  deleteViewSession, getClaudeSubagentSummaries, getViewSubagentMessages,
  listViewSessionMessageWindow, listViewSessionMessages, listViewSessions,
  patchViewSession, readViewSessionComposerOptions, readViewSessionDiagnostics,
  readViewSessionInfo, readViewSessionModels, readViewSessionSlashCommands, windowForParams,
} from './sessionReads'
export type { MessageListParams, SessionMessageWindow } from './adapters/types'
export { listViewRunningSessions, readViewRuntimeActivity } from './sessionActivity'
export { readViewSessionRunning } from './sessionControlPlane'
export { getServerMemoryDiagnostics } from './sessionRuntimeDiagnostics'
export { rebuildViewSessionIndex, listProjectSessionMessageBatches } from './sessionIndexOperations'
export type { SessionIndexRebuildError, SessionIndexRebuildResult } from './sessionIndexOperations'
export { getProviderSubagentSummaries } from './sessionSubagents'
export { createTurnUsageReporter, startTurnWatchdog } from './extensions/providers/runtimeCore'
export { isCodexActiveWriterError, isCodexMissingRolloutError } from './codexErrors'
export { withTimeout } from './withTimeout'
import { installProcessWarningRouting } from './processWarnings'
installProcessWarningRouting()
