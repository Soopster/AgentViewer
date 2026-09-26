// OpenCode, over its HTTP SDK plus a directory-scoped event bus
// (lib/opencodeHarness.ts). Two things distinguish it from the other
// providers:
//
//  - Almost every "diagnostic" read is project-scoped rather than
//    session-scoped, so those go through the harness cache: repeatedly opening
//    a panel or typing in the composer must not refire config/agent/command
//    lookups that are identical for every session under one directory.
//  - Subagents are *real child sessions* (the `task` tool's task_id is a
//    sessionId), so a subagent transcript is an ordinary session read rather
//    than a nested fold the way Claude's is.

import {
  getOpenCodeProjectDiagnostics,
  ensureOpenCodeEventsStarted,
  getOpenCodeTranscriptCacheVersion,
} from '../opencodeHarness'
import { getOpenCodeClient } from '../opencodeClient'
import { getOpenCodeV2Client } from '../opencodeClient'
import {
  currentOpenCodeModelValue,
  firstOpenCodePrompt,
  mapOpenCodeDiagnosticsToSections,
  mapOpenCodeMessagesToSessionMessages,
  mapOpenCodeModelsToSessionModels,
  mapOpenCodeSessionToInfo,
  mapOpenCodeSessionToSession,
  openCodeMessagesSignature,
} from '../opencodeMapper'
import { getOpenCodeStoredTag, getOpenCodeStoredTagsForSessions, setOpenCodeStoredTag } from '../opencodeTags'
import {
  OPENCODE_OPTIONS,
  OPENCODE_TRANSCRIPT_EVENT_CACHE_MAX_AGE_MS,
  forgetOpenCodeTranscriptVerification,
  getOpenCodeSession,
  getOpenCodeSessionMessages,
  openCodeData,
  openCodeDirectoryQuery,
  readOpenCodeTranscriptVerification,
  touchOpenCodeTranscriptVerification,
} from '../opencodeSessions'
import { readMappedMessagesCache, writeMappedMessagesCache } from '../mappedMessagesCache'
import { PROVIDER_MANAGED_PERMISSION_OPTIONS, sortMessagesChronologically, withOriginKind } from './shared'
import type {
  Agent as OpenCodeAgent,
  Message as OpenCodeMessage,
  Part as OpenCodePart,
  Session as OpenCodeSession,
} from '@opencode-ai/sdk'
import type { SessionComposerAgentOption } from '../types'
import type { SessionAdapter } from './types'

type OpenCodeMessageBundle = { info: OpenCodeMessage; parts: OpenCodePart[] }

function agentOption(agent: OpenCodeAgent): SessionComposerAgentOption {
  const metadata = agent as OpenCodeAgent & { hidden?: boolean; native?: boolean }
  return {
    value: agent.name,
    label: agent.name,
    description: agent.description ?? undefined,
    mode: agent.mode,
    native: metadata.native ?? agent.builtIn,
  }
}

function isAgentHidden(agent: OpenCodeAgent): boolean {
  return (agent as OpenCodeAgent & { hidden?: boolean }).hidden === true
}

function lastUserAgent(messages: OpenCodeMessageBundle[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const info = messages[i]?.info
    if (info?.role === 'user' && typeof info.agent === 'string' && info.agent.trim()) {
      return info.agent
    }
  }
  return null
}

export const opencodeAdapter: SessionAdapter = {
  provider: 'opencode',

  async listSessions({ dir, limit, offset }) {
    const client = await getOpenCodeV2Client()
    // The compatibility client bundled at the package root still omits the
    // server's `limit` field from its generated type and silently leaves us at
    // OpenCode's 100-session default. The v2 client describes the current
    // endpoint accurately, so request exactly the prefix needed for local
    // pagination instead of fetching too little or an unbounded history.
    const response = await client.session.list({
      ...(dir ? { directory: dir } : {}),
      limit: Math.max(1, limit + offset),
    }, OPENCODE_OPTIONS)
    const sessions = openCodeData<OpenCodeSession[]>(response as unknown as { data: OpenCodeSession[] })
    const tags = await getOpenCodeStoredTagsForSessions(sessions.map((session) => session.id))
    const mapped = sessions.map((session) => mapOpenCodeSessionToSession(session, tags[session.id] ?? null))
    // The SDK paginates from the directory prefix, not from our offset.
    return mapped.slice(offset, offset + limit)
  },

  async readSessionInfo(sessionId) {
    const [session, messages, tag] = await Promise.all([
      getOpenCodeSession(sessionId),
      getOpenCodeSessionMessages(sessionId),
      getOpenCodeStoredTag(sessionId),
    ])
    return mapOpenCodeSessionToInfo(
      session,
      tag,
      firstOpenCodePrompt(messages),
      currentOpenCodeModelValue(messages.at(-1)?.info) ?? undefined,
    )
  },

  async setTitle(sessionId, title) {
    const client = await getOpenCodeClient()
    await client.session.update({
      ...OPENCODE_OPTIONS,
      path: { id: sessionId },
      body: { title: title ?? undefined },
    })
  },

  async setTag(sessionId, tag) {
    await setOpenCodeStoredTag(sessionId, tag)
  },

  async deleteSession(sessionId) {
    const client = await getOpenCodeClient()
    await client.session.delete({
      ...OPENCODE_OPTIONS,
      path: { id: sessionId },
    })
  },

  async readAllMessages(sessionId) {
    ensureOpenCodeEventsStarted()
    const cacheKey = `opencode:${sessionId}`
    const versionBeforeFetch = getOpenCodeTranscriptCacheVersion(sessionId)
    const verified = readOpenCodeTranscriptVerification(sessionId)
    if (
      versionBeforeFetch
      && verified?.version === versionBeforeFetch
      && Date.now() - verified.at < OPENCODE_TRANSCRIPT_EVENT_CACHE_MAX_AGE_MS
    ) {
      const cached = readMappedMessagesCache(cacheKey, verified.signature)
      if (cached) return { messages: cached }
    }
    const raw = await getOpenCodeSessionMessages(sessionId)
    // OpenCode mutates the current assistant bundle in place while streaming:
    // IDs and array lengths stay constant as text grows and tool states advance.
    // Fingerprint that mutable tail so polling cannot return a stale mapped
    // transcript, while avoiding a full-history hash for large sessions.
    const signature = openCodeMessagesSignature(raw)
    const cached = readMappedMessagesCache(cacheKey, signature)
    const messages = cached
      ?? writeMappedMessagesCache(cacheKey, signature, sortMessagesChronologically(mapOpenCodeMessagesToSessionMessages(raw)))
    const versionAfterFetch = getOpenCodeTranscriptCacheVersion(sessionId)
    // Only trust an event version that stayed stable across the SDK read. If an
    // event raced the fetch, leave the verification absent so the next read
    // checks OpenCode again instead of blessing a potentially older snapshot.
    if (versionBeforeFetch && versionAfterFetch === versionBeforeFetch) {
      touchOpenCodeTranscriptVerification(sessionId, versionAfterFetch, signature)
    } else {
      forgetOpenCodeTranscriptVerification(sessionId)
    }
    return { messages }
  },

  async readSubagentMessages(_sessionId, agentId) {
    // OpenCode subagents (spawned by the `task` tool) are real child sessions:
    // task_id === child sessionId. Fetch and map the child transcript so the
    // parent's task card can render the inner conversation inline.
    const raw = await getOpenCodeSessionMessages(agentId).catch(() => [] as OpenCodeMessageBundle[])
    if (raw.length === 0) return []
    const mapped = sortMessagesChronologically(mapOpenCodeMessagesToSessionMessages(raw))
    return withOriginKind(mapped, `subagent:${agentId}`)
  },

  async readModels(sessionId) {
    const client = await getOpenCodeClient()
    const session = await getOpenCodeSession(sessionId)
    const [configResponse, messages] = await Promise.all([
      client.config.providers({
        ...OPENCODE_OPTIONS,
        query: openCodeDirectoryQuery(session),
      }),
      getOpenCodeSessionMessages(sessionId),
    ])
    return {
      models: mapOpenCodeModelsToSessionModels(openCodeData(configResponse)),
      currentModel: currentOpenCodeModelValue(messages.at(-1)?.info),
      contextUsage: null,
    }
  },

  async readComposerOptions(sessionId) {
    try {
      const session = await getOpenCodeSession(sessionId)
      const query = openCodeDirectoryQuery(session)
      const [project, messages] = await Promise.all([
        getOpenCodeProjectDiagnostics(query?.directory),
        getOpenCodeSessionMessages(sessionId).catch(() => [] as OpenCodeMessageBundle[]),
      ])
      const selectableAgents = project.agents
        .filter((agent) => !isAgentHidden(agent) && agent.mode !== 'subagent')
        .map(agentOption)
      const mentionAgents = project.agents
        .filter((agent) => !isAgentHidden(agent) && agent.mode !== 'primary')
        .map(agentOption)
      const currentAgent = lastUserAgent(messages)
        ?? selectableAgents.find((agent) => agent.value === 'build')?.value
        ?? selectableAgents[0]?.value
        ?? null
      return {
        agents: selectableAgents,
        mentionAgents,
        currentAgent,
        permissionModes: PROVIDER_MANAGED_PERMISSION_OPTIONS,
        currentPermissionMode: 'native',
      }
    } catch {
      // A cold or restarting OpenCode server shouldn't blank the composer —
      // fall back to the provider-managed defaults every other provider gets.
      return {
        agents: [],
        mentionAgents: [],
        currentAgent: null,
        permissionModes: PROVIDER_MANAGED_PERMISSION_OPTIONS,
        currentPermissionMode: 'native',
      }
    }
  },

  async readSlashCommands(sessionId) {
    try {
      const session = await getOpenCodeSession(sessionId).catch(() => null)
      const query = session ? openCodeDirectoryQuery(session) : undefined
      // Routed through the harness cache — every keystroke in the
      // composer was previously firing a fresh command.list HTTP call.
      const project = await getOpenCodeProjectDiagnostics(query?.directory)
      return project.commands.map((command) => ({
        command: command.name.startsWith('/') ? command.name : `/${command.name}`,
        description: command.description ?? '',
      }))
    } catch {
      return []
    }
  },

  async readDiagnostics(sessionId) {
    const client = await getOpenCodeClient()
    const session = await getOpenCodeSession(sessionId)
    const query = openCodeDirectoryQuery(session)
    // Project-level config (providers/commands/agents/lsp/formatters/mcp)
    // is identical across every session under the same directory, so route
    // those reads through the harness cache. The remaining session-specific
    // calls fan out as before.
    const [project, messages, children] = await Promise.all([
      getOpenCodeProjectDiagnostics(query?.directory),
      getOpenCodeSessionMessages(sessionId),
      client.session.children({
        ...OPENCODE_OPTIONS,
        path: { id: sessionId },
        query,
      }).catch(() => ({ data: [] as OpenCodeSession[] })),
    ])

    return {
      currentModel: currentOpenCodeModelValue(messages.at(-1)?.info),
      sections: mapOpenCodeDiagnosticsToSections({
        providers: project.providers,
        commands: project.commands,
        agents: project.agents,
        lsp: project.lsp,
        formatters: project.formatters,
        mcp: project.mcp,
        children: openCodeData<OpenCodeSession[]>(children),
        currentSession: session,
      }),
    }
  },
}
