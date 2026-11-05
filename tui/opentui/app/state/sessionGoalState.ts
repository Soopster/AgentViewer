/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useRef, useState } from 'react'
import { type Session } from '../../../../lib/types'
import {
  clearTuiSessionGoal,
  patchTuiSessionGoal,
  readTuiSessionGoal,
  startTuiSessionGoal,
  type TuiSessionGoal,
} from '../../../../lib/tui/service'
import { sessionKey } from '../sessionList'

/**
 * The goal attached to the composer's target session, plus the small dialog
 * that starts or edits it. Mirrors the web dock in components/message-view/
 * SessionGoalDock.tsx: read, poll while active, pause/resume, edit, clear.
 *
 * The continuation work happens server-side (lib/sessionGoalEngine.ts), so the
 * TUI only ever holds a status snapshot.
 */
export function useSessionGoalState(session: Session | null) {
  const [goal, setGoal] = useState<TuiSessionGoal | null>(null)
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [goalFocus, setGoalFocus] = useState<'objective' | 'budget'>('objective')
  const [objective, setObjective] = useState('')
  const [budget, setBudget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const key = session ? sessionKey(session) : null
  const keyRef = useRef(key)
  keyRef.current = key

  const refresh = useCallback(async (): Promise<TuiSessionGoal | null> => {
    const current = sessionRef.current
    if (!current) {
      setGoal(null)
      return null
    }
    // A slow read for the session we just left must not paint its goal onto the
    // one now on screen.
    const requestedKey = keyRef.current
    setLoading(true)
    try {
      const next = await readTuiSessionGoal(current)
      if (keyRef.current !== requestedKey) return null
      setGoal(next)
      return next
    } catch (err) {
      if (keyRef.current === requestedKey) setError(err instanceof Error ? err.message : 'Could not read the session goal')
      return null
    } finally {
      if (keyRef.current === requestedKey) setLoading(false)
    }
  }, [])

  // Switching sessions must not show the previous session's goal.
  useEffect(() => {
    setGoal(null)
    setError(null)
    setBusy(false)
    setDialogOpen(false)
    if (!key) return
    void refresh()
  }, [key, refresh])

  // The server keeps working while the TUI sits idle, so an active goal has to
  // be followed.
  useEffect(() => {
    if (goal?.status !== 'active' || !key) return
    const timer = setInterval(() => { void refresh() }, 4_000)
    return () => clearInterval(timer)
  }, [goal?.status, key, refresh])

  const openDialog = useCallback((prefill?: string) => {
    const draft = prefill?.trim() ?? ''
    setObjective(draft || goal?.objective || '')
    setBudget(goal?.tokenBudget ? String(goal.tokenBudget) : '')
    setGoalFocus('objective')
    setError(null)
    setDialogOpen(true)
  }, [goal])

  const closeDialog = useCallback(() => {
    if (busy) return
    setDialogOpen(false)
    setError(null)
  }, [busy])

  /** Creates the goal. Resolves to the objective so the caller can send it. */
  const start = useCallback(async (): Promise<string | null> => {
    const current = sessionRef.current
    if (!current) {
      setError('Open a session before starting a goal')
      return null
    }
    const trimmed = objective.trim()
    if (!trimmed) {
      setError('Describe what done looks like first')
      return null
    }
    setBusy(true)
    setError(null)
    const requestedKey = keyRef.current
    try {
      const digits = budget.replace(/[^0-9]/g, '')
      const next = await startTuiSessionGoal(current, {
        objective: trimmed,
        tokenBudget: digits ? Number(digits) : null,
      })
      if (keyRef.current !== requestedKey) return null
      setGoal(next)
      setDialogOpen(false)
      return trimmed
    } catch (err) {
      if (keyRef.current === requestedKey) setError(err instanceof Error ? err.message : 'Could not start the goal')
      return null
    } finally {
      setBusy(false)
    }
  }, [budget, objective])

  const save = useCallback(async (): Promise<boolean> => {
    const current = sessionRef.current
    if (!current) return false
    const trimmed = objective.trim()
    if (!trimmed) {
      setError('The objective cannot be empty')
      return false
    }
    setBusy(true)
    setError(null)
    const requestedKey = keyRef.current
    try {
      const digits = budget.replace(/[^0-9]/g, '')
      const next = await patchTuiSessionGoal(current, {
        objective: trimmed,
        tokenBudget: digits ? Number(digits) : null,
      })
      if (keyRef.current !== requestedKey) return false
      if (next) setGoal(next)
      setDialogOpen(false)
      return true
    } catch (err) {
      if (keyRef.current === requestedKey) setError(err instanceof Error ? err.message : 'Could not save the goal')
      return false
    } finally {
      setBusy(false)
    }
  }, [budget, objective])

  const setStatus = useCallback(async (status: TuiSessionGoal['status']) => {
    const current = sessionRef.current
    if (!current) return
    setBusy(true)
    setError(null)
    const requestedKey = keyRef.current
    try {
      const next = await patchTuiSessionGoal(current, { status })
      if (keyRef.current !== requestedKey) return
      if (next) setGoal(next)
    } catch (err) {
      if (keyRef.current === requestedKey) setError(err instanceof Error ? err.message : 'Could not update the goal')
    } finally {
      setBusy(false)
    }
  }, [])

  const clear = useCallback(async () => {
    const current = sessionRef.current
    if (!current) return
    setBusy(true)
    setError(null)
    const requestedKey = keyRef.current
    try {
      await clearTuiSessionGoal(current)
      if (keyRef.current !== requestedKey) return
      setGoal(null)
      setDialogOpen(false)
    } catch (err) {
      if (keyRef.current === requestedKey) setError(err instanceof Error ? err.message : 'Could not clear the goal')
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    goal, loading, error, setError,
    dialogOpen, openDialog, closeDialog,
    goalFocus, setGoalFocus,
    objective, setObjective, budget, setBudget,
    busy, start, save, setStatus, clear, refresh,
  }
}
