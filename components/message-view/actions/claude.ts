import type { Session } from '../../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import { type MutableRefObject } from 'react'
import { type ContextComposerHandle } from '../../ContextComposer'
import { readOptionalJsonResponse } from '@/lib/httpResponse'

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
