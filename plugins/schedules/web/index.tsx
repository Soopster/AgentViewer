'use client'

// Web entry for the Schedules plugin: its own chunk, loaded on first open.
import { useCallback, useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import type { ScheduleListing } from '@/lib/schedules/service'
import { describeSchedule, formatCountdown, outcomeGlyph } from '@/lib/schedules/describe'

const REFRESH_MS = 5000

function SchedulesView({ services, close }: WebPluginViewProps) {
  const service = services.schedules!
  const [rows, setRows] = useState<ScheduleListing[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const reload = useCallback((signal?: AbortSignal) => {
    service.list(signal)
      .then(all => { if (!signal?.aborted) { setRows(all); setNow(Date.now()); setError(null) } })
      .catch((err: unknown) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Failed to load schedules') })
  }, [service])

  useEffect(() => {
    const controller = new AbortController()
    reload(controller.signal)
    const timer = setInterval(() => reload(controller.signal), REFRESH_MS)
    return () => { controller.abort(); clearInterval(timer) }
  }, [reload])

  const act = (work: Promise<void>) => work.then(() => reload()).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Action failed'))

  return (
    <div className="flex h-full flex-col gap-2 p-3 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">⏱ Schedules</h2>
        <button type="button" onClick={close} className="text-muted-foreground hover:text-foreground">Close</button>
      </div>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {rows && rows.length === 0 ? <p className="text-muted-foreground">No schedules yet. Use <code>/schedule every 1h &lt;prompt&gt;</code> in a session.</p> : null}
      <ul className="flex flex-col gap-1 overflow-auto">
        {(rows ?? []).map(row => {
          const last = row.recentRuns[0]
          return (
            <li key={row.id} className="rounded border border-border p-2">
              <div className="flex items-center gap-2">
                <span title={last?.error ?? last?.outcome ?? 'never run'} className={last?.outcome === 'failed' ? 'text-destructive' : last?.outcome === 'ok' ? 'text-green-600' : 'text-muted-foreground'}>{outcomeGlyph(last)}</span>
                <span className="flex-1 truncate font-medium">{row.name}</span>
                <span className="text-muted-foreground">{row.enabled ? formatCountdown(row.nextRunAt, now) : 'paused'}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground">{describeSchedule(row)}{last?.error ? ` · ${last.error}` : ''}</div>
              <div className="mt-1 flex gap-3 text-xs">
                <button type="button" onClick={() => act(service.runNow(row.id))}>Run now</button>
                <button type="button" onClick={() => act(service.setEnabled(row.id, !row.enabled))}>{row.enabled ? 'Pause' : 'Resume'}</button>
                {armed === row.id
                  ? <>
                      <button type="button" className="text-destructive" onClick={() => { setArmed(null); act(service.remove(row.id)) }}>Confirm delete</button>
                      <button type="button" onClick={() => setArmed(null)}>Keep</button>
                    </>
                  : <button type="button" onClick={() => setArmed(row.id)}>Delete</button>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'schedules',
  views: { schedules: SchedulesView },
}
