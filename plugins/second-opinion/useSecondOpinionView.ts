import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PluginCheckpointsService, TurnCheckpoint } from '../../lib/plugins/checkpoints'
import { defaultReviewerFor, latestReviewFor, secondOpinionFollowUp, type SecondOpinionFinding, type SecondOpinionRecord, type SecondOpinionReviewer, type SecondOpinionService, type SecondOpinionSnapshot } from '../../lib/plugins/secondOpinion'

type ScopedState = <T>(name: string, initial: T) => [T, (next: T | ((previous: T) => T)) => void]
const POLL_RUNNING_MS = 2000
const CONFIRM_MS = 4000

export type SecondOpinionViewInput = {
  service: SecondOpinionService
  checkpoints: PluginCheckpointsService
  cwd: string
  /** Scopes the turn list to one session; null lists every turn in the repository. */
  sessionId: string | null
  insert?: (text: string) => void
  scoped: ScopedState
}

/** Everything both renderers share: the turns, their reviews, the cursor and the actions. */
export function useSecondOpinionView({ service, checkpoints, cwd, sessionId, insert, scoped }: SecondOpinionViewInput) {
  const [turns, setTurns] = useState<TurnCheckpoint[] | null>(null)
  const [snapshot, setSnapshot] = useState<SecondOpinionSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [turnSha, setTurnSha] = scoped<string | null>('turn', null)
  const [findingId, setFindingId] = scoped<string | null>('finding', null)
  const [reviewer, setReviewer] = scoped<SecondOpinionReviewer | null>('reviewer', null)
  /** A session-pinned view lists that session's turns; `s` widens it to every turn in the repository. */
  const [allTurns, setAllTurns] = scoped('all-turns', false)
  const [repositoryTurns, setRepositoryTurns] = useState(0)
  const [armed, setArmed] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [list, next] = await Promise.all([checkpoints.list(cwd, signal), service.read(cwd, signal)])
      if (!alive.current || signal?.aborted) return
      setTurns(sessionId && !allTurns ? list.filter(entry => entry.sessionId === sessionId) : list)
      setRepositoryTurns(list.length)
      setSnapshot(next)
      setError(null)
    } catch (cause) {
      if (alive.current && !signal?.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [checkpoints, service, cwd, sessionId, allTurns])

  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort() }, [refresh])
  const running = snapshot?.reviews.some(record => record.status === 'running') ?? false
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => { void refresh() }, POLL_RUNNING_MS)
    return () => clearInterval(timer)
  }, [running, refresh])
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(null), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [armed])

  const turn = turns?.find(entry => entry.sha === turnSha) ?? turns?.[0] ?? null
  const record: SecondOpinionRecord | undefined = turn ? latestReviewFor(snapshot, turn.sha) : undefined
  const findings = useMemo(() => record?.review?.findings.filter(finding => !record.dismissed.includes(finding.id)) ?? [], [record])
  const finding: SecondOpinionFinding | null = findings.find(entry => entry.id === findingId) ?? findings[0] ?? null
  const nextReviewer: SecondOpinionReviewer = reviewer ?? (snapshot?.settings.reviewer && snapshot.settings.reviewer !== 'auto' ? snapshot.settings.reviewer : defaultReviewerFor(turn?.provider))

  const act = useCallback(async (work: () => Promise<unknown>, done?: string) => {
    setNotice('')
    try { await work(); if (done && alive.current) setNotice(done); await refresh() }
    catch (cause) { if (alive.current) setNotice(cause instanceof Error ? cause.message : String(cause)) }
  }, [refresh])

  const moveTurn = (delta: number) => {
    if (!turns?.length) return
    const index = Math.max(0, turns.findIndex(entry => entry.sha === turn?.sha))
    const next = turns[Math.max(0, Math.min(turns.length - 1, index + delta))]
    if (next) { setTurnSha(next.sha); setFindingId(null); setArmed(null) }
  }
  const moveFinding = (delta: number) => {
    if (!findings.length) return
    const index = Math.max(0, findings.findIndex(entry => entry.id === finding?.id))
    const next = findings[Math.max(0, Math.min(findings.length - 1, index + delta))]
    if (next) setFindingId(next.id)
  }
  /** Reviewing spends model usage, so the first press arms and the second within a few seconds runs. */
  const review = () => {
    if (!turn) return
    if (record?.status === 'running') { setNotice('Already reviewing this turn.'); return }
    if (armed !== turn.sha) { setArmed(turn.sha); setNotice(`Press again to send this turn's diff to ${nextReviewer}.`); return }
    setArmed(null)
    void act(() => service.start(cwd, { checkpointSha: turn.sha, reviewer: nextReviewer }), `Sent to ${nextReviewer}.`)
  }
  const cycleReviewer = () => setReviewer(nextReviewer === 'claude' ? 'codex' : 'claude')
  const cancel = () => { if (record?.status === 'running') void act(() => service.cancel(cwd, record.id), 'Cancelled.') }
  const dismiss = () => { if (record && finding) void act(() => service.dismiss(cwd, record.id, finding.id)) }
  const toggleAuto = () => {
    if (!snapshot) return
    const on = !snapshot.settings.autoReview
    void act(() => service.configure(cwd, { autoReview: on }), on ? 'Every settled turn here will be reviewed (spends model usage).' : 'Auto-review off.')
  }
  const handToAuthor = () => {
    if (!finding || !record) return
    if (!insert) { setNotice('Open a session composer to hand this finding back.'); return }
    insert(secondOpinionFollowUp(finding, record.reviewer))
    setNotice('Finding added to the composer; review it before sending.')
  }

  return {
    turns, snapshot, error, notice, turn, record, findings, finding, nextReviewer, armed: armed === turn?.sha,
    refresh, moveTurn, moveFinding, review, cycleReviewer, cancel, dismiss, toggleAuto, handToAuthor,
    /** True when the list is one session's and could be widened. */
    scopedToSession: !!sessionId && !allTurns, allTurns, repositoryTurns,
    toggleScope: () => { if (sessionId) { setAllTurns(value => !value); setTurnSha(null); setFindingId(null) } },
    selectTurn: (sha: string) => { setTurnSha(sha); setFindingId(null); setArmed(null) },
    selectFinding: setFindingId,
  }
}

export type SecondOpinionViewState = ReturnType<typeof useSecondOpinionView>

/** Age of a turn for its row. */
export function turnAge(createdAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - createdAt) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}
