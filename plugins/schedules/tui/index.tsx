/** @jsxImportSource @opentui/react */
// TUI entry for the Schedules plugin: loaded on first open, never at boot.
import { useCallback, useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { ScheduleListing } from '../../../lib/schedules/service'
import { describeSchedule, formatCountdown, outcomeGlyph } from '../../../lib/schedules/describe'
import { fitText, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'

const REFRESH_MS = 5000
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function SchedulesSurface({ services, theme, width, height, placement, zIndex, registerKeys, close }: TuiPluginViewProps) {
  const service = services.schedules!
  const [rows, setRows] = useState<ScheduleListing[] | null>(null)
  const [index, setIndex] = useState(0)
  const [armedDelete, setArmedDelete] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const reload = useCallback((signal?: AbortSignal) => {
    service.list(signal)
      .then(all => { if (!signal?.aborted) { setRows(all); setNow(Date.now()) } })
      .catch((err: unknown) => {
        if (signal?.aborted) return
        setRows(current => current ?? [])
        services.notices?.show('error', err instanceof Error ? err.message : 'Failed to load schedules')
      })
  }, [service, services.notices])

  useEffect(() => {
    const controller = new AbortController()
    reload(controller.signal)
    const timer = setInterval(() => reload(controller.signal), REFRESH_MS)
    return () => { controller.abort(); clearInterval(timer) }
  }, [reload])

  const list = rows ?? []
  const act = useCallback((work: Promise<void>, failure: string) => {
    work.then(() => reload()).catch((err: unknown) => services.notices?.show('error', err instanceof Error ? err.message : failure))
  }, [reload, services.notices])

  useEffect(() => {
    registerKeys((key) => {
      if (key.name === 'escape' || key.name === 'q' || (key.ctrl && key.name === 'c')) {
        if (armedDelete) { setArmedDelete(null); return true }
        close()
        return true
      }
      if (list.length === 0) return true
      const selected = list[clamp(index, 0, list.length - 1)]
      // Any key other than the second x disarms a pending delete.
      const wasArmed = armedDelete === selected.id
      if (key.sequence !== 'x' && key.name !== 'delete') setArmedDelete(null)
      if (key.name === 'j' || key.name === 'down') { setIndex(i => Math.min(i + 1, list.length - 1)); return true }
      if (key.name === 'k' || key.name === 'up') { setIndex(i => Math.max(i - 1, 0)); return true }
      if (key.sequence === 'p') { act(service.setEnabled(selected.id, !selected.enabled), 'Could not change the schedule'); return true }
      if (key.sequence === 'r') { act(service.runNow(selected.id), 'Run failed'); return true }
      if (key.sequence === 'x' || key.name === 'delete') {
        if (!wasArmed) { setArmedDelete(selected.id); return true }
        setArmedDelete(null)
        act(service.remove(selected.id), 'Could not delete the schedule')
        return true
      }
      return placement === 'overlay'
    })
    return () => registerKeys(null)
  }, [registerKeys, list, index, armedDelete, placement, close, act, service])

  const docked = placement !== 'overlay'
  const overlayW = docked ? width : Math.min(width - 6, 100)
  const rowW = overlayW - 4
  const selectedIndex = clamp(index, 0, Math.max(list.length - 1, 0))
  const maxRows = Math.max(Math.min(list.length, docked ? height - 4 : height - 9), 1)
  const startIdx = clamp(selectedIndex - Math.floor(maxRows / 2), 0, Math.max(0, list.length - maxRows))
  const visible = list.slice(startIdx, startIdx + maxRows)
  const armed = armedDelete ? list.find(row => row.id === armedDelete) : undefined
  const footer = armed
    ? `Delete "${armed.name}"? x again deletes · esc keeps`
    : 'j/k move · r run now · p pause/resume · x delete · esc close'
  return (
    <box
      {...(docked
        ? { width, height }
        : { position: 'absolute' as const, top: 4, left: Math.max(Math.floor((width - overlayW) / 2), 2), width: overlayW, zIndex, border: true, borderStyle: 'single' as const, borderColor: theme.cyan })}
      backgroundColor={theme.surface}
      flexDirection="column"
    >
      <box paddingX={1} paddingTop={docked ? 0 : 1} backgroundColor={theme.surface2}>
        <text fg={theme.cyan}>{fitText(`⏱ SCHEDULES  ·  ${rows ? `${list.length} total` : 'loading…'}`, rowW)}</text>
      </box>
      {rows && list.length === 0 ? (
        <box paddingX={1} paddingY={1}>
          <text fg={theme.dim}>{fitText('No schedules yet — try /schedule every 1h <prompt> in a session.', rowW)}</text>
        </box>
      ) : visible.map((row, i) => {
        const selected = startIdx + i === selectedIndex
        const last = row.recentRuns[0]
        const glyphColor = last?.outcome === 'failed' ? theme.red : last?.outcome === 'ok' ? theme.green : theme.dim
        const next = row.enabled ? formatCountdown(row.nextRunAt, now) : 'paused'
        return (
          <box key={row.id} paddingX={1} backgroundColor={selected ? theme.surface3 : theme.surface} flexDirection="column">
            <box flexDirection="row">
              <text fg={glyphColor} wrapMode="none">{`${selected ? '>' : ' '} ${outcomeGlyph(last)} `}</text>
              <text fg={selected ? theme.text : theme.muted} wrapMode="none">{fitText(row.name, rowW - next.length - 5)}</text>
              <box flexGrow={1} />
              <text fg={row.enabled ? theme.amber : theme.dim} wrapMode="none">{next}</text>
            </box>
            <box paddingLeft={4}>
              <text fg={theme.dim} wrapMode="none">{fitText(last?.error ? `${describeSchedule(row)} · ${last.error}` : describeSchedule(row), rowW - 4)}</text>
            </box>
          </box>
        )
      })}
      <box paddingX={1} backgroundColor={theme.surface2}>
        <text fg={armed ? theme.amber : theme.dim}>{fitText(footer, rowW)}</text>
      </box>
    </box>
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'schedules',
  views: { schedules: SchedulesSurface },
}
