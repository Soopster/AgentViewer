'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleCheck, Pause, Pencil, Play, Target, Trash2, X } from 'lucide-react'
import type { ComposerAccessoryProps } from '../../../lib/plugins/composer'
import type { Session } from '@/lib/types'
import {
  SESSION_GOAL_STATUS_LABEL,
  SESSION_GOAL_STATUS_TONE,
  type SessionGoal,
} from '@/lib/sessionGoals'

/**
 * Session goal controls for the composer.
 *
 * Two states share one row above the input:
 *   - no goal: a quiet "make this a goal" affordance, offered only once there
 *     is text to turn into an objective.
 *   - goal set: status, progress, and pause/resume/edit/clear.
 *
 * The continuation work happens on the server (lib/sessionGoalEngine.ts); this
 * component only reads and mutates the goal record.
 */

type Props = {
  session: Session | null
  draft: string
  disabled: boolean
  onStart: (objective: string) => void | Promise<void>
  signal: AbortSignal
  visible: boolean
  openRequest: number
  report: ComposerAccessoryProps['report']
}

const TONE_VAR: Record<'info' | 'success' | 'warning' | 'error', string> = {
  info: 'var(--cyan)',
  success: 'var(--green, #4ade80)',
  warning: 'var(--amber, #eaaa40)',
  error: 'var(--red, #f87171)',
}

function goalQuery(session: Session): string {
  const params = new URLSearchParams({ provider: session.provider ?? 'claude' })
  if (session.providerInstanceId) params.set('providerInstanceId', session.providerInstanceId)
  return params.toString()
}

function goalUrl(session: Session): string {
  return `/api/sessions/${encodeURIComponent(session.sessionId)}/goal?${goalQuery(session)}`
}

function goalBody(session: Session): Record<string, unknown> {
  return {
    provider: session.provider ?? 'claude',
    ...(session.providerInstanceId ? { providerInstanceId: session.providerInstanceId } : {}),
  }
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k`
  return `${tokens}`
}

const mono = "'IBM Plex Mono', monospace"
const sans = "'IBM Plex Sans', sans-serif"

export function SessionGoalDock({ session, draft, disabled, onStart, signal, visible, openRequest, report }: Props) {
  const [goal, setGoal] = useState<SessionGoal | null>(null)
  const [open, setOpen] = useState(false)
  const [objective, setObjective] = useState('')
  const [budget, setBudget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionKey = session ? `${session.provider}:${session.providerInstanceId ?? ''}:${session.sessionId}` : null
  const requestIdRef = useRef(0)
  const sessionRef = useRef(session)
  sessionRef.current = session

  const refresh = useCallback(async (): Promise<SessionGoal | null> => {
    const current = sessionRef.current
    if (!current) return null
    const requestId = ++requestIdRef.current
    try {
      const response = await fetch(goalUrl(current), { cache: 'no-store', signal })
      const data = await response.json().catch(() => ({})) as { goal?: SessionGoal | null; error?: string }
      if (signal.aborted || requestId !== requestIdRef.current) return null
      if (!response.ok) throw new Error(data.error ?? `Goal read failed (${response.status})`)
      const next = data.goal ?? null
      setGoal(next)
      return next
    } catch (err) {
      if (!signal.aborted && requestId === requestIdRef.current) setError(err instanceof Error ? err.message : 'Goal read failed')
      return null
    }
  }, [signal])

  useEffect(() => {
    setGoal(null)
    setError(null)
    setOpen(false)
    if (!sessionKey || !visible || signal.aborted) return
    void refresh()
  }, [sessionKey, refresh, visible, signal])

  // Live status while a goal is active — the server keeps working whether or
  // not this tab is focused, so the strip has to follow it.
  useEffect(() => {
    if (goal?.status !== 'active' || !sessionKey || !visible || signal.aborted) return
    const timer = window.setInterval(() => { void refresh() }, 4_000)
    return () => window.clearInterval(timer)
  }, [goal?.status, sessionKey, refresh, visible, signal])

  // The dialog is modal; Escape has to close it like every other overlay here.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy])

  const patch = useCallback(async (body: Record<string, unknown>) => {
    const current = sessionRef.current
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(goalUrl(current), {
        method: 'PATCH', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...goalBody(current), ...body }),
      })
      const data = await response.json().catch(() => ({})) as { goal?: SessionGoal; error?: string }
      if (signal.aborted) return
      if (!response.ok) throw new Error(data.error ?? `Goal update failed (${response.status})`)
      if (data.goal) setGoal(data.goal)
      return data.goal
    } catch (err) {
      if (!signal.aborted) setError(err instanceof Error ? err.message : 'Goal update failed')
      return undefined
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }, [signal])

  const start = useCallback(async () => {
    const current = sessionRef.current
    if (!current) return
    const trimmed = objective.trim()
    if (!trimmed) {
      setError('Describe what “done” looks like first.')
      return
    }
    const parsedBudget = budget.trim() ? Number.parseInt(budget.replace(/[^0-9]/g, ''), 10) : null
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(goalUrl(current), {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...goalBody(current),
          objective: trimmed,
          tokenBudget: parsedBudget && Number.isFinite(parsedBudget) && parsedBudget > 0 ? parsedBudget : null,
        }),
      })
      const data = await response.json().catch(() => ({})) as { goal?: SessionGoal; error?: string }
      if (signal.aborted) return
      if (!response.ok || !data.goal) throw new Error(data.error ?? `Goal start failed (${response.status})`)
      setGoal(data.goal)
      setOpen(false)
      await onStart(trimmed)
    } catch (err) {
      if (!signal.aborted) setError(err instanceof Error ? err.message : 'Goal start failed')
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }, [budget, objective, onStart, signal])

  const clear = useCallback(async () => {
    const current = sessionRef.current
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(goalUrl(current), {
        method: 'DELETE', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(goalBody(current)),
      })
      if (signal.aborted) return
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `Goal clear failed (${response.status})`)
      }
      setGoal(null)
      setOpen(false)
    } catch (err) {
      if (!signal.aborted) setError(err instanceof Error ? err.message : 'Goal clear failed')
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }, [signal])

  const openEditor = useCallback((current: SessionGoal | null) => {
    setObjective(current?.objective ?? draft.trim())
    setBudget(current?.tokenBudget ? String(current.tokenBudget) : '')
    setError(null)
    setOpen(true)
  }, [draft])

  const handledRequest = useRef({ request: 0, signal })
  useEffect(() => {
    if (!openRequest || (handledRequest.current.request === openRequest && handledRequest.current.signal === signal)) return
    handledRequest.current = { request: openRequest, signal }
    void refresh().then(next => { if (!signal.aborted) openEditor(next) })
  }, [openRequest, signal, refresh, openEditor])
  useEffect(() => report({ rows: goal || draft.trim() || open ? 1 : 0, modal: open, summary: goal?.objective ?? null }), [report, goal, draft, open])

  if (!session) return null

  const tone = goal ? TONE_VAR[SESSION_GOAL_STATUS_TONE[goal.status]] : TONE_VAR.info
  const hasDraft = draft.trim().length > 0
  if (!goal && !hasDraft && !open) return null

  return (
    <div className="av-web-goal-dock" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, minWidth: 0 }}>
      {goal ? (
        <>
          <span
            title={goal.objective}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
              height: 22,
              padding: '0 8px',
              borderRadius: 999,
              border: `1px solid color-mix(in srgb, ${tone} 36%, transparent)`,
              background: `color-mix(in srgb, ${tone} 12%, transparent)`,
              color: tone,
              fontFamily: mono,
              fontSize: 10,
            }}
          >
            <Target size={12} aria-hidden="true" />
            {SESSION_GOAL_STATUS_LABEL[goal.status]}
          </span>
          <span
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: sans,
              fontSize: 12,
              color: 'var(--text-2)',
            }}
            title={goal.lastNote ?? goal.objective}
          >
            {goal.objective}
          </span>
          <span style={{ flexShrink: 0, fontFamily: mono, fontSize: 10, color: 'var(--text-3)' }}>
            {goal.continuations}/{goal.maxContinuations}
            {' · '}
            {formatTokens(goal.tokensUsed)}
            {goal.tokenBudget ? `/${formatTokens(goal.tokenBudget)}` : ''} tok
          </span>
          <span style={{ flex: 1 }} />
          {goal.status === 'active' ? (
            <GoalIconButton title="Pause goal" disabled={busy} onClick={() => { void patch({ status: 'paused' }) }}>
              <Pause size={13} />
            </GoalIconButton>
          ) : goal.status !== 'complete' ? (
            <GoalIconButton title="Resume goal" disabled={busy} onClick={() => { void patch({ status: 'active' }) }}>
              <Play size={13} />
            </GoalIconButton>
          ) : null}
          <GoalIconButton title="Edit goal" disabled={busy} onClick={() => openEditor(goal)}>
            <Pencil size={13} />
          </GoalIconButton>
          <GoalIconButton title="Clear goal" disabled={busy} onClick={() => { void clear() }}>
            <Trash2 size={13} />
          </GoalIconButton>
        </>
      ) : (
        <>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="av-hover-control"
            onClick={() => openEditor(null)}
            disabled={disabled}
            title="Turn this message into a goal the session keeps working toward"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 22,
              padding: '0 9px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text-3)',
              fontFamily: mono,
              fontSize: 10,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Target size={12} aria-hidden="true" />
            Make this a goal
          </button>
        </>
      )}
      {(goal?.lastNote || goal?.error) && !open ? (
        <span
          title={goal.error ?? goal.lastNote ?? ''}
          style={{
            flexShrink: 0,
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: mono,
            fontSize: 10,
            color: goal.error ? TONE_VAR.error : 'var(--text-3)',
          }}
        >
          {goal.error ?? goal.lastNote}
        </span>
      ) : null}
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={goal ? 'Edit session goal' : 'Start a session goal'}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.45)',
            padding: 20,
          }}
          onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false) }}
        >
          <div
            style={{
              width: 'min(560px, 100%)',
              maxHeight: 'min(70vh, 560px)',
              overflowY: 'auto',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Target size={15} style={{ color: 'var(--cyan)' }} aria-hidden="true" />
              <span style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif", fontSize: 13, color: 'var(--text)' }}>
                {goal ? 'Session goal' : 'Start a goal'}
              </span>
              <span style={{ flex: 1 }} />
              <GoalIconButton title="Close" disabled={busy} onClick={() => setOpen(false)}>
                <X size={14} />
              </GoalIconButton>
            </div>
            <label style={{ display: 'grid', gap: 5 }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--text-3)' }}>
                Objective — what does done look like?
              </span>
              <textarea
                autoFocus
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                rows={5}
                placeholder="Ship the settings page: persisted theme, saved provider, and a green type-check."
                style={{
                  width: '100%',
                  resize: 'vertical',
                  minHeight: 108,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  color: 'var(--text)',
                  fontFamily: sans,
                  fontSize: 13,
                  lineHeight: 1.5,
                  outline: 'none',
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 5 }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--text-3)' }}>
                Token budget (optional)
              </span>
              <input
                value={budget}
                onChange={(event) => setBudget(event.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                placeholder="No ceiling"
                style={{
                  width: '100%',
                  height: 30,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '0 10px',
                  color: 'var(--text)',
                  fontFamily: mono,
                  fontSize: 12,
                  outline: 'none',
                }}
              />
            </label>
            <p style={{ margin: 0, fontFamily: sans, fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-3)' }}>
              After every turn a cheap auditor checks progress. It keeps the session going on its own, and pauses when
              the goal is done, blocked, or out of budget. Interrupting a turn pauses the goal.
            </p>
            {error ? (
              <p role="alert" style={{ margin: 0, fontFamily: sans, fontSize: 12, color: TONE_VAR.error }}>{error}</p>
            ) : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
              {goal ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { void clear() }}
                  style={dialogButtonStyle(busy, true)}
                >
                  <Trash2 size={13} data-icon="inline-start" /> DELETE
                </button>
              ) : null}
              <span style={{ flex: 1 }} />
              <button type="button" disabled={busy} onClick={() => setOpen(false)} style={dialogButtonStyle(busy, false)}>
                CANCEL
              </button>
              <button
                type="button"
                disabled={busy || !objective.trim()}
                onClick={() => {
                  if (!goal) { void start(); return }
                  void patch({
                    objective: objective.trim(),
                    tokenBudget: budget.trim() ? Number.parseInt(budget, 10) : null,
                  }).then((updated) => { if (updated) setOpen(false) })
                }}
                style={{ ...dialogButtonStyle(busy || !objective.trim(), false), background: 'var(--cyan)', color: 'var(--surface)', borderColor: 'transparent' }}
              >
                {goal ? <><CircleCheck size={13} data-icon="inline-start" /> SAVE</> : <><Target size={13} data-icon="inline-start" /> START</>}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function GoalIconButton({
  title, disabled, onClick, children,
}: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="av-hover-control"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        padding: 0,
        borderRadius: 5,
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
        color: 'var(--text-2)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

function dialogButtonStyle(disabled: boolean, destructive: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 28,
    padding: '0 10px',
    borderRadius: 6,
    border: `1px solid ${destructive ? 'color-mix(in srgb, var(--red, #f87171) 40%, transparent)' : 'var(--border)'}`,
    background: destructive ? 'color-mix(in srgb, var(--red, #f87171) 10%, transparent)' : 'var(--surface-2)',
    color: destructive ? 'var(--red, #f87171)' : 'var(--text-2)',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  }
}
