import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { SessionComposerAgentOption } from '../../../lib/types'
import type { Session } from '../../../lib/types'
import { type MentionResult } from '../types'

export type MentionSearchEffectContext = {
  mentionQuery: { start: number; query: string; } | null
  mentionAbortRef: RefObject<AbortController | null>
  setMentionResults: Dispatch<SetStateAction<MentionResult[]>>
  activeProvider: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | undefined
  composerMentionAgentOptions: SessionComposerAgentOption[]
  session: Session | null
  setMentionActiveIndex: Dispatch<SetStateAction<number>>
}

export function runMentionSearchEffect(ctx: MentionSearchEffectContext) {
  const {
    mentionQuery, mentionAbortRef, setMentionResults, activeProvider, composerMentionAgentOptions,
    session, setMentionActiveIndex,
  } = ctx
  if (!mentionQuery) {
    mentionAbortRef.current?.abort()
    mentionAbortRef.current = null
    setMentionResults([])
    return
  }
  const agentMatches: MentionResult[] = activeProvider === 'opencode'
    ? composerMentionAgentOptions
        .filter((agent) => {
          const query = mentionQuery.query.toLowerCase()
          if (!query) return true
          return agent.value.toLowerCase().includes(query)
            || agent.label.toLowerCase().includes(query)
            || (agent.description?.toLowerCase().includes(query) ?? false)
        })
        .slice(0, 8)
        .map((agent) => ({
          kind: 'agent' as const,
          name: agent.value,
          description: agent.description,
          mode: agent.mode,
        }))
    : []
  const cwd = session?.cwd
  if (!cwd) {
    setMentionResults(agentMatches)
    setMentionActiveIndex(0)
    return
  }
  const controller = new AbortController()
  mentionAbortRef.current?.abort()
  mentionAbortRef.current = controller
  const url = `/api/files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(mentionQuery.query)}`
  const handle = window.setTimeout(async () => {
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) return
      const data = await res.json() as { files?: Array<{ path: string; basename: string }> }
      if (controller.signal.aborted) return
      const fileMatches: MentionResult[] = (data.files ?? []).map((file) => ({ kind: 'file', ...file }))
      setMentionResults([...agentMatches, ...fileMatches])
      setMentionActiveIndex(0)
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return
    }
  }, 80)
  return () => {
    window.clearTimeout(handle)
    controller.abort()
  }
}
