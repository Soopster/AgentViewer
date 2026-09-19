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
  const statusColor = entry.agent.turnActive || entry.agent.status === 'working' ? theme.green
    : entry.agent.status === 'blocked' || entry.agent.status === 'failed' ? theme.amber
    : theme.dim
  const statusDot = entry.agent.turnActive || entry.agent.status === 'working' ? '●' : '○'
  const detailLine = joinMeta([formatProviderLabel(entry.agent.provider), entry.taskTitle ?? 'unassigned'])
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
        <text fg={statusColor} wrapMode="none">{`${statusDot} `}</text>
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
    return <text fg={props.theme.dim}>{fitText('No coordinator runs — ⌃K n to start one', props.innerWidth)}</text>
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

/** Header text for the rail's box title. Kept beside the rows it describes. */
export function coordinatorSidebarHeaderText(agentCount: number, runCount: number): string {
  return joinMeta([`COORDINATOR ${agentCount}`, `${runCount} run${runCount === 1 ? '' : 's'}`, 'a sessions'])
}
