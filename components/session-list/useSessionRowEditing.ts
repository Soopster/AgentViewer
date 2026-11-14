'use client'

import type { SessionMetadataCallbacks } from '@/components/session-catalog/actions'

import { useState, useRef, useCallback } from 'react'
import type { Session } from '@/lib/types'
import { parseSessionTagInput, parseStoredSessionTags, serializeSessionTags } from '@/lib/sessionTags'
import { getSessionTitle } from './presentation'

export function useSessionRowEditing(session: Session, { onRename, onTag }: SessionMetadataCallbacks) {
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
    onRename(session, value)
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: value, provider: session.provider, providerInstanceId: session.providerInstanceId }),
      })
    } catch { /* optimistic — ignore errors */ }
  }, [editValue, onRename, session, sessionTitle])

  const commitTagEdit = useCallback(async () => {
    setEditing(null)
    const currentTags = parseStoredSessionTags(session.tag)
    const nextTags = parseSessionTagInput(editValue)
    if (JSON.stringify(nextTags) === JSON.stringify(currentTags)) return

    const nextTag = serializeSessionTags(nextTags)
    onTag(session, nextTag)
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: nextTag, provider: session.provider, providerInstanceId: session.providerInstanceId }),
      })
    } catch { /* optimistic — ignore errors */ }
  }, [editValue, onTag, session])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (editing === 'title') commitTitleEdit()
      if (editing === 'tag') commitTagEdit()
    }
    if (e.key === 'Escape') setEditing(null)
  }, [commitTagEdit, commitTitleEdit, editing])

  return { editing, editValue, setEditValue, inputRef, startEdit, commitTitleEdit, commitTagEdit, handleKeyDown }
}
