// Provider architecture extraction: SDK behavior preserved from the session backend.
import type { SessionEvent as CopilotSessionEvent } from '@github/copilot-sdk';
import type { SubagentSummary } from "../../../types";
// Provider adapters deliberately cache their normalized SessionMessage object
// graphs. Adding provider-instance provenance with an unconditional object
// spread discarded that identity on every poll, forcing downstream threading
// and virtual-row caches to redo work even when the transcript was unchanged.
// Cache one lightweight variant per raw message+instance without mutating the
// adapter-owned object (Claude/Codex instances can legitimately share ids).
export function copilotSubagentSummaries(events: CopilotSessionEvent[]): SubagentSummary[] {
    const summaries = new Map<string, SubagentSummary>();
    for (const rawEvent of events) {
        if (rawEvent.type !== 'subagent.started'
            && rawEvent.type !== 'subagent.completed'
            && rawEvent.type !== 'subagent.failed')
            continue;
        const event = rawEvent as typeof rawEvent & {
            agentId?: string;
            timestamp?: string;
            data: {
                toolCallId?: string;
                agentDescription?: string;
                agentDisplayName?: string;
                agentName?: string;
                totalTokens?: number;
                error?: string;
            };
        };
        const agentId = event.agentId ?? event.data.toolCallId;
        if (!agentId)
            continue;
        const existing = summaries.get(agentId);
        const taskDescription = event.data.agentDescription
            ?? event.data.agentDisplayName
            ?? event.data.agentName
            ?? existing?.taskDescription;
        const totalTokens = (existing?.usage.totalTokens ?? 0) + (event.data.totalTokens ?? 0);
        summaries.set(agentId, {
            agentId,
            provider: 'copilot',
            taskDescription,
            messageCount: (existing?.messageCount ?? 0) + 1,
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens },
            startedAt: existing?.startedAt ?? event.timestamp,
            endedAt: event.type === 'subagent.started' ? existing?.endedAt : event.timestamp,
        });
    }
    return [...summaries.values()];
}

