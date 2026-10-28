import type { Session } from '../../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import { type SessionDiagnosticSection } from '@/lib/types'

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
