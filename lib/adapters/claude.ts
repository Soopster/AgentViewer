// Claude, via @anthropic-ai/claude-agent-sdk. The richest adapter, because
// Claude is the only provider that exposes a full control-RPC surface —
// commands, agents, MCP status, resolved settings, hook history, plan usage —
// which is what the diagnostics panel is built from.
//
// Two performance decisions are load-bearing and easy to undo by accident:
//
//  - readModels does NOT call getContextUsage(). That RPC is answered on the
//    same queue the CLI accepts prompts on (~1.4s on a warm subprocess) and
//    blocked every session switch. The context meter is driven entirely by the
//    turn-result `context-usage` SSE event, and the current model is derived
//    client-side from the transcript already loaded for display.
//  - readSlashCommands prefers a pushed commands_changed override, then the
//    warm pool entry's persistent Query, and only then spawns a control query.
//    supportedCommands() returns the init-captured list and never reflects
//    mid-session changes, so the push must win.

import {
  deleteSession as deleteClaudeSession,
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSessions,
  listSubagents,
  renameSession,
  resolveSettings,
  tagSession,
  type SDKControlGetUsageResponse,
} from '@anthropic-ai/claude-agent-sdk'
import { claudeSessionStoreOptions } from '../claudeSessionStore'
import { normalizeClaudeHistoryMessages } from '../claudeMapper'
import { clearClaudeDynamicMcpServers, claudeDynamicMcpServerNames } from '../claudeDynamicMcp'
import { deleteClaudeHookEvents, listClaudeHookEvents } from '../claudeHookEvents'
import { claudeProcessTransportStatus } from '../claudeProcessSpawner'
import { readClaudeSupportedModels } from '../claudeModels'
import { withoutClaudeResumeTouch } from '../claudeResumeTouch'
import { peekClaudeSessionIfLoaded } from '../claudePoolHandle'
import { getClaudeCommandsOverride } from '../claudeCommandsStore'
import {
  claudeSubagentParentId,
  formatClaudeSubagentTree,
  getCachedSessionInfo,
  pruneSessionInfoCache,
  readClaudeSessionMessages,
} from '../claudeSessionReads'
import { createSessionControlQuery } from '../sdkControlQuery'
import { clearWaitingSession } from '../sessionRuntime'
import { getProviderCapabilities } from '../provider'
import { withProviderProcessEnvironment } from '../providerInstances'
import { timeAsync } from '../perfLog'
import { CLAUDE_PERMISSION_MODE_OPTIONS, mapConcurrent, withOriginKind } from './shared'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { SessionMessage, SessionModelInfo, SubagentSummary } from '../types'
import type { SessionAdapter } from './types'

type ClaudeUsageCapableQuery = {
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: () => Promise<SDKControlGetUsageResponse>
}

async function claudePlanUsageItems(q: unknown): Promise<string[]> {
  const call = (q as ClaudeUsageCapableQuery)?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET
  if (typeof call !== 'function') return ['Unavailable']
  let usage: SDKControlGetUsageResponse
  try {
    usage = await call.call(q)
  } catch {
    return ['Unavailable']
  }
  const items: string[] = []
  if (usage.subscription_type) items.push(`plan · ${usage.subscription_type}`)
  if (!usage.rate_limits_available || !usage.rate_limits) {
    // API key / Bedrock / Vertex sessions have no plan windows at all — say so
    // rather than showing an empty section that reads like a failed read.
    items.push('plan limits do not apply to this session')
    return items
  }
  const limits = usage.rate_limits
  const formatReset = (iso: string | null) => {
    if (!iso) return ''
    const at = new Date(iso)
    if (Number.isNaN(at.getTime())) return ''
    return ` · resets ${at.toLocaleString()}`
  }
  const window = (label: string, value: { utilization: number | null; resets_at: string | null } | null | undefined) => {
    if (!value || value.utilization == null) return
    items.push(`${label} · ${Math.round(value.utilization)}%${formatReset(value.resets_at)}`)
  }
  window('5-hour', limits.five_hour)
  window('7-day', limits.seven_day)
  window('7-day opus', limits.seven_day_opus)
  window('7-day sonnet', limits.seven_day_sonnet)
  window('7-day oauth apps', limits.seven_day_oauth_apps)
  for (const scoped of limits.model_scoped ?? []) {
    window(`7-day ${scoped.display_name}`, scoped)
  }
  // `used_credits` / `monthly_limit` are minor units whose exponent is not in
  // the typed shape, so only the server-computed percentage is safe to render —
  // printing the raw integers would show "2232/15000" for AUD 22.32 of 150.
  const extra = limits.extra_usage
  if (extra) {
    const pct = extra.utilization != null ? ` · ${Math.round(extra.utilization)}%` : ''
    const currency = extra.currency ? ` ${extra.currency}` : ''
    items.push(extra.is_enabled ? `extra usage · enabled${pct}${currency}` : `extra usage · disabled${pct}${currency}`)
  }
  return items.length > 0 ? items : ['No plan limit windows reported']
}


function claudeLatencyDiagnosticItems(rawMessages: unknown[]): string[] {
  const results = rawMessages
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'))
    .filter((value) => value.type === 'result' && value.subtype === 'success')
    .slice(-20)
  if (results.length === 0) return ['No Claude result timing samples']
  const samples = (key: string) => results
    .map((result) => result[key])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const median = (values: number[]) => {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  const formatMs = (value: number | null) => value == null ? null : `${Math.round(value)}ms`
  const items = [`${results.length} recent result sample${results.length === 1 ? '' : 's'}`]
  const timing: Array<[string, number]> = []
  for (const [label, key] of [['TTFT', 'ttft_ms'], ['API', 'duration_api_ms'], ['Request', 'time_to_request_ms']] as const) {
    const value = median(samples(key))
    if (value != null) timing.push([label, value])
  }
  if (timing.length > 0) items.push(...timing.map(([label, value]) => `${label} median ${formatMs(value)}`))
  const latest = results.at(-1)
  if (typeof latest?.api_error_status === 'number') items.push(`Latest API status HTTP ${latest.api_error_status}`)
  const modelUsage = latest?.modelUsage && typeof latest.modelUsage === 'object' ? latest.modelUsage as Record<string, unknown> : null
  if (modelUsage) {
    const models = Object.values(modelUsage).flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const entry = value as Record<string, unknown>
      const model = typeof entry.canonicalModel === 'string' ? entry.canonicalModel : typeof entry.model === 'string' ? entry.model : null
      const provider = typeof entry.provider === 'string' ? entry.provider : null
      return model ? [provider ? `${provider}/${model}` : model] : []
    })
    if (models.length > 0) items.push(`Models ${[...new Set(models)].join(', ')}`)
  }
  return items
}

// Fields getSessionInfo would supply for a Claude session. When the list entry
// already has all of them there is nothing for the per-session lookup to add
// (verified field-by-field across the local corpus), so the read is skipped.
// `summary` is deliberately absent: a session whose first turn has not been
// summarized yet has none to find, and requiring it would re-read that
// transcript on every poll forever.
function isCompleteClaudeListEntry(session: { cwd?: unknown; createdAt?: unknown; firstPrompt?: unknown }): boolean {
  return typeof session.cwd === 'string' && session.cwd.length > 0
    && session.createdAt != null
    && typeof session.firstPrompt === 'string'
}

export const claudeAdapter: SessionAdapter = {
  provider: 'claude',

  async listSessions({ limit, offset, dir, includeWorktrees }) {
    // The per-instance environment (a distinct CLAUDE_CONFIG_DIR, say) has to
    // be in place for the store read, not just for spawned processes.
    return withProviderProcessEnvironment(async () => {
      pruneSessionInfoCache()
      const sessions = await timeAsync('claude.listSessions', () => listSessions({
        limit,
        offset,
        dir,
        includeWorktrees: dir ? includeWorktrees : undefined,
        // SessionStore.listSessions is project-scoped: the SDK has no API for
        // enumerating project keys. Preserve its true cross-project filesystem
        // behavior when no directory filter is present. Store mirroring requires
        // local persistence, so those sessions remain visible in this fallback.
        ...(dir ? claudeSessionStoreOptions() : {}),
      }))
      const normalized = await timeAsync('claude.sessionInfo', () => mapConcurrent(sessions, 20, async (session) => {
        // getSessionInfo re-derives the very fields the list entry already
        // carries, and deriving them means re-reading that session's transcript:
        // enriching a complete entry costs a full pass over every JSONL in the
        // corpus on every list poll (~140MB of allocation for 225 sessions here,
        // measured, against ~60MB for the list itself). A complete entry is
        // returned as-is; only a sparse one — a store-backed or partially
        // written session — still pays for the single-session lookup.
        if (isCompleteClaudeListEntry(session)) return session
        try {
          const sessionDir = typeof session.cwd === 'string' && session.cwd ? session.cwd : dir
          const info = await getCachedSessionInfo(session.sessionId, sessionDir)
          if (!info) return session
          return {
            ...session,
            ...info,
            // Keep the list-level working directory when the single-session lookup
            // can't resolve one, but prefer the stable per-session metadata.
            cwd: info.cwd ?? session.cwd,
          }
        } catch {
          return session
        }
      }))

      return normalized.map((session) => ({
        ...withoutClaudeResumeTouch(session),
        provider: 'claude' as const,
        capabilities: getProviderCapabilities('claude'),
      }))
    })
  },

  async readSessionInfo(sessionId) {
    const info = await getSessionInfo(sessionId, claudeSessionStoreOptions())
    if (!info) return null
    return {
      ...withoutClaudeResumeTouch(info),
      provider: 'claude',
      capabilities: getProviderCapabilities('claude'),
    }
  },

  async setTitle(sessionId, title) {
    if (title === null) throw new Error('title must be a string')
    await renameSession(sessionId, title, claudeSessionStoreOptions())
  },

  async setTag(sessionId, tag) {
    await tagSession(sessionId, tag, claudeSessionStoreOptions())
  },

  async deleteSession(sessionId) {
    await deleteClaudeSession(sessionId, claudeSessionStoreOptions())
    // Everything keyed by this session id goes with it, or the next session to
    // reuse the id inherits stale dynamic MCP servers and hook history.
    clearClaudeDynamicMcpServers(sessionId)
    await deleteClaudeHookEvents(sessionId)
    clearWaitingSession(sessionId)
  },

  async readAllMessages(sessionId) {
    return { messages: await readClaudeSessionMessages(sessionId) }
  },

  async readSubagentMessages(sessionId, agentId) {
    const raw = await getSubagentMessages(sessionId, agentId, claudeSessionStoreOptions())
      .catch(() => [] as SessionMessage[])
    return withOriginKind(normalizeClaudeHistoryMessages(raw as unknown[]), `subagent:${agentId}`)
  },

  async readSubagentSummaries(sessionId) {
    const subagentIds = await listSubagents(sessionId, claudeSessionStoreOptions()).catch(() => [] as string[])
    if (subagentIds.length === 0) return []

    const summaries = await mapConcurrent(subagentIds, 4, async (agentId): Promise<SubagentSummary | null> => {
      const raw = await getSubagentMessages(sessionId, agentId, claudeSessionStoreOptions())
        .catch(() => [] as SessionMessage[])
      if (raw.length === 0) return null
      const messages = normalizeClaudeHistoryMessages(raw as unknown[])
      let inputTokens = 0
      let outputTokens = 0
      let cacheReadTokens = 0
      let taskDescription: string | undefined
      let startedAt: string | undefined
      let endedAt: string | undefined
      for (const msg of messages) {
        if (msg.timestamp) {
          if (!startedAt) startedAt = msg.timestamp
          endedAt = msg.timestamp
        }
        if (!taskDescription && msg.taskDescription) taskDescription = msg.taskDescription
        const apiMessage = msg.message as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null } } | undefined
        const usage = apiMessage?.usage
        if (usage) {
          inputTokens += usage.input_tokens ?? 0
          outputTokens += usage.output_tokens ?? 0
          cacheReadTokens += usage.cache_read_input_tokens ?? 0
        }
      }
      return {
        agentId,
        taskDescription,
        messageCount: messages.length,
        usage: { inputTokens, outputTokens, cacheReadTokens },
        startedAt,
        endedAt,
        provider: 'claude',
      }
    })
    return summaries.filter((s): s is SubagentSummary => s !== null)
  },

  async readModels() {
    // See the header note: deliberately no getContextUsage() call here.
    const models = await readClaudeSupportedModels().catch(() => [] as SessionModelInfo[])
    return {
      models,
      currentModel: null,
      contextUsage: null,
    }
  },

  async readComposerOptions() {
    return {
      permissionModes: CLAUDE_PERMISSION_MODE_OPTIONS,
      currentPermissionMode: 'default',
    }
  },

  async readSlashCommands(sessionId) {
    const mapCommands = (commands: Awaited<ReturnType<Query['supportedCommands']>>) => commands.map((command) => ({
      command: command.name.startsWith('/') ? command.name : `/${command.name}`,
      description: command.description ?? '',
      argumentHint: command.argumentHint && command.argumentHint.trim() ? command.argumentHint : undefined,
    }))
    // A commands_changed push supersedes any RPC fetch: supportedCommands()
    // returns the init-captured list and never reflects mid-session changes.
    const pushed = getClaudeCommandsOverride(sessionId)
    if (pushed) return mapCommands(pushed)
    // Prefer the warm pool entry's persistent Query (composer prewarm or a
    // recent send) — supportedCommands is then a control RPC on the existing
    // subprocess instead of a fresh ~1-3s CLI spawn.
    // Via the handle, so this read path does not drag the ~30MB send-path pool
    // into every isolate that reads a session. Undefined when the pool has
    // never loaded, which is the same answer as "no warm entry" — nothing can
    // have created one — and falls through to the cold control query below.
    const warm = peekClaudeSessionIfLoaded(sessionId)
    if (warm) {
      const commands = await warm.query.supportedCommands().catch(() => [])
      return mapCommands(commands)
    }
    const q = createSessionControlQuery(sessionId)
    try {
      const commands = await q.supportedCommands().catch(() => [])
      return mapCommands(commands)
    } finally {
      q.close()
    }
  },

  async readDiagnostics(sessionId) {

    const q = createSessionControlQuery(sessionId)
    try {
      const init = await q.initializationResult()
      const [commands, agents, mcpServers, contextUsage, subagents, rawMessages, resolvedSettings, hookEvents, planUsageItems] = await Promise.all([
        q.supportedCommands(),
        q.supportedAgents(),
        q.mcpServerStatus(),
        q.getContextUsage().catch(() => null),
        listSubagents(sessionId, claudeSessionStoreOptions()).catch(() => [] as string[]),
        getSessionMessages(sessionId, {
          includeSystemMessages: true,
          ...claudeSessionStoreOptions(),
        }).catch(() => [] as unknown[]),
        getSessionInfo(sessionId, claudeSessionStoreOptions())
          .then((info) => resolveSettings({ cwd: info?.cwd }))
          .catch(() => null),
        listClaudeHookEvents(sessionId, { limit: 20 }).catch(() => []),
        claudePlanUsageItems(q),
      ])
      const accountItems: string[] = []
      if (init.account?.email) accountItems.push(init.account.email)
      if (init.account?.organization) accountItems.push(init.account.organization)
      if (init.account?.subscriptionType) accountItems.push(init.account.subscriptionType)
      const subagentParents = new Map<string, string | null>()
      if (subagents.length > 0) {
        await Promise.all(subagents.map(async (agentId) => {
          const messages = await getSubagentMessages(sessionId, agentId, claudeSessionStoreOptions())
            .catch(() => [] as SessionMessage[])
          subagentParents.set(agentId, claudeSubagentParentId(messages as unknown[]))
        }))
      }
      const settingItems = resolvedSettings
        ? [
            `effective keys · ${Object.keys(resolvedSettings.effective).sort().join(', ') || 'none'}`,
            `sources · ${resolvedSettings.sources.map((source) => source.source).join(', ') || 'managed/default only'}`,
          ]
        : ['Unavailable']
      const sandboxSettings = resolvedSettings?.effective.sandbox
      const sandboxItems = sandboxSettings && typeof sandboxSettings === 'object'
        ? [
            `enabled · ${sandboxSettings.enabled === false ? 'no' : 'yes'}`,
            `bash auto-allow · ${sandboxSettings.autoAllowBashIfSandboxed === false ? 'no' : 'yes'}`,
            `unsandboxed commands · ${sandboxSettings.allowUnsandboxedCommands === true ? 'allowed' : 'blocked'}`,
          ]
        : ['Not configured']
      return {
        currentModel: contextUsage?.model ?? null,
        sections: [
          { id: 'commands', title: 'COMMANDS', items: commands.length > 0 ? commands.slice(0, 20).map((command) => command.name) : ['None'] },
          { id: 'agents', title: 'AGENTS', items: agents.length > 0 ? agents.slice(0, 20).map((agent) => agent.name) : ['None'] },
          { id: 'settings', title: 'SETTINGS', items: settingItems },
          { id: 'sandbox', title: 'SANDBOX', items: sandboxItems },
          {
            id: 'transport',
            title: 'PROCESS TRANSPORT',
            items: [
              `${claudeProcessTransportStatus().kind} · ${claudeProcessTransportStatus().healthy ? 'healthy' : 'unhealthy'}`,
              ...(claudeProcessTransportStatus().target ? [`target · ${claudeProcessTransportStatus().target}`] : []),
              ...(claudeProcessTransportStatus().lastError ? [`last error · ${claudeProcessTransportStatus().lastError}`] : []),
            ],
          },
          {
            id: 'mcp',
            title: 'MCP',
            items: mcpServers.length > 0
              ? mcpServers.map((server) => `${server.name} · ${server.status}${claudeDynamicMcpServerNames(sessionId).includes(server.name) ? ' · dynamic' : ''}`)
              : ['None'],
          },
          {
            id: 'subagents',
            title: 'SUBAGENTS',
            items: subagents.length > 0 ? formatClaudeSubagentTree(subagents, subagentParents).slice(0, 20) : ['None'],
          },
          {
            id: 'hooks',
            title: 'HOOK TIMELINE',
            items: hookEvents.length > 0
              ? hookEvents.map((event) => `${event.timestamp} · ${event.summary}`)
              : ['None'],
          },
          {
            id: 'output-style',
            title: 'OUTPUT STYLE',
            items: init.output_style ? [init.output_style] : ['default'],
          },
          {
            id: 'account',
            title: 'ACCOUNT',
            items: accountItems.length > 0 ? accountItems : ['Unknown'],
          },
          {
            id: 'plan-usage',
            title: 'PLAN USAGE',
            items: planUsageItems,
          },
          {
            id: 'latency',
            title: 'LATENCY & MODEL USAGE',
            items: claudeLatencyDiagnosticItems(rawMessages),
          },
        ],
      }
    } finally {
      q.close()
    }
  },
}
