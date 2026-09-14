// claude-acp / codex-acp: the same two SDKs reached over the Agent Client
// Protocol instead of natively.
//
// This adapter used to be mostly *absence*, on the premise that ACP had no
// session-listing, load, delete or model-listing RPC and that these sessions
// were therefore transient and in-memory. The protocol has those methods and
// gates each on the agent advertising it — and the installed agents do:
//
//   claude-agent-acp 0.70.0  loadSession + session {list, resume, fork, delete}
//   codex-acp 1.6.2          loadSession + session {list, resume, delete}
//
// So the shape is no longer "ACP cannot" but "ask this agent, then act on the
// answer". Everything below degrades to the old transient behaviour when the
// agent says no, which is also what keeps an older agent working.
//
// The one thing NOT taken on trust is the advertisement itself: codex-acp
// claims `loadSession` and then fails every load, so `lib/acpCapabilities.ts`
// verifies the claim before listing anything. See verifyAcpHistoryReadable.
//
// Both ids share one implementation because the protocol, not the underlying
// agent, is what shapes them; per-agent differences come from the capability
// read at runtime rather than from a branch here.

import {
  acpCapabilityError,
  listAcpAgentSessions,
  loadAcpSessionHistory,
  readAcpAgentCapabilities,
} from '../acpCapabilities'
import { isAcpSessionAlive, peekAcpSession, readAcpMessagesSince } from '../acpClientPool'
import { mapAcpBufferedMessages } from '../acpMapper'
import { getProviderCapabilities } from '../provider'
import type { AgentProvider, Session } from '../types'
import type { SessionAdapter } from './types'

type AcpProvider = 'claude-acp' | 'codex-acp'

// The provider id the UI uses and the agent kind the spawner uses are different
// vocabularies, and conflating them is a real mistake rather than a typo: the
// spawn table is keyed by 'claude' | 'codex', so passing a provider id resolves
// nothing and — because a failed capability probe degrades silently — reads back
// as "this agent supports nothing".
function agentKindFor(provider: AcpProvider): 'claude' | 'codex' {
  return provider === 'claude-acp' ? 'claude' : 'codex'
}

function makeAcpAdapter(provider: AcpProvider): SessionAdapter {
  const agentKind = agentKindFor(provider)

  return {
    provider,

    async listSessions() {
      // Empty when the agent does not advertise `session/list`, or advertises it
      // but cannot replay what it lists. Both are a true "nothing to enumerate"
      // rather than a failure to look — a session that opens empty is worse in
      // the sidebar than one that is not there.
      const sessions = await listAcpAgentSessions(agentKind)
      return sessions.map((entry): Session => ({
        sessionId: String(entry.sessionId),
        provider: provider as AgentProvider,
        // The agent's own title when it has one. A session it has not titled
        // yet gets its id rather than a generic label, so two untitled sessions
        // stay distinguishable in the list.
        summary: entry.title || `${provider} session ${String(entry.sessionId).slice(0, 8)}`,
        lastModified: entry.updatedAt ? Date.parse(entry.updatedAt) || Date.now() : Date.now(),
        cwd: entry.cwd,
      }))
    },

    async readSessionInfo(sessionId) {
      // A live pooled session is authoritative — it is the one being prompted,
      // and its cwd is what the turn actually runs in.
      const live = peekAcpSession(sessionId)
      if (live) {
        return {
          sessionId,
          summary: `${provider} session`,
          lastModified: Date.now(),
          provider: provider as AgentProvider,
          cwd: live.cwd,
          capabilities: getProviderCapabilities(provider),
        }
      }
      // Otherwise fall back to the agent's own listing, which is what makes a
      // session selected from the sidebar openable at all.
      const listed = (await listAcpAgentSessions(agentKind))
        .find((entry) => String(entry.sessionId) === sessionId)
      if (!listed) return null
      return {
        sessionId,
        summary: listed.title || `${provider} session`,
        lastModified: listed.updatedAt ? Date.parse(listed.updatedAt) || Date.now() : Date.now(),
        provider: provider as AgentProvider,
        cwd: listed.cwd,
        capabilities: getProviderCapabilities(provider),
      }
    },

    async readAllMessages(sessionId) {
      // A live session's buffer is the only place its in-flight turn exists, so
      // it wins over a replay: `session/load` returns what the agent has
      // persisted, which lags the turn currently streaming.
      if (isAcpSessionAlive(sessionId)) {
        const { messages } = readAcpMessagesSince(sessionId, -1)
        return { messages: mapAcpBufferedMessages(sessionId, provider, messages) }
      }
      const listed = (await listAcpAgentSessions(agentKind))
        .find((entry) => String(entry.sessionId) === sessionId)
      if (listed) {
        const history = await loadAcpSessionHistory(agentKind, sessionId, listed.cwd)
        // Mapped through the SAME function the live path uses. A transcript read
        // and a live turn must produce identical cards, or the same session
        // looks different depending on how it was opened.
        if (history) return { messages: mapAcpBufferedMessages(sessionId, provider, history) }
      }
      // Not live, and either not listed or not replayable. The pool buffer is
      // the last thing that could still hold it.
      const { messages } = readAcpMessagesSince(sessionId, -1)
      return { messages: mapAcpBufferedMessages(sessionId, provider, messages) }
    },

    // No readModels: ACP's session/new carries no model-listing RPC to query.

    async readDiagnostics(sessionId) {
      const alive = isAcpSessionAlive(sessionId)
      const support = await readAcpAgentCapabilities(agentKind)
      const error = acpCapabilityError(agentKind)
      const listed = await listAcpAgentSessions(agentKind)
      return {
        currentModel: null,
        sections: [
          {
            id: 'acp',
            title: 'ACP TRANSPORT',
            items: [alive ? 'session alive' : 'no active subprocess'],
          },
          {
            // What the agent SAYS it can do. Worth showing verbatim: it is the
            // input every gate here reads, and it is the thing that turned out
            // to disagree with reality for codex-acp.
            id: 'acp-capabilities',
            title: 'ACP AGENT CAPABILITIES',
            items: [
              `session/load · ${support.loadSession ? 'advertised' : 'no'}`,
              `session/list · ${support.listSessions ? 'advertised' : 'no'}`,
              `session/resume · ${support.resumeSession ? 'advertised' : 'no'}`,
              `session/delete · ${support.deleteSession ? 'advertised' : 'no'}`,
              `session/fork · ${support.forkSession ? 'advertised' : 'no'}`,
              // The gap between the claim and what listing actually does is the
              // single most confusing thing about this surface, so it is stated
              // rather than left to be inferred from an empty list.
              `listed sessions · ${listed.length}${support.listSessions && listed.length === 0 ? ' (advertised, but history could not be replayed)' : ''}`,
              ...(error ? [`last probe error · ${error}`] : []),
            ],
          },
        ],
      }
    },
  }
}

export const claudeAcpAdapter = makeAcpAdapter('claude-acp')
export const codexAcpAdapter = makeAcpAdapter('codex-acp')
