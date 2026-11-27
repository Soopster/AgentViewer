// The root's half of the session pull request: linking the one a transcript
// shows being opened, and doing its next step. Work that needs judgement becomes
// a prompt in that session's composer; ready and merge go to the review surface,
// which asks before it changes anything on GitHub.
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { buildPrHandoffPrompt, PR_ACTION_LABELS, resolvePrNextAction } from '../../../../lib/github/prWork'
import { findSessionPullRequest } from '../../../../lib/github/sessionPr'
import type { GithubPrDetail } from '../../../../lib/github/types'
import { updateTuiSessionInbox, type TuiSessionDetail } from '../../../../lib/tui/service'
import type { LinkedPullRequest, Session } from '../../../../lib/types'
import { sessionKey } from '../sessionList'
import { peekSessionPr } from '../../sessionPrStore'
import { useStableEvent } from '../../useStableEvent'
import { registerSessionPrHandler, type SessionPrIntent } from '../SessionPrStrip'

export function useSessionPrAutoLink(session: Session | null, detail: TuiSessionDetail | null, setSessions: Dispatch<SetStateAction<Session[]>>): void {
  const offered = useRef(new Set<string>())
  // Only the transcript that is this session's own: during a switch the detail is still the previous one's.
  const own = !!session && !session.isPending && detail?.info?.sessionId === session.sessionId
  const messages = own ? detail.threadedMessages : undefined
  const created = useMemo(() => messages ? findSessionPullRequest(messages) : null, [messages])

  useEffect(() => {
    if (!session || !created || !session.cwd || session.inbox?.linkedPr || session.inbox?.declinedPrUrls?.includes(created.url)) return
    const offer = `${sessionKey(session)} ${created.url}`
    if (offered.current.has(offer)) return
    offered.current.add(offer)
    const linkedPr: LinkedPullRequest = { ...created, cwd: session.cwd }
    void updateTuiSessionInbox(session, 'auto-link-pr', linkedPr).then(inbox => {
      const key = sessionKey(session)
      setSessions(current => current.map(entry => sessionKey(entry) === key ? { ...entry, inbox } : entry))
    }).catch(() => { offered.current.delete(offer) })
  }, [created, session, setSessions])
}

export function useSessionPrActions(host: {
  openReview: (session: Session) => void
  selectSession: (session: Session) => void
  composerTargetSession: Session | null
  insertPrompt: (text: string) => void
  notify: (message: string) => void
}) {
  // A prompt for a session that is not the composer's yet waits for it, so it never lands in another chat's draft.
  const [waiting, setWaiting] = useState<{ key: string; prompt: string } | null>(null)
  const targetKey = host.composerTargetSession ? sessionKey(host.composerTargetSession) : null
  const insert = useStableEvent((prompt: string) => host.insertPrompt(prompt))
  useEffect(() => {
    if (!waiting || waiting.key !== targetKey) return
    setWaiting(null)
    insert(waiting.prompt)
  }, [waiting, targetKey, insert])

  const act = useStableEvent((session: Session, intent: SessionPrIntent, detail: GithubPrDetail | null) => {
    const next = detail ? resolvePrNextAction(detail) : null
    if (intent === 'open' || !detail || !next || next === 'ready' || next === 'merge') { host.openReview(session); return }
    const key = sessionKey(session)
    if (key !== targetKey) host.selectSession(session)
    setWaiting({ key, prompt: buildPrHandoffPrompt(next, detail) })
  })
  useEffect(() => registerSessionPrHandler(act), [act])

  const detailFor = (session: Session) => {
    const pr = session.inbox?.linkedPr
    return pr ? peekSessionPr(pr.cwd ?? session.cwd ?? '', pr).detail : null
  }

  const runNextStep = useStableEvent((session: Session | null) => {
    if (!session?.inbox?.linkedPr) { host.notify('No pull request is linked to this session'); return }
    act(session, 'act', detailFor(session))
  })

  const menuItems = useStableEvent((session: Session) => {
    const detail = detailFor(session)
    const next = detail ? resolvePrNextAction(detail) : null
    return next ? [{ label: `Pull request: ${PR_ACTION_LABELS[next]}`, run: () => act(session, 'act', detail) }] : []
  })

  return { runNextStep, menuItems }
}
