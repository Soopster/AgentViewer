// claude-acp / codex-acp: the same two SDKs reached over the Agent Client
// Protocol instead of natively. ACP has no session-listing, metadata-mutation,
// delete, or model-listing RPC at all, so this adapter is mostly *absence* —
// and that absence is the point. These sessions are transient and in-memory,
// tracked from creation via the running-session registry (lib/sessionRuntime.ts)
// and buffered in lib/acpClientPool.ts; there is no persisted history behind
// them to read back.
//
// Both ids share one implementation because the protocol, not the underlying
// agent, is what limits them. The pair is spelled out rather than generated so
// each stays greppable alongside the other providers.

import { isAcpSessionAlive, readAcpMessagesSince } from '../acpClientPool'
import { mapAcpBufferedMessages } from '../acpMapper'
import { getProviderCapabilities } from '../provider'
import type { AgentProvider } from '../types'
import type { SessionAdapter } from './types'

function makeAcpAdapter(provider: 'claude-acp' | 'codex-acp'): SessionAdapter {
  return {
    provider,

    // No listSessions: ACP sessions are transient, so "nothing to enumerate"
    // is a true answer rather than a failure to look.

    async readSessionInfo(sessionId) {
      // Only reflect state for a live pooled session — with no persisted
      // history there is nothing to fall back to once the subprocess is gone.
      if (!isAcpSessionAlive(sessionId)) return null
      return {
        sessionId,
        summary: `${provider} session`,
        lastModified: Date.now(),
        provider: provider as AgentProvider,
        capabilities: getProviderCapabilities(provider),
      }
    },

    async readAllMessages(sessionId) {
      const { messages } = readAcpMessagesSince(sessionId, -1)
      return { messages: mapAcpBufferedMessages(sessionId, provider, messages) }
    },

    // No readModels: ACP's session/new carries no model-listing RPC to query.

    async readDiagnostics(sessionId) {
      const alive = isAcpSessionAlive(sessionId)
      return {
        currentModel: null,
        sections: [
          { id: 'acp', title: 'ACP TRANSPORT', items: [alive ? 'session alive' : 'no active subprocess'] },
        ],
      }
    },
  }
}

export const claudeAcpAdapter = makeAcpAdapter('claude-acp')
export const codexAcpAdapter = makeAcpAdapter('codex-acp')
