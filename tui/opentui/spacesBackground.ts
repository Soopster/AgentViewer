import type { SpacesController } from './spacesStore'
import { readTuiRuntimeActivity, readTuiProtocolRun, readTuiSessions } from '../../lib/tui/service'
import { coordinatorWindowBadges, planCoordinatorWorkspace } from './coordinatorWorkspace'
import { sessionTranscriptUpdatedAt } from './sessionRefreshPolicy'
import type { Session } from '../../lib/types'

/** Metadata only: inactive workspaces never mount a transcript or run its formatter. */
export function startSpacesBackground(controller: SpacesController): () => void {
  let disposed = false
  let pending = false
  let previousRunning = new Set<string>()
  const unread = new Set<string>()
  const revisions = new Map<string, number>()
  const poll = async () => {
    if (pending) return
    pending = true
    try {
      const activity = await readTuiRuntimeActivity()
      if (disposed) return
      const running = new Set(activity.running.map(entry => `${entry.provider ?? 'claude'}:${entry.sessionId}`))
      const needsInput = new Set(activity.attention.map(entry => `${entry.provider ?? 'claude'}:${entry.sessionId}`))
      for (const entry of activity.running) if (entry.pendingPermissions?.length || entry.pendingPrompts?.length) needsInput.add(`${entry.provider ?? 'claude'}:${entry.sessionId}`)
      const active = controller.activeWorkspace()?.id
      const workspaces = controller.getSnapshot().spaces.flatMap(space => space.workspaces)
      const runs = new Map<string, Promise<Awaited<ReturnType<typeof readTuiProtocolRun>>>>()
      for (const workspace of workspaces) {
        const runtime = controller.runtime(workspace)
        const runId = runtime.values.get('coordinatorWorkspaceRunId')
        if (workspace.id !== active && typeof runId === 'string' && !runs.has(runId)) runs.set(runId, readTuiProtocolRun(runId).catch(() => null))
      }
      const metadata = new Map<string, Promise<Session[] | null>>()
      for (const workspace of workspaces) {
        if (workspace.id === active) continue
        const values = controller.runtime(workspace).snapshot()
        const sessions = [...((values.openTabSessions ?? []) as Session[]), ...(values.readerSession ? [values.readerSession as Session] : [])]
        for (const session of sessions) {
          const provider = session.provider ?? 'claude'
          const scope = `${provider}:${session.providerInstanceId ?? ''}`
          if (!metadata.has(scope)) metadata.set(scope, readTuiSessions(provider, session.providerInstanceId).catch(() => null))
        }
      }
      await Promise.all([...runs.values(), ...metadata.values()])
      if (disposed) return
      for (const workspace of workspaces) {
        if (!controller.workspacesFor(workspace.id).length) continue
        const runtime = controller.runtime(workspace)
        const values = runtime.snapshot()
        const sessions = [...((values.openTabSessions ?? []) as Session[]), ...(values.readerSession ? [values.readerSession as Session] : [])]
        const keys = new Set(sessions.map(session => `${session.provider ?? 'claude'}:${session.sessionId}`))
        if (values.workspaceHasSession !== false && typeof values.selectedSessionKeyState === 'string') keys.add(values.selectedSessionKeyState)
        let gate = [...keys].some(key => needsInput.has(key))
        const runId = runtime.values.get('coordinatorWorkspaceRunId')
        const fetched = typeof runId === 'string' ? await runs.get(runId) : null
        const previous = runtime.values.get('coordinatorWorkspace') as Awaited<ReturnType<typeof readTuiProtocolRun>> | undefined
        const snapshot = fetched ?? (previous?.run.id === runId ? previous : null)
        if (disposed) return
        if (snapshot && runtime.values.get('coordinatorWorkspaceRunId') === snapshot.run.id) {
          gate ||= coordinatorWindowBadges(snapshot).size > 0
          runtime.set('coordinatorWorkspace', snapshot)
          const known = new Map(sessions.map(session => [`${session.provider ?? 'claude'}:${session.sessionId}`, session]))
          const plan = planCoordinatorWorkspace(snapshot, known)
          const roster = runtime.values.get('ref:watchedRoster') as { current: { runId: string; keys: Set<string> } | null } | undefined
          if (roster?.current?.runId === snapshot.run.id) {
            const added = plan.targets.filter(target => !roster.current!.keys.has(target.sessionKey))
            plan.targets.forEach(target => roster.current!.keys.add(target.sessionKey))
            const pins = (values.splitPinnedKeys ?? []) as string[]
            const fresh = added.filter(target => !pins.includes(target.sessionKey) && target.sessionKey !== values.selectedSessionKeyState)
            if (fresh.length) {
              runtime.set('openTabSessions', [...sessions, ...fresh.filter(target => !known.has(target.sessionKey)).map(target => target.session)])
              runtime.set('splitPinnedKeys', [...pins, ...fresh.map(target => target.sessionKey)])
              runtime.set('splitPaneCount', Number(values.splitPaneCount ?? 0) + fresh.length)
            }
          }
        }
        const isActive = workspace.id === controller.activeWorkspace()?.id
        for (const session of sessions) {
          const scope = `${session.provider ?? 'claude'}:${session.providerInstanceId ?? ''}`
          const list = await metadata.get(scope)
          const latest = list?.find(entry => entry.sessionId === session.sessionId)
          const key = `${workspace.id}:${scope}:${session.sessionId}`
          const before = revisions.get(key) ?? sessionTranscriptUpdatedAt(session)
          const next = latest ? sessionTranscriptUpdatedAt(latest) : revisions.get(key) ?? sessionTranscriptUpdatedAt(session)
          if (next !== undefined) {
            if (!isActive && before !== undefined && next !== before) unread.add(workspace.id)
            revisions.set(key, next)
          }
        }
        if (isActive) unread.delete(workspace.id)
        else if ([...keys].some(key => previousRunning.has(key) && !running.has(key))) unread.add(workspace.id)
        controller.setAttention(workspace.id, gate ? '?' : unread.has(workspace.id) ? '●' : '')
      }
      previousRunning = running
    } catch { /* Retain confirmed attention on transient read failures. */ }
    finally { pending = false }
  }
  void poll()
  const timer = setInterval(() => { void poll() }, 5000)
  return () => { disposed = true; clearInterval(timer) }
}
