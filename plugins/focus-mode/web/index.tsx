'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { WebPluginView, WebPluginViewProps, WebPluginWidget, WebPluginWidgetProps } from '@/components/shell/pluginTypes'
import { PLUGIN_API_VERSION, type PluginViewModule, type PluginWidgetModule } from '@/lib/plugins/types'
import { focusActive, formatFocusRemaining, parseFocusDuration } from '@/lib/plugins/focusMode'
import { focusController, useFocus } from '../store'

const PRESETS = [25, 45, 90] as const
const clock = (at: number) => new Date(at).toTimeString().slice(0, 5)

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

function Focus({ services }: WebPluginViewProps) {
  const controller = focusController(services['focus-mode']!)
  const { state, error, pendingCount } = useFocus(controller)
  const [custom, setCustom] = useState('')
  const [notice, setNotice] = useState('')
  const now = useNow(!!state?.active)
  useEffect(() => { void controller.refresh() }, [controller])
  const active = focusActive(state, now) ? state!.active! : null
  const items = [...(active ? state?.held ?? [] : state?.last?.held ?? [])].reverse()
  const run = (work: () => Promise<void>, done: string) => { setNotice(''); void work().then(() => setNotice(done)).catch(cause => setNotice(cause instanceof Error ? cause.message : String(cause))) }
  const startCustom = () => {
    const minutes = parseFocusDuration(custom)
    if (minutes === null) { setNotice(`Not a duration: "${custom}". Try 45m or 1h30m.`); return }
    run(() => controller.start(minutes), `Focusing for ${minutes}m.`)
  }
  return <div className="flex h-full min-h-0 flex-col gap-3 p-4">
    <header className="flex flex-col gap-1">
      <h2 className="text-base font-semibold">{active ? `Focusing · ${formatFocusRemaining(active, now)} left` : 'Focus Mode'}</h2>
      <p className="text-sm text-muted-foreground">
        {active ? `Until ${clock(active.endsAt)} · ${state!.held.length + pendingCount} held so far. ` : ''}
        Approvals, questions, sessions waiting on you, warnings and errors always come through. Everything else waits for the digest.
      </p>
    </header>
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map(minutes => <Button key={minutes} size="sm" variant={active ? 'outline' : 'default'} onClick={() => run(() => controller.start(minutes), `Focusing for ${minutes}m.`)}>{active ? `Extend to ${minutes}m` : `${minutes}m`}</Button>)}
      <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); startCustom() }}>
        <input aria-label="Focus duration" value={custom} onChange={event => setCustom(event.target.value)} placeholder="1h30m" className="h-8 w-24 rounded border bg-background px-2 text-sm" />
        <Button size="sm" variant="outline" type="submit">Start</Button>
      </form>
      {active ? <Button size="sm" variant="destructive" onClick={() => run(() => controller.end(), 'Focus block ended.')}>End now</Button> : null}
      {!active && state?.last ? <Button size="sm" variant="ghost" onClick={() => run(() => controller.clearDigest(), 'Digest cleared.')}>Clear digest</Button> : null}
    </div>
    {notice || error ? <p role="status" className={`text-sm ${error ? 'text-red-600' : 'text-muted-foreground'}`}>{error ?? notice}</p> : null}
    <section className="min-h-0 flex-1 overflow-auto" aria-label="Held notifications">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {active ? 'Held so far' : state?.last ? `Held ${clock(state.last.startedAt)}–${clock(state.last.endedAt)}` : 'Nothing held'}
      </h3>
      {!items.length ? <p className="text-sm text-muted-foreground">{active ? 'Nothing has needed holding yet.' : 'Start a block, or type /focus 45m in the composer.'}</p> : null}
      <ul className="flex flex-col gap-1">
        {items.map(item => <li key={item.id} className="flex gap-3 rounded px-2 py-1 text-sm hover:bg-muted">
          <span className="w-12 shrink-0 text-xs text-muted-foreground">{clock(item.at)}</span>
          <span className="min-w-0 flex-1">
            {item.target && services['session-navigation']
              ? <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => services['session-navigation']!.open(item.target!)}>{item.title}</button>
              : item.title}
            {item.detail ? <span className="block truncate text-xs text-muted-foreground">{item.detail}</span> : null}
          </span>
        </li>)}
      </ul>
    </section>
  </div>
}

function Status({ services }: WebPluginWidgetProps) {
  const service = services?.['focus-mode']
  const { state, pendingCount } = useFocus(service ? focusController(service) : null)
  const now = useNow(!!state?.active)
  if (!state || !focusActive(state, now)) return null
  return <div style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'var(--text-2)' }}>
    ◐ focus {formatFocusRemaining(state.active!, now)} · {state.held.length + pendingCount} held
  </div>
}

export const module: PluginViewModule<WebPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'focus-mode', views: { 'focus-mode': Focus } }
export const widgets: PluginWidgetModule<WebPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'focus-mode', widgets: { status: Status } }
