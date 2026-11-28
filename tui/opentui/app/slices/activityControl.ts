import { useEffect, useMemo, useState } from 'react'
import type { Session } from '../../../../lib/types'
import type { PluginSessionRef } from '../../../../lib/plugins/bookmarks'
import type { PluginActivityControl } from '../../../../lib/plugins/activityControl'
import { interruptTuiSessionTurn, runTuiSessionAction } from '../../../../lib/tui/service'
import { sessionIdentityKey as sessionKey } from '../../../../lib/sessionIdentity'
import { useStableEvent } from '../../useStableEvent'
import type { ComposerDraftSnapshot, NoticeTone } from '../types'

/** How long a drafted prompt waits for its session's composer before giving up. */
const DRAFT_WAIT_MS = 5000

export type ActivityControlContext = {
  sessions: readonly Session[]
  openTabSessions: readonly Session[]
  selectedSessionKeyRef: { readonly current: string | null }
  openSession: (ref: PluginSessionRef) => void
  runCommand: (id: string, session?: Session | null) => void
  composerTargetSession: Session | null | undefined
  composerTargetSessionIdentity: unknown
  composerTextareaRef: { readonly current: { readonly plainText: string } | null }
  composerDraftRef: { readonly current: string }
  applyComposerSnapshot: (snapshot: ComposerDraftSnapshot) => void
  setComposerActive: (active: boolean) => void
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
}

/** The `activity-control` service: what the Activity list may do to the app. */
export function useActivityControl(ctx: ActivityControlContext): PluginActivityControl {
  const [pending, setPending] = useState<{ key: string | null; text: string } | null>(null)
  const sessionFor = (ref: PluginSessionRef): Session => {
    const wanted = { sessionId: ref.sessionId, provider: ref.provider, providerInstanceId: ref.providerInstanceId } as Session
    const key = sessionKey(wanted)
    return [...ctx.sessions, ...ctx.openTabSessions].find(session => sessionKey(session) === key) ?? wanted
  }
  const interrupt = useStableEvent(async (target: PluginSessionRef) => { await interruptTuiSessionTurn(sessionFor(target)) })
  const stopTask = useStableEvent(async (target: PluginSessionRef, taskId: string) => {
    const result = await runTuiSessionAction(sessionFor(target), { action: 'stopTask', taskId, provider: target.provider })
    if (result.stopped !== true) throw new Error('No running task to stop (session not warm)')
  })
  const rerunChecks = useStableEvent(async (cwd: string, ids: readonly string[], version: string) => {
    await (await import('../../shell/proofService')).tuiProof.start(cwd, [...ids], version)
  })
  const draft = useStableEvent((target: PluginSessionRef | undefined, text: string) => {
    if (target) ctx.openSession(target)
    setPending({ key: target ? sessionKey(sessionFor(target)) : null, text })
  })
  const open = useStableEvent((commandId: string, target: PluginSessionRef | undefined) => {
    if (target) ctx.openSession(target)
    ctx.runCommand(commandId, target ? sessionFor(target) : undefined)
  })
  // The text waits until the composer is that session's, so it can never land in another's draft.
  // This effect is declared after the draft restore, which has then already loaded the session's own draft.
  useEffect(() => {
    if (!pending) return
    const current = ctx.composerTargetSession
    if (pending.key && (!current || sessionKey(current) !== pending.key)) return
    setPending(null)
    if (pending.text) {
      const existing = ctx.composerTextareaRef.current?.plainText ?? ctx.composerDraftRef.current
      const next = existing ? `${existing}${existing.endsWith('\n') ? '\n' : '\n\n'}${pending.text}` : pending.text
      ctx.applyComposerSnapshot({ text: next, attachments: [], promptParts: [], cursorOffset: next.length })
      ctx.showNotice('info', 'Added to composer — review it, then send')
    }
    ctx.setComposerActive(true)
  }, [pending, ctx.composerTargetSession, ctx.composerTargetSessionIdentity])
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => { setPending(null); ctx.showNotice('error', 'Could not open that session’s composer') }, DRAFT_WAIT_MS)
    return () => clearTimeout(timer)
  }, [pending])
  return useMemo(() => ({ interrupt, stopTask, rerunChecks, draft, open }), [interrupt, stopTask, rerunChecks, draft, open])
}
