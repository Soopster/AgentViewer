/** @jsxImportSource @opentui/react */
// The coordinator rail, rendered from its own store rather than from the root.
//
// This is the first surface moved behind `slots.tsx`, and it is the shape the
// others should follow: the component takes only layout props (theme, widths)
// and reads everything else from `coordinatorStore`. That is what makes the
// `memo` below real — a coordinator refresh re-renders these rows and nothing
// else, where previously it re-rendered the whole app including the mounted
// transcript.
import { memo, useEffect, useSyncExternalStore } from 'react'
import { getProviderAccent } from '../theme'
import type { TuiDensity, TuiThemePalette } from '../theme'
import { formatProviderLabel } from '../format'
import { fitText, joinMeta } from './textLayout'
import {
  acquireCoordinatorFeed,
  getCoordinatorState,
  setCoordinatorSelectedKey,
  subscribeCoordinator,
  type CoordinatorSidebarEntry,
} from './coordinatorStore'
import type { CoordinatorPickerFilter, CoordinatorPickerState } from '../../lib/coordinatorSignals'

// Herdr's Goto-picker states. The label leads the detail line so a filtered
// list and an unfiltered one read the same way; `idle` says nothing, since an
// agent with nothing to report is the default.
const PICKER_STATE_MARKERS: Record<CoordinatorPickerState, { glyph: string; label: string }> = {
  blocked: { glyph: '!', label: 'needs you' },
  working: { glyph: '●', label: 'working' },
  done: { glyph: '✓', label: 'result to review' },
  idle: { glyph: '○', label: '' },
  unknown: { glyph: '?', label: 'unknown' },
}

export type CoordinatorSidebarProps = {
  theme: TuiThemePalette
  innerWidth: number
  rowBudget: number
  density: TuiDensity
  scrollbarOptions: unknown
}

function CoordinatorRow({ entry, selected, theme, innerWidth, density }: {
  entry: CoordinatorSidebarEntry
  selected: boolean
  theme: TuiThemePalette
  innerWidth: number
  density: TuiDensity
}) {
  if (entry.type === 'machine') {
    // Another machine's teams sit under its own heading, the way herdr's
    // combined list groups agents by machine. An unreadable machine says why.
    const status = entry.error ?? `${entry.agentCount} agent${entry.agentCount === 1 ? '' : 's'}`
    return (
      <box id={`sidebar:${entry.key}`} paddingX={1} marginTop={1} backgroundColor={theme.surface2}>
        <text fg={entry.error ? theme.amber : theme.cyan} wrapMode="none">
          {fitText(`⌂ ${entry.machine.name.toUpperCase()} · ${status}`, innerWidth - 2)}
        </text>
      </box>
    )
  }

  if (entry.type === 'run') {
    const title = (entry.run.prompt.split('\n')[0]?.trim() || entry.run.id).toUpperCase()
    const countLabel = `${entry.agentCount}`
    const dashes = '─'.repeat(Math.max(innerWidth - 2 - title.length - countLabel.length - 3, 1))
    const tone = entry.run.status === 'failed' ? theme.red
      : entry.run.status === 'blocked' ? theme.amber
      : entry.run.status === 'running' || entry.run.status === 'synthesizing' ? theme.green
      : entry.run.status === 'planning' ? theme.cyan
      : theme.dim
    return (
      <box id={`sidebar:${entry.key}`} paddingX={1} marginTop={1} backgroundColor={theme.surface2}>
        <text fg={tone} wrapMode="none">{fitText(`${title} ${dashes} ${countLabel}`, innerWidth - 2)}</text>
      </box>
    )
  }

  const accent = getProviderAccent(entry.agent.provider)
  const glyph = entry.agent.role === 'lead' ? '◆' : entry.isLast ? '└─' : '├─'
  const marker = PICKER_STATE_MARKERS[entry.state]
  const statusColor = entry.state === 'blocked' ? theme.amber
    : entry.state === 'working' || entry.state === 'done' ? theme.green
    : entry.agent.status === 'failed' ? theme.amber
    : theme.dim
  const detailLine = joinMeta([marker.label, formatProviderLabel(entry.agent.provider), entry.taskTitle ?? 'unassigned'])
  return (
    <box
      id={`sidebar:${entry.key}`}
      flexDirection="column"
      backgroundColor={selected ? theme.surface3 : theme.surface}
      marginBottom={density === 'comfortable' ? 1 : 0}
      onMouseDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        setCoordinatorSelectedKey(entry.key)
      }}
    >
      <box paddingX={1} flexDirection="row" backgroundColor={selected ? theme.surface3 : theme.surface}>
        <text fg={selected ? accent : theme.dim} wrapMode="none">{selected ? '▎' : ' '}</text>
        <text fg={selected ? accent : theme.muted} wrapMode="none">
          {fitText(`${glyph} ${entry.agent.name} · ${entry.agent.role}`, innerWidth - 3)}
        </text>
      </box>
      <box paddingX={1} flexDirection="row" backgroundColor={selected ? theme.surface3 : theme.surface}>
        <text fg={selected ? accent : theme.dim} wrapMode="none">{selected ? '▎' : ' '}</text>
        <text fg={statusColor} wrapMode="none">{`${marker.glyph} `}</text>
        <text fg={selected ? theme.text : theme.dim} wrapMode="none">
          {fitText(detailLine, innerWidth - 5)}
        </text>
      </box>
    </box>
  )
}

export const CoordinatorSidebar = memo(function CoordinatorSidebar(props: CoordinatorSidebarProps) {
  // Mounting the rail is what starts the feed. It stops when the last holder
  // releases, so leaving the coordinator view stops polling exactly as the
  // root's `sidebarView` guard used to.
  useEffect(() => acquireCoordinatorFeed(), [])
  const state = useSyncExternalStore(subscribeCoordinator, getCoordinatorState, getCoordinatorState)

  if (state.entries.length === 0) {
    const empty = state.filter === 'all'
      ? 'No coordinator runs — ⌃K n to start one'
      : `No ${state.filter} agents — f for the next filter`
    return <text fg={props.theme.dim}>{fitText(empty, props.innerWidth)}</text>
  }
  return (
    <scrollbox
      style={{ height: props.rowBudget }}
      backgroundColor={props.theme.surface}
      scrollY
      viewportCulling
      scrollbarOptions={props.scrollbarOptions as never}
    >
      {state.entries.map((entry) => (
        <CoordinatorRow
          key={entry.key}
          entry={entry}
          selected={entry.type === 'agent' && entry.key === state.selectedKey}
          theme={props.theme}
          innerWidth={props.innerWidth}
          density={props.density}
        />
      ))}
    </scrollbox>
  )
})

/**
 * Header text for the rail's box title. Kept beside the rows it describes.
 * Ordered by importance, because the rail is narrow and the title is cut from
 * the end: which filter is on (it changes what the list means), then how many
 * agents wait on the user or hold an unreviewed result — kept under any
 * filter, since hiding them behind `f working` is how a question sits
 * unanswered — then the key hints.
 */
export function coordinatorSidebarHeaderText(
  agentCount: number,
  runCount: number,
  filter: CoordinatorPickerFilter = 'all',
  counts: { blocked: number; done: number; total?: number } = { blocked: 0, done: 0 },
): string {
  const title = filter === 'all' ? `COORDINATOR ${agentCount}` : `${filter.toUpperCase()} ${agentCount}/${counts.total ?? agentCount}`
  const attention = [counts.blocked ? `!${counts.blocked}` : '', counts.done ? `✓${counts.done}` : ''].filter(Boolean).join(' ')
  return joinMeta([title, attention, 'f filter', `${runCount} run${runCount === 1 ? '' : 's'}`, 'a sessions'])
}
