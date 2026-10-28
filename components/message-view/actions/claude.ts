import type { Session } from '../../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import { type SessionDiagnosticSection } from '@/lib/types'
import { type MutableRefObject } from 'react'
import { type ContextComposerHandle } from '../../ContextComposer'
import { readOptionalJsonResponse } from '@/lib/httpResponse'

export type SearchClaudeHookEventsContext = {
  session: Session | null
  setClaudeHookSearching: Dispatch<SetStateAction<boolean>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  claudeHookQuery: string
  setDiagnosticSections: Dispatch<SetStateAction<SessionDiagnosticSection[]>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
}

export async function runSearchClaudeHookEvents(ctx: SearchClaudeHookEventsContext) {
  const {
    session, setClaudeHookSearching, setSessionActionError, claudeHookQuery, setDiagnosticSections,
    setSessionActionNotice,
  } = ctx
  if (!session || session.provider !== 'claude') return
  setClaudeHookSearching(true)
  setSessionActionError(null)
  try {
    const res = await fetch(`/api/sessions/${session.sessionId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'listHookEvents', provider: 'claude', query: claudeHookQuery, limit: 100 }),
    })
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      throw new Error(errorData.error ?? `HTTP ${res.status}`)
    }
    const data = await res.json().catch(() => ({}))
    if (data.error) throw new Error(data.error)
    const result = data.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : data
    const events = Array.isArray(result.events) ? result.events as Array<Record<string, unknown>> : []
    const items = events.map((event) => `${String(event.timestamp ?? '')} · ${String(event.summary ?? event.event ?? 'Hook')}`)
    setDiagnosticSections((sections) => sections.map((section) => section.id === 'hooks'
      ? { ...section, items: items.length > 0 ? items : ['None'] }
      : section))
    setSessionActionNotice(`Hook timeline · ${events.length} match${events.length === 1 ? '' : 'es'}`)
  } catch (err) {
    setSessionActionError(err instanceof Error ? err.message : 'Failed to search hook timeline')
  } finally {
    setClaudeHookSearching(false)
  }
}

export type ApplyClaudeMcpPermissionModeContext = {
  setClaudeMcpPermissionModes: Dispatch<SetStateAction<Record<string, 'default' | 'auto'>>>
  runClaudeSessionAction: (action: string, extra: Record<string, unknown>, busyKey: string, successNotice: string) => Promise<Record<string, unknown> | null>
}

export async function runApplyClaudeMcpPermissionMode(ctx: ApplyClaudeMcpPermissionModeContext, serverName: string, permissionModeKey: string, mode: 'default' | 'auto' | null, previous: 'default' | 'auto' | undefined) {
  const {
    setClaudeMcpPermissionModes, runClaudeSessionAction,
  } = ctx
  setClaudeMcpPermissionModes((current) => {
    const next = { ...current }
    if (mode === null) delete next[permissionModeKey]
    else next[permissionModeKey] = mode
    return next
  })
  const result = await runClaudeSessionAction(
    'setMcpPermissionModeOverride',
    { serverName, mode },
    `mcp:permission:${serverName}`,
    mode === null ? `${serverName} MCP policy cleared.` : `${serverName} MCP policy set to ${mode}.`,
  )
  if (!result) {
    setClaudeMcpPermissionModes((current) => {
      const next = { ...current }
      if (previous) next[permissionModeKey] = previous
      else delete next[permissionModeKey]
      return next
    })
  }
}

export type BackgroundClaudeTasksContext = {
  session: Session | null
  backgroundingTasks: boolean
  setBackgroundingTasks: Dispatch<SetStateAction<boolean>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  textareaRef: MutableRefObject<ContextComposerHandle | null>
}

export async function runBackgroundClaudeTasks(ctx: BackgroundClaudeTasksContext) {
  const {
    session, backgroundingTasks, setBackgroundingTasks, setSessionActionError,
    setSessionActionNotice, textareaRef,
  } = ctx
  if (!session || session.provider !== 'claude' || session.isPending || backgroundingTasks) return
  setBackgroundingTasks(true)
  setSessionActionError(null)
  setSessionActionNotice(null)
  try {
    const res = await fetch(`/api/sessions/${session.sessionId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', action: 'backgroundTasks' }),
    })
    const data = await readOptionalJsonResponse(res, {})
    if (data.error) throw new Error(data.error)
    const backgrounded = data.result?.backgrounded === true
    setSessionActionNotice(backgrounded ? 'Claude task moved to background.' : 'No foreground Claude task to background.')
  } catch (err) {
    setSessionActionError(err instanceof Error ? err.message : 'Failed to background Claude task')
  } finally {
    setBackgroundingTasks(false)
    textareaRef.current?.focus()
  }
}
