/** @jsxImportSource @opentui/react */
// TUI entry for the Task list plugin: loaded on first open, never at boot.
import { useCallback, useMemo } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { ThreadedMessage } from '../../../lib/threading'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { TaskPanelPopover } from './TaskPanelPopover'

const NO_MESSAGES: ThreadedMessage[] = []
const IGNORE = () => {}

// The streaming turn's messages lead, then the persisted ones it has not
// superseded: a task the live turn just updated shows its newest state.
function withLiveMessages(persisted: readonly ThreadedMessage[], live: readonly ThreadedMessage[]): ThreadedMessage[] {
  if (live.length === 0) return persisted as ThreadedMessage[]
  const seen = new Set(live.map((message) => message.uuid))
  return [...live, ...persisted.filter((message) => !seen.has(message.uuid))]
}

function TasksSurface({ services, theme, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const transcript = services['session-transcript']
  const live = services['live-transcript']?.messages ?? NO_MESSAGES
  const control = services['task-control']
  const targetSession = services.session?.session ?? null
  const persisted = transcript?.detail?.threadedMessages ?? NO_MESSAGES
  const messages = useMemo(() => withLiveMessages(persisted, live), [persisted, live])
  const onStopTask = useCallback((taskId: string) => {
    if (control?.stop && targetSession) void control.stop(targetSession, taskId)
  }, [control, targetSession])
  const onReadTaskOutput = useCallback((taskId: string) => {
    if (!control?.readOutput || !targetSession) return Promise.resolve({ available: false, output: '', totalBytes: 0, truncated: false })
    return control.readOutput(targetSession, taskId)
  }, [control, targetSession])
  const overlay = placement === 'overlay'
  if (!overlay && transcript?.status === 'gone') return <text fg={theme.dim}>  That session is no longer available.</text>
  if (!overlay && !transcript?.detail) return <text fg={theme.dim}>{transcript?.status === 'error' ? '  Could not read the session.' : '  Loading…'}</text>
  return (
    <TaskPanelPopover
      docked={!overlay}
      messages={messages}
      theme={theme}
      width={width}
      height={height}
      onClose={close}
      // The reader the jump lands in is behind the overlay; a window has its own transcript beside it.
      onSelectTask={overlay && control ? control.jumpTo : IGNORE}
      onKeyHandlerReady={registerKeys}
      onDetach={detach}
      onStopTask={control?.stop && targetSession ? onStopTask : undefined}
      onReadTaskOutput={control?.readOutput && targetSession ? onReadTaskOutput : undefined}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'tasks',
  views: { tasks: TasksSurface },
}
