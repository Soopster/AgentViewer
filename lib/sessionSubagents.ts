// Provider architecture extraction: SDK behavior preserved from the session backend.
import type { AgentProvider, SessionMessage, SubagentSummary } from "./types";
export const SIDEBAR_SUBAGENT_TOOL_NAMES = new Set(['agent', 'subagent', 'spawn_agent', 'delegate']);
export function toolSubagentSummaries(messages: SessionMessage[], provider: AgentProvider): SubagentSummary[] {
    const summaries = new Map<string, SubagentSummary>();
    for (const message of messages) {
        const apiMessage = message.message as {
            content?: unknown;
        };
        if (!Array.isArray(apiMessage.content))
            continue;
        for (const rawBlock of apiMessage.content) {
            if (!rawBlock || typeof rawBlock !== 'object')
                continue;
            const block = rawBlock as {
                type?: string;
                id?: string;
                name?: string;
                input?: Record<string, unknown>;
            };
            if (block.type !== 'tool_use' || !block.id || !block.name)
                continue;
            const normalizedName = block.name.toLowerCase().replace(/^functions[._]/, '');
            if (!SIDEBAR_SUBAGENT_TOOL_NAMES.has(normalizedName))
                continue;
            const input = block.input ?? {};
            const taskDescription = ['description', 'prompt', 'task', 'subject']
                .map((key) => input[key])
                .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
            summaries.set(block.id, {
                agentId: block.id,
                provider,
                taskDescription: taskDescription?.trim(),
                messageCount: 1,
                usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
                startedAt: message.timestamp,
                endedAt: message.timestamp,
            });
        }
    }
    return [...summaries.values()];
}


import { getSessionAdapter } from './adapters/registry'
import { resolveProvider } from './sessionReads'
import { withSessionInstance } from './sessionInstances'
export async function getProviderSubagentSummaries(sessionId: string, providerOverride?: AgentProvider): Promise<SubagentSummary[]> {
  const provider = await resolveProvider(providerOverride)
  const adapter = await getSessionAdapter(provider)
  return withSessionInstance(provider, sessionId, async () => {
    if (adapter.readSubagentSummaries) return adapter.readSubagentSummaries(sessionId)
    const data = await adapter.readAllMessages?.(sessionId)
    return toolSubagentSummaries(data?.messages ?? [], provider)
  })
}
