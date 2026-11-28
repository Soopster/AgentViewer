/** @jsxImportSource @opentui/react */
import { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule, type PluginWidgetModule } from '../../../lib/plugins/types'
import { focusActive, formatFocusRemaining, type FocusHeldItem } from '../../../lib/plugins/focusMode'
import { popoverRootProps, PopoverDetachButton, fitText, type TuiPluginView, type TuiPluginViewProps, type TuiPluginWidget, type TuiPluginWidgetProps } from '../../../tui/opentui/shell/sdk'
import { focusController, useFocus } from '../store'

const PRESETS = [25, 45, 90] as const
const CHANNEL_LABEL: Record<FocusHeldItem['channel'], string> = { toast: 'notice', notice: 'notice', desktop: 'alert' }

/** A clock that ticks once a second while something on screen counts down. */
function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    // Resample at once: the clock captured at mount is stale by however long nothing ran.
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  return now
}

const clock = (at: number) => new Date(at).toTimeString().slice(0, 5)

function Focus({ services, theme, width, height, placement, registerKeys, close, detach, focused }: TuiPluginViewProps) {
  const controller = focusController(services['focus-mode']!)
  const { state, error, pendingCount } = useFocus(controller)
  const [cursor, setCursor] = useState(0)
  const [notice, setNotice] = useState('')
  const now = useNow(!!state?.active)
  const active = focusActive(state, now) ? state!.active! : null
  const items = active ? [...(state?.held ?? [])].reverse() : [...(state?.last?.held ?? [])].reverse()
  const selected = items[Math.min(cursor, Math.max(0, items.length - 1))]
  useEffect(() => { void controller.refresh() }, [controller])

  const run = (work: () => Promise<void>, done: string) => { setNotice(''); void work().then(() => setNotice(done)).catch(cause => setNotice(cause instanceof Error ? cause.message : String(cause))) }
  useEffect(() => {
    registerKeys(key => {
      if (!focused || key.ctrl || key.meta || key.option) return false
      if (key.shift && /^[a-z]$/.test(key.name)) return false
      const preset = ['1', '2', '3'].indexOf(key.sequence)
      if (preset >= 0) { run(() => controller.start(PRESETS[preset]!), `Focusing for ${PRESETS[preset]}m.`); return true }
      switch (key.name) {
        case 'escape': close(); return true
        case 'down': case 'j': setCursor(value => Math.min(items.length - 1, value + 1)); return true
        case 'up': case 'k': setCursor(value => Math.max(0, value - 1)); return true
        case 'e': if (active) run(() => controller.end(), 'Focus block ended.'); return true
        case 'c': if (!active && state?.last) { run(() => controller.clearDigest(), 'Digest cleared.'); setCursor(0) } return true
        case 'return':
          if (selected?.target && services['session-navigation']) { services['session-navigation'].open(selected.target); close() }
          return true
      }
      return false
    })
    return () => registerKeys(null)
  })

  const overlay = placement === 'overlay'
  const w = overlay ? Math.max(1, Math.min(width - 4, 96)) : width
  const h = overlay ? Math.max(1, Math.min(height - 4, Math.max(14, items.length + 10))) : height
  const inner = Math.max(1, w - (overlay ? 4 : 2))
  const listRows = Math.max(1, h - (overlay ? 2 : 0) - 6 - (notice || error ? 1 : 0))
  const heading = active
    ? `Focusing · ${formatFocusRemaining(active, now)} left · until ${clock(active.endsAt)} · ${state!.held.length + pendingCount} held`
    : state?.last
      ? `Last block ${clock(state.last.startedAt)}–${clock(state.last.endedAt)} · ${state.last.held.length} held`
      : 'Not focusing'
  const hints = active ? ['j/k move', '⏎ open session', '1/2/3 extend 25/45/90m', 'e end now', 'Esc close'] : ['1/2/3 focus 25/45/90m', 'j/k move', '⏎ open session', 'c clear digest', 'Esc close']
  return <box {...popoverRootProps(!overlay, { top: 2, left: Math.max(0, Math.floor((width - w) / 2)), width: w, height: h }, 50)}
    {...(overlay ? { border: true, borderColor: theme.border2, title: ' Focus Mode ' } : {})} backgroundColor={theme.surface} flexDirection="column" paddingX={1}>
    {overlay && detach ? <PopoverDetachButton theme={theme} onPress={detach} /> : null}
    <text fg={active ? theme.amber : theme.text} wrapMode="none">{fitText(`◐ ${heading}`, inner)}</text>
    <text fg={theme.muted} wrapMode="word">Approvals, questions, sessions waiting on you, warnings and errors always come through. Everything else waits here.</text>
    {notice || error ? <text fg={error ? theme.red : theme.muted} wrapMode="none">{fitText(error ?? notice, inner)}</text> : null}
    <text fg={theme.dim} wrapMode="none">{active ? 'HELD SO FAR' : state?.last ? 'HELD LAST BLOCK' : 'NOTHING HELD'}</text>
    <scrollbox height={listRows} width={inner}>
      {!items.length ? <text fg={theme.muted}>{active ? 'Nothing has needed holding yet.' : 'Start a block with 1, 2 or 3, or type /focus 45m in the composer.'}</text> : null}
      {items.map((item, index) => <text key={item.id} wrapMode="none" fg={index === cursor ? theme.cyan : theme.text} onMouseDown={() => setCursor(index)}>
        <span fg={index === cursor ? theme.cyan : theme.dim}>{index === cursor ? '› ' : '  '}</span>
        <span fg={theme.muted}>{`${clock(item.at)} ${CHANNEL_LABEL[item.channel].padEnd(6)} `}</span>
        {fitText(`${item.title}${item.detail ? ` — ${item.detail.replace(/\s+/g, ' ')}` : ''}`, Math.max(1, inner - 16))}
      </text>)}
    </scrollbox>
    <text fg={theme.dim} wrapMode="none">{fitText(hints.join(' · '), inner)}</text>
  </box>
}

function Status({ services, theme, width }: TuiPluginWidgetProps) {
  const service = services?.['focus-mode']
  const { state, pendingCount } = useFocus(service ? focusController(service) : null)
  const now = useNow(!!state?.active)
  if (!state || !focusActive(state, now)) return null
  return <box height={1} width={width} backgroundColor={theme.surface}>
    <text fg={theme.amber} wrapMode="none" selectable={false}>{fitText(`◐ focus ${formatFocusRemaining(state.active!, now)} · ${state.held.length + pendingCount} held`, width)}</text>
  </box>
}

export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'focus-mode', views: { 'focus-mode': Focus } }
export const widgets: PluginWidgetModule<TuiPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'focus-mode', widgets: { status: Status } }
