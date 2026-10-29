'use client'

import { useState, useRef, useCallback } from 'react'
import type { Session } from '@/lib/types'
import { parseSessionTagInput, parseStoredSessionTags, serializeSessionTags } from '@/lib/sessionTags'
import { getSessionTitle } from './presentation'

type EditCallbacks = {
  onRename: (sessionId: string, title: string) => void
  onTag: (sessionId: string, tag: string | null) => void
}

export function useSessionRowEditing(session: Session, { onRename, onTag }: EditCallbacks) {
  const [editing, setEditing] = useState<'title' | 'tag' | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const sessionTitle = getSessionTitle(session)

  const startEdit = useCallback((kind: 'title' | 'tag', value: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(value)
    setEditing(kind)
    // Focus after next render
    setTimeout(() => inputRef.current?.select(), 0)
  }, [])

  const commitTitleEdit = useCallback(async () => {
    setEditing(null)
    const value = editValue.trim()
    if (!value || value === sessionTitle) return
    onRename(session.sessionId, value)
    try {
      await fetch(`/api/sessions/${session.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: value, provider: session.provider, providerInstanceId: session.providerInstanceId }),
      })
    } catch { /* optimistic — ignore errors */ }
  }, [editValue, onRename, session.provider, session.providerInstanceId, session.sessionId, sessionTitle])

  const commitTagEdit = useCallback(async () => {
    setEditing(null)
    const currentTags = parseStoredSessionTags(session.tag)
    const nextTags = parseSessionTagInput(editValue)
    if (JSON.stringify(nextTags) === JSON.stringify(currentTags)) return

    const nextTag = serializeSessionTags(nextTags)
    onTag(session.sessionId, nextTag)
    try {
      await fetch(`/api/sessions/${session.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: nextTag, provider: session.provider, providerInstanceId: session.providerInstanceId }),
      })
    } catch { /* optimistic — ignore errors */ }
  }, [editValue, onTag, session.provider, session.providerInstanceId, session.sessionId, session.tag])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (editing === 'title') commitTitleEdit()
      if (editing === 'tag') commitTagEdit()
    }
    if (e.key === 'Escape') setEditing(null)
  }, [commitTagEdit, commitTitleEdit, editing])

  return { editing, editValue, setEditValue, inputRef, startEdit, commitTitleEdit, commitTagEdit, handleKeyDown }
}
