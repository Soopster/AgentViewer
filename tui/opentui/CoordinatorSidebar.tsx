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
import { fitText, joinMeta } from './textLayout'
import {
  acquireCoordinatorFeed,
  getCoordinatorState,
  setCoordinatorSelectedKey,
  subscribeCoordinator,
  type CoordinatorSidebarEntry,
} from './coordinatorStore'
import type { CoordinatorPickerFilter, CoordinatorPickerState } from '../../lib/coordinatorSignals'

// Herdr's Goto-picker states. The glyph follows the agent's name and the label
// is what it says when the agent has no task to name instead; `idle` says
// nothing, since an agent with nothing to report is the default.
const PICKER_STATE_MARKERS: Record<CoordinatorPickerState, { glyph: string; label: string }> = {
  blocked: { glyph: '!', label: 'needs you' },
  working: { glyph: '●', label: 'working' },
  done: { glyph: '✓', label: 'to review' },
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

function CoordinatorRow({ entry, selected, first, theme, innerWidth, density }: {
  entry: CoordinatorSidebarEntry
  selected: boolean
  // The rail's title sits directly above the first heading; a blank row there
  // separates it from nothing.
  first: boolean
  theme: TuiThemePalette
  innerWidth: number
  density: TuiDensity
}) {
  if (entry.type === 'machine') {
    // Another machine's teams sit under its own heading, the way herdr's
    // combined list groups agents by machine. An unreadable machine says why.
    const status = entry.error ?? `${entry.agentCount} agent${entry.agentCount === 1 ? '' : 's'}`
    return (
      <box id={`sidebar:${entry.key}`} paddingX={1} marginTop={first ? 0 : 1} backgroundColor={theme.surface}>
        <text fg={entry.error ? theme.amber : theme.cyan} wrapMode="none">
          {fitText(`⌂ ${entry.machine.name.toUpperCase()} · ${status}`, innerWidth - 2)}
        </text>
      </box>
    )
  }

  if (entry.type === 'run') {
    // A heading in the session rail's own form — `TITLE / n` — with the run's
    // status in its colour. The band and the rule of dashes it used to carry
    // were the loudest thing in a list whose content is the agents.
    const title = (entry.run.prompt.split('\n')[0]?.trim() || entry.run.id).toUpperCase()
    const countLabel = ` / ${entry.agentCount}`
    const tone = entry.run.status === 'failed' ? theme.red
      : entry.run.status === 'blocked' ? theme.amber
      : entry.run.status === 'running' || entry.run.status === 'synthesizing' ? theme.green
      : entry.run.status === 'planning' ? theme.cyan
      : theme.dim
    return (
      <box id={`sidebar:${entry.key}`} paddingX={1} marginTop={first ? 0 : 1} backgroundColor={theme.surface}>
        <text fg={tone} wrapMode="none">
          {`${fitText(title, Math.max(innerWidth - 2 - countLabel.length, 4)).trimEnd()}${countLabel}`}
        </text>
      </box>
    )
  }

  // One row an agent. The tree glyph already says lead or teammate and the
  // name's colour says which provider, so neither is spelled out; what follows
  // is the state and the task it is about. An idle agent with no task says
  // nothing — "○ CLAUDE · unassigned" on every other row was most of the rail.
  const accent = getProviderAccent(entry.agent.provider)
  const glyph = entry.agent.role === 'lead' ? '◆' : entry.isLast ? '└─' : '├─'
  const marker = PICKER_STATE_MARKERS[entry.state]
  const statusColor = entry.state === 'blocked' ? theme.amber
    : entry.state === 'working' || entry.state === 'done' ? theme.green
    : entry.agent.status === 'failed' ? theme.amber
    : theme.dim
  const detail = entry.taskTitle ?? marker.label
  const showState = entry.state !== 'idle' || Boolean(entry.taskTitle)
  const rowWidth = innerWidth - 3
  const head = `${glyph} ${entry.agent.name}`
  const headText = fitText(head, Math.min(head.length, rowWidth)).trimEnd()
  const detailWidth = Math.max(rowWidth - headText.length - 3, 0)
  return (
    <box
      id={`sidebar:${entry.key}`}
      paddingX={1}
      flexDirection="row"
      backgroundColor={selected ? theme.surface3 : theme.surface}
      marginBottom={density === 'comfortable' ? 1 : 0}
      onMouseDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        setCoordinatorSelectedKey(entry.key)
      }}
    >
      <text fg={selected ? accent : theme.dim} wrapMode="none">{selected ? '▎' : ' '}</text>
      <text fg={theme.dim} wrapMode="none">{`${glyph} `}</text>
      <text fg={accent} wrapMode="none">{headText.slice(glyph.length + 1)}</text>
      {showState && detailWidth > 0 ? (
        <>
          <text fg={statusColor} wrapMode="none">{` ${marker.glyph} `}</text>
          <text fg={selected ? theme.text : theme.muted} wrapMode="none">{fitText(detail, detailWidth).trimEnd()}</text>
        </>
      ) : null}
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
      {state.entries.map((entry, index) => (
        <CoordinatorRow
          key={entry.key}
          entry={entry}
          first={index === 0}
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
