// Provider architecture extraction: SDK behavior preserved from the session backend.
import { INDEXABLE_PROVIDER_IDS } from "./extensions/providers/catalog";
import { mapConcurrent } from "./adapters/shared";
import { withProviderInstance } from "./providerInstances";
import type { AgentProvider, Session, SessionMessage } from "./types";
import { clearPersistedSessionIndex, readPersistedIndexStats, type PersistedIndexStats } from "./sessionPersistence";
// The read half of this router lives in lib/sessionReads.ts, which deliberately
// imports no provider client, SDK, or send-path module: reading a session used
// to evaluate the machinery for sending one (~72MB of footprint against ~16MB),
// and the TUI's transcript Worker is a separate JS VM that only ever reads.
// Re-exported here so every existing caller of sessionBackend is unaffected.
import { clearPersistedSessionListSignatures, listViewSessionMessages, listViewSessions } from "./sessionReads";
export type ProjectMessageBatchParams = {
    dir: string;
    includeWorktrees: boolean;
    provider?: AgentProvider | 'all';
    providerInstanceId?: string;
    offsets: Record<string, number>;
    initialLimit: number;
    incrementalLimit: number;
};
export type RebuildSessionIndexParams = {
    provider?: AgentProvider | 'all';
    dir?: string;
    includeWorktrees?: boolean;
};
export type SessionIndexRebuildError = {
    provider: AgentProvider;
    sessionId?: string;
    message: string;
};
export type SessionIndexRebuildResult = {
    startedAt: string;
    finishedAt: string;
    provider: AgentProvider | 'all';
    scannedProviders: AgentProvider[];
    sessions: number;
    messages: number;
    errors: SessionIndexRebuildError[];
    stats: PersistedIndexStats;
};
export const INDEX_REBUILD_PROVIDERS = [...INDEXABLE_PROVIDER_IDS];
export const INDEX_REBUILD_PAGE_SIZE = 500;
export const INDEX_REBUILD_MESSAGE_LIMIT = 100000;
export const INDEX_REBUILD_MESSAGE_CONCURRENCY = 4;
export async function listProviderSessionsForIndex(params: {
    provider: AgentProvider;
    dir?: string;
    includeWorktrees: boolean;
}): Promise<Session[]> {
    const byKey = new Map<string, Session>();
    let offset = 0;
    while (true) {
        const page = await listViewSessions({
            limit: INDEX_REBUILD_PAGE_SIZE,
            offset,
            dir: params.dir,
            includeWorktrees: params.includeWorktrees,
            provider: params.provider,
        });
        for (const session of page) {
            byKey.set(`${session.provider ?? params.provider}:${session.sessionId}`, {
                ...session,
                provider: session.provider ?? params.provider,
            });
        }
        if (page.length < INDEX_REBUILD_PAGE_SIZE)
            break;
        offset += page.length;
    }
    return [...byKey.values()];
}
export async function rebuildViewSessionIndex(params: RebuildSessionIndexParams = {}): Promise<SessionIndexRebuildResult> {
    const provider = params.provider ?? 'all';
    const includeWorktrees = params.includeWorktrees !== false;
    const scannedProviders = provider === 'all' ? INDEX_REBUILD_PROVIDERS : [provider];
    const startedAt = new Date().toISOString();
    const errors: SessionIndexRebuildError[] = [];
    let sessionCount = 0;
    let messageCount = 0;
    await clearPersistedSessionIndex();
    clearPersistedSessionListSignatures();
    for (const currentProvider of scannedProviders) {
        let sessions: Session[];
        try {
            sessions = await listProviderSessionsForIndex({
                provider: currentProvider,
                dir: params.dir,
                includeWorktrees,
            });
            sessionCount += sessions.length;
        }
        catch (err) {
            errors.push({
                provider: currentProvider,
                message: err instanceof Error ? err.message : String(err),
            });
            continue;
        }
        const results = await mapConcurrent(sessions, INDEX_REBUILD_MESSAGE_CONCURRENCY, async (session) => {
            try {
                const messages = await listViewSessionMessages(session.sessionId, { limit: INDEX_REBUILD_MESSAGE_LIMIT, offset: 0 }, session.provider ?? currentProvider);
                return { ok: true as const, count: messages.length };
            }
            catch (err) {
                return {
                    ok: false as const,
                    provider: session.provider ?? currentProvider,
                    sessionId: session.sessionId,
                    message: err instanceof Error ? err.message : String(err),
                };
            }
        });
        for (const result of results) {
            if (result.ok) {
                messageCount += result.count;
            }
            else {
                errors.push({
                    provider: result.provider,
                    sessionId: result.sessionId,
                    message: result.message,
                });
            }
        }
    }
    const stats = await readPersistedIndexStats({ provider, dir: params.dir, includeWorktrees });
    return {
        startedAt,
        finishedAt: new Date().toISOString(),
        provider,
        scannedProviders,
        sessions: sessionCount,
        messages: messageCount,
        errors,
        stats,
    };
}
// Project-view sessions list rarely changes between 2 s polls. Cache the
// list scan briefly so the per-poll fan-out into per-session message reads
// doesn't also re-list every provider every tick.
export const PROJECT_SESSIONS_TTL = 5000;
export type ProjectSessionsCacheEntry = {
    sessions: Session[];
    ts: number;
};
export const projectSessionsCache = new Map<string, ProjectSessionsCacheEntry>();
export function pruneProjectSessionsCache() {
    const deadline = Date.now() - PROJECT_SESSIONS_TTL * 3;
    for (const [key, entry] of projectSessionsCache) {
        if (entry.ts < deadline)
            projectSessionsCache.delete(key);
    }
}
export async function listProjectSessionMessageBatches(params: ProjectMessageBatchParams): Promise<{
    sessions: Session[];
    batches: Array<{
        key: string;
        sessionId: string;
        provider?: AgentProvider;
        offset: number;
        messages: SessionMessage[];
    }>;
}> {
    const cacheKey = `${params.provider ?? ''}:${params.providerInstanceId ?? ''}:${params.includeWorktrees ? '1' : '0'}:${params.dir}`;
    const cached = projectSessionsCache.get(cacheKey);
    let sessions: Session[];
    if (cached && Date.now() - cached.ts < PROJECT_SESSIONS_TTL) {
        sessions = cached.sessions;
    }
    else {
        sessions = await listViewSessions({
            limit: 500,
            offset: 0,
            dir: params.dir,
            includeWorktrees: params.includeWorktrees,
            provider: params.provider,
            providerInstanceId: params.providerInstanceId,
        });
        pruneProjectSessionsCache();
        projectSessionsCache.set(cacheKey, { sessions, ts: Date.now() });
    }
    const batches = await mapConcurrent(sessions, 10, async (session) => {
        const key = `${session.providerInstanceId ?? session.provider ?? 'claude'}:${session.sessionId}`;
        const hasKnownOffset = Object.prototype.hasOwnProperty.call(params.offsets, key);
        const offset = Math.max(0, params.offsets[key] ?? 0);
        const limit = offset === 0 && !hasKnownOffset ? params.initialLimit : params.incrementalLimit;
        const messages = limit > 0
            ? await withProviderInstance(session.providerInstanceId, session.provider ?? 'claude', () => listViewSessionMessages(session.sessionId, { offset, limit }, session.provider))
            : [];
        return {
            key,
            sessionId: session.sessionId,
            provider: session.provider,
            offset,
            messages,
        };
    });
    return {
        sessions,
        batches: batches.filter((batch) => batch.messages.length > 0 || !Object.prototype.hasOwnProperty.call(params.offsets, batch.key)),
    };
}

