/** @jsxImportSource @opentui/react */
// TUI entry for the Task list plugin: loaded on first open, never at boot.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { ThreadedMessage } from '../../../lib/threading'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { createPluginResourceScope } from '../../../lib/plugins/lifecycle'
import { sessionIdentityKey } from '../../../lib/sessionIdentity'
import { buildPluginTaskRegistry, mergeTaskMessages } from '../domain/registry'
import { TaskPanelPopover } from './TaskPanelPopover'

const NO_MESSAGES: ThreadedMessage[] = []

function TaskTargetSurface({ services, instanceId, theme, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const transcript = services['session-transcript']
  const liveContext = services['live-transcript']
  const live = liveContext?.messages ?? NO_MESSAGES
  const control = services['task-control']
  const targetSession = services.session?.session ?? null
  const persisted = transcript?.detail?.threadedMessages ?? NO_MESSAGES
  const messages = useMemo(() => mergeTaskMessages(persisted, live), [persisted, live])
  const registry = useMemo(() => buildPluginTaskRegistry({ persisted: messages, todos: liveContext?.todos, plan: liveContext?.plan }), [messages, liveContext?.todos, liveContext?.plan])
  const identity = useMemo(() => targetSession ? Object.freeze({ sessionId: targetSession.sessionId, provider: targetSession.provider, providerInstanceId: targetSession.providerInstanceId }) : null,
    [targetSession?.sessionId, targetSession?.provider, targetSession?.providerInstanceId])
  const owner = identity ? sessionIdentityKey(identity) : null
  const lifetime = useRef<{ owner: string | null; instanceId: string; signal: AbortSignal } | null>(null)
  const stopping = useRef(false)
  const [controlError, setControlError] = useState<string | null>(null)
  useLayoutEffect(() => {
    const scope = createPluginResourceScope('tasks')
    lifetime.current = { owner, instanceId, signal: scope.signal }
    stopping.current = false
    return () => scope.dispose()
  }, [owner, instanceId])
  const onStopTask = useCallback((taskId: string) => {
    const current = lifetime.current
    if (!control?.stop || !identity || !current || current.signal.aborted || current.owner !== owner || current.instanceId !== instanceId || stopping.current) return
    const signal = current.signal
    stopping.current = true
    setControlError(null)
    void (async () => {
      try { await control.stop!(identity, taskId, signal) }
      catch (cause) { if (!signal.aborted) setControlError(cause instanceof Error ? cause.message : 'Could not stop the task') }
      finally { if (!signal.aborted) stopping.current = false }
    })()
  }, [control, identity, owner, instanceId])
  const onReadTaskOutput = useCallback(async (taskId: string) => {
    const current = lifetime.current
    if (!current || current.signal.aborted || current.owner !== owner || current.instanceId !== instanceId) throw new DOMException('Task view changed', 'AbortError')
    if (!control?.readOutput || !identity) return { available: false, output: '', totalBytes: 0, truncated: false }
    const output = await control.readOutput(identity, taskId, current.signal)
    current.signal.throwIfAborted()
    return output
  }, [control, identity, owner, instanceId])
  const jumpToTask = useCallback((uuid: string) => {
    const current = lifetime.current
    if (!control || !current || current.signal.aborted || current.owner !== owner || current.instanceId !== instanceId) return
    try { control.jumpTo(uuid) }
    catch (cause) { setControlError(cause instanceof Error ? cause.message : 'Could not jump to the task') }
  }, [control, owner, instanceId])
  const overlay = placement === 'overlay'
  if (!overlay && transcript?.status === 'gone') return <text fg={theme.dim}>  That session is no longer available.</text>
  if (!overlay && !transcript?.detail) return <text fg={theme.dim}>{transcript?.status === 'error' ? '  Could not read the session.' : '  Loading…'}</text>
  return (
    <TaskPanelPopover
      registry={registry}
      controlError={controlError}
      docked={!overlay}
      messages={messages}
      theme={theme}
      width={width}
      height={height}
      onClose={close}
      // The reader the jump lands in is behind the overlay; a window has its own transcript beside it.
      onSelectTask={overlay ? jumpToTask : () => {}}
      onKeyHandlerReady={registerKeys}
      onDetach={detach}
      onStopTask={control?.stop && targetSession ? onStopTask : undefined}
      onReadTaskOutput={control?.readOutput && targetSession ? onReadTaskOutput : undefined}
    />
  )
}

function TasksSurface(props: TuiPluginViewProps) {
  const session = props.services.session?.session
  const owner = session ? sessionIdentityKey(session) : 'unselected'
  return <TaskTargetSurface key={`${props.instanceId}:${owner}`} {...props} />
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'tasks',
  views: { tasks: TasksSurface },
}
