/** @jsxImportSource @opentui/react */
// Corner widget: the next schedule to fire. Drawn only while one is enabled.
import { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginWidgetModule } from '../../../lib/plugins/types'
import { nextRunLine, nextScheduledRun } from '../../../lib/schedules/describe'
import type { Schedule } from '../../../lib/schedules/types'
import { fitText, type TuiPluginWidget, type TuiPluginWidgetProps } from '../../../tui/opentui/shell/sdk'

const POLL_MS = 30_000

function NextRunWidget({ services, theme, width }: TuiPluginWidgetProps) {
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
    <box width={width} height={3} border borderStyle="single" borderColor={theme.dim} backgroundColor={theme.surface} paddingX={1}>
      <text fg={theme.text} wrapMode="none" selectable={false}>{fitText(`⏱ ${nextRunLine(next, now)}`, width - 4)}</text>
    </box>
  )
}

export const widgets: PluginWidgetModule<TuiPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'schedules', widgets: { 'next-run': NextRunWidget } }
