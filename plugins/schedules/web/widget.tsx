'use client'

// Corner widget: the next schedule to fire. Drawn only while one is enabled.
import { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginWidgetModule } from '@/lib/plugins/types'
import type { WebPluginWidget, WebPluginWidgetProps } from '@/components/shell/pluginTypes'
import { nextRunLine, nextScheduledRun } from '@/lib/schedules/describe'
import type { Schedule } from '@/lib/schedules/types'

const POLL_MS = 30_000

function NextRunWidget({ services }: WebPluginWidgetProps) {
  const service = services?.schedules
  const [schedules, setSchedules] = useState<readonly Schedule[]>([])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!service) return
    const controller = new AbortController()
    const load = () => service.list(controller.signal)
      .then(all => { if (!controller.signal.aborted) { setSchedules(all); setNow(Date.now()) } })
      .catch(() => {})
    load()
    const timer = setInterval(load, POLL_MS)
    return () => { controller.abort(); clearInterval(timer) }
  }, [service])
  const next = nextScheduledRun(schedules)
  if (!next) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'var(--text-2)' }}>
      ⏱ {nextRunLine(next, now)}
    </div>
  )
}

export const widgets: PluginWidgetModule<WebPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'schedules', widgets: { 'next-run': NextRunWidget } }
