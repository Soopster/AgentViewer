import {
  createSdkMcpServer,
  tool,
  type HookCallback,
  type HookEvent,
  type StopHookInput,
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { setMessageBookmark } from './messageBookmarks'
import { searchPersistedSessions } from './sessionPersistence'
import { clearWaitingSession, setWaitingSession } from './sessionRuntime'
import type { AgentProvider } from './types'
import { postViewerAttention } from './viewerAttention'
import { appendClaudeHookEvent } from './claudeHookEvents'
import { drainCooperativeInbox } from './agentCoordination'

export type ClaudeViewerContext = {
  getSessionId(): string
  getCwd(): string | undefined
}

function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
}

function providerValue(value: string | undefined): AgentProvider | 'all' | undefined {
  return value === 'claude'
    || value === 'codex'
    || value === 'opencode'
    || value === 'copilot'
    || value === 'pi'
    || value === 'all'
    ? value
    : undefined
}

function createViewerMcpServer(context: ClaudeViewerContext) {
  return createSdkMcpServer({
    name: 'agent-viewer',
    version: '1.0.0',
    instructions: 'Tools for searching Agent Viewer session history, bookmarking important transcript messages, and explicitly requesting human attention.',
    tools: [
      tool(
        'search_sessions',
        'Search Agent Viewer\'s persistent cross-provider session index. Returns session IDs and the best matching transcript snippets.',
        {
          query: z.string().min(1).describe('Text to search for'),
          limit: z.number().int().min(1).max(20).optional(),
          provider: z.enum(['all', 'claude', 'codex', 'opencode', 'copilot', 'pi']).optional(),
          current_project_only: z.boolean().optional().describe('Restrict results to the current working directory'),
        },
        async ({ query, limit, provider, current_project_only }) => {
          const result = await searchPersistedSessions({
            query,
            limit: limit ?? 10,
            provider: providerValue(provider),
            dir: current_project_only ? context.getCwd() : undefined,
            includeWorktrees: true,
          })
          return textResult({
            total: result.total,
            results: result.results.map(({ session, matches }) => ({
              provider: session.provider,
              session_id: session.sessionId,
              title: session.customTitle ?? session.title,
              cwd: session.cwd,
              matches: matches.map((match) => ({
                message_uuid: match.uuid,
                role: match.type,
                snippet: match.snippet,
                timestamp: match.timestamp,
              })),
            })),
          })
        },
        { annotations: { readOnlyHint: true }, searchHint: 'search prior agent sessions and transcript history' },
      ),
      tool(
        'set_bookmark',
        'Add or remove a local Agent Viewer bookmark for a transcript message.',
        {
          message_uuid: z.string().min(1),
          session_id: z.string().optional().describe('Defaults to the current session'),
          provider: z.enum(['claude', 'codex', 'opencode', 'copilot', 'pi']).optional(),
          bookmarked: z.boolean().optional().describe('False removes the bookmark; defaults to true'),
          label: z.string().max(120).optional(),
          preview: z.string().max(500).optional(),
        },
        async ({ message_uuid, session_id, provider, bookmarked, label, preview }) => {
          const targetSessionId = session_id ?? context.getSessionId()
          if (!targetSessionId) throw new Error('session_id is required before the current session has been initialized')
          const bookmarks = await setMessageBookmark({
            provider: providerValue(provider) as AgentProvider | undefined,
            sessionId: targetSessionId,
            uuid: message_uuid,
            bookmarked: bookmarked !== false,
            meta: { label, preview },
          })
          return textResult({
            session_id: targetSessionId,
            message_uuid,
            bookmarked: bookmarks.some((entry) => entry.uuid === message_uuid),
          })
        },
        { searchHint: 'bookmark an important transcript message in Agent Viewer' },
      ),
      tool(
        'post_attention',
        'Post an item to Agent Viewer\'s human attention inbox for this or another session.',
        {
          title: z.string().min(1).max(160),
          detail: z.string().max(1000).optional(),
          session_id: z.string().optional().describe('Defaults to the current session'),
        },
        async ({ title, detail, session_id }) => {
          const targetSessionId = session_id ?? context.getSessionId()
          if (!targetSessionId) throw new Error('session_id is required before the current session has been initialized')
          return textResult(postViewerAttention({
            sessionId: targetSessionId,
            provider: 'claude',
            title,
            detail,
          }))
        },
        { searchHint: 'notify the human through the Agent Viewer attention inbox' },
      ),
    ],
  })
}

function normalizeStopTasks(input: StopHookInput) {
  return (input.background_tasks ?? []).map((task) => ({
    id: task.id,
    type: task.type,
    status: task.status,
    description: task.description,
  }))
}

function normalizeSessionCrons(input: StopHookInput) {
  return (input.session_crons ?? []).map((cron) => ({
    id: cron.id,
    schedule: cron.schedule,
    recurring: cron.recurring,
    prompt: cron.prompt,
  }))
}

function createStopHook(context: ClaudeViewerContext): HookCallback {
  return async (input) => {
    if (input.hook_event_name === 'Stop') {
      const stopInput = input as StopHookInput
      const sessionId = stopInput.session_id || context.getSessionId()
      if (sessionId) {
        // Only drain (and thus acknowledge) mail when this is the first Stop
        // for the turn. stop_hook_active means we already blocked once this
        // turn — draining again risks an infinite block loop, so let it stop
        // and leave any newly-arrived mail queued for the next natural drain
        // (drainCooperativeInbox is also called per-composer-send).
        if (!stopInput.stop_hook_active) {
          const mail = await drainCooperativeInbox(sessionId).catch(() => '')
          if (mail) {
            return { decision: 'block', reason: mail }
          }
        }
        setWaitingSession({
          sessionId,
          provider: 'claude',
          backgroundTasks: normalizeStopTasks(stopInput),
          sessionCrons: normalizeSessionCrons(stopInput),
        })
      }
    }
    return { continue: true }
  }
}

function createLifecycleHook(context: ClaudeViewerContext): HookCallback {
  return async (input) => {
    const record = input as unknown as Record<string, unknown>
    const sessionId = typeof record.session_id === 'string' && record.session_id
      ? record.session_id
      : context.getSessionId()
    if (!sessionId) return { continue: true }

    // Stop is the only hook that marks a session waiting. Any new session/task
    // activity clears that stale marker; SessionEnd also cannot remain waiting.
    if (input.hook_event_name === 'SessionStart'
      || input.hook_event_name === 'SessionEnd'
      || input.hook_event_name === 'TaskCreated'
      || input.hook_event_name === 'TaskCompleted'
      || input.hook_event_name === 'SubagentStart'
      || input.hook_event_name === 'SubagentStop') {
      clearWaitingSession(sessionId)
    }
    if (input.hook_event_name === 'StopFailure') {
      postViewerAttention({
        sessionId,
        provider: 'claude',
        title: 'Claude could not finish cleanly',
        detail: typeof record.error === 'string' ? record.error : 'The Claude runtime emitted a StopFailure lifecycle event.',
      })
    }
    return { continue: true }
  }
}

function createObservabilityHook(context: ClaudeViewerContext): HookCallback {
  return async (input, toolUseId) => {
    const record = input as unknown as Record<string, unknown>
    const sessionId = typeof record.session_id === 'string' && record.session_id
      ? record.session_id
      : context.getSessionId()
    if (sessionId) await appendClaudeHookEvent(sessionId, input, toolUseId)
    return { continue: true }
  }
}

const OBSERVED_HOOK_EVENTS: HookEvent[] = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch',
  'Notification', 'UserPromptSubmit', 'UserPromptExpansion', 'SessionStart',
  'SessionEnd', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop',
  'PreCompact', 'PostCompact', 'PermissionRequest', 'PermissionDenied', 'Setup',
  'TeammateIdle', 'TaskCreated', 'TaskCompleted', 'Elicitation', 'ElicitationResult',
  'ConfigChange', 'WorktreeCreate', 'WorktreeRemove', 'InstructionsLoaded',
  'CwdChanged', 'FileChanged', 'DirectoryAdded',
]

export function createClaudeViewerQueryExtensions(context: ClaudeViewerContext) {
  const lifecycle = createLifecycleHook(context)
  const observability = createObservabilityHook(context)
  const hooks = Object.fromEntries(OBSERVED_HOOK_EVENTS.map((event) => [event, [{ hooks: [observability] }]]))
  return {
    mcpServers: {
      'agent-viewer': createViewerMcpServer(context),
    },
    hooks: {
      ...hooks,
      Stop: [{ hooks: [observability, createStopHook(context)] }],
      SessionStart: [{ hooks: [observability, lifecycle] }],
      SessionEnd: [{ hooks: [observability, lifecycle] }],
      StopFailure: [{ hooks: [observability, lifecycle] }],
      TaskCreated: [{ hooks: [observability, lifecycle] }],
      TaskCompleted: [{ hooks: [observability, lifecycle] }],
      SubagentStart: [{ hooks: [observability, lifecycle] }],
      SubagentStop: [{ hooks: [observability, lifecycle] }],
    },
  }
}
