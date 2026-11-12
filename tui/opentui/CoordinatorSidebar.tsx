/** @jsxImportSource @opentui/react */
// The coordinator rail, rendered from its own store rather than from the root.
//
// This is the first surface moved behind `slots.tsx`, and it is the shape the
// others should follow: the component takes only layout props (theme, widths)
// and reads everything else from `coordinatorStore`. That is what makes the
// `memo` below real — a coordinator refresh re-renders these rows and nothing
// else, where previously it re-rendered the whole app including the mounted
// transcript.
import { memo, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { getProviderAccent } from '../theme'
import type { TuiDensity, TuiThemePalette } from '../theme'
import { TextAttributes } from '@opentui/core'
import { fitText } from './textLayout'
import { SidebarGroupHeading, sidebarQuietColor } from './app/SidebarChrome'
import { mixHexColor } from './app/transcriptStyle'
import { timeAgo } from './app/format'
import {
  acquireCoordinatorFeed,
  getCoordinatorState,
  setCoordinatorFilter,
  setCoordinatorQuery,
  setCoordinatorSelectedKey,
  subscribeCoordinator,
  toggleCoordinatorFold,
  type CoordinatorSidebarEntry,
} from './coordinatorStore'
import { COORDINATOR_PICKER_FILTERS, type CoordinatorPickerFilter, type CoordinatorPickerState } from '../../lib/coordinatorSignals'
import { SidebarChip, SidebarFiltersRule, SidebarSearchRow, type SidebarFilterMenu } from './app/SidebarFilters'

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

function CoordinatorRow({ entry, selected, first, afterAgent, theme, innerWidth, density }: {
  entry: CoordinatorSidebarEntry
  selected: boolean
  // The rail's title sits directly above the first heading; a blank row there
  // separates it from nothing.
  first: boolean
  /** A heading gets a blank row above it only after an open tree; folded runs stack like session rows. */
  afterAgent: boolean
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

  if (entry.type === 'group') {
    // NEEDS YOU: the sessions rail's lifted group, with its rule and count.
    return <SidebarGroupHeading id={`sidebar:${entry.key}`} label={entry.label} count={entry.count} width={innerWidth}
      disclosure="" first={first} density={density} theme={theme} />
  }

  if (entry.type === 'date') {
    return <SidebarGroupHeading id={`sidebar:${entry.key}`} label={entry.label} count={entry.count} width={innerWidth}
      dateGroup inset={1} disclosure={entry.folded ? '▸ ' : '▾ '} first={first} density={density} theme={theme}
      onPress={() => toggleCoordinatorFold(entry.key)} />
  }

  if (entry.type === 'run') {
    // The session rail's project header: the title in sentence case, a rule to
    // its agent count, then its age — which is what tells apart the many runs
    // that share a prompt. The run's status is one glyph in its colour rather
    // than the whole line in it, so a list of finished runs is not a wall of green.
    const quiet = sidebarQuietColor(theme)
    const title = entry.run.prompt.split('\n')[0]?.trim() || entry.run.id
    const status = runStatusMark(entry.run.status, theme)
    const tail = ` ${entry.agentCount}  ${timeAgo(entry.run.updatedAt || entry.run.createdAt)}`
    const disclosure = entry.folded ? '▸ ' : '▾ '
    const labelWidth = Math.max(innerWidth - 3 - disclosure.length - 2 - tail.length, 4)
    const shown = fitText(title, Math.max(labelWidth - 2, 1)).trimEnd()
    const rule = labelWidth - shown.length > 1 ? ` ${'─'.repeat(labelWidth - shown.length - 1)}` : ' '.repeat(Math.max(labelWidth - shown.length, 0))
    return (
      <box id={`sidebar:${entry.key}`} paddingLeft={2} paddingRight={1} marginTop={first || !afterAgent ? 0 : 1} flexDirection="row" height={1} flexShrink={0} backgroundColor={theme.surface}
        onMouseDown={(event) => { if (event.button === 0) { event.stopPropagation(); toggleCoordinatorFold(entry.key) } }}>
        <text fg={quiet} wrapMode="none" selectable={false}>{disclosure}</text>
        <text fg={status.color} wrapMode="none" selectable={false}>{`${status.glyph} `}</text>
        <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none" selectable={false}>{shown}</text>
        <text fg={mixHexColor(quiet, theme.surface, 0.55) ?? theme.border} wrapMode="none" selectable={false}>{rule}</text>
        <text fg={quiet} wrapMode="none" selectable={false}>{tail}</text>
      </box>
    )
  }

  // One row an agent. The tree glyph already says lead or teammate and the
  // name's colour says which provider, so neither is spelled out; what follows
  // is the state and the task it is about. An idle agent with no task says
  // nothing — "○ CLAUDE · unassigned" on every other row was most of the rail.
  const accent = getProviderAccent(entry.agent.provider)
  // Colour is for the provider tint on the name and the state glyph; the tree and the task are quiet.
  const quiet = sidebarQuietColor(theme)
  // A lifted row (NEEDS YOU) hangs from no tree, so it draws none: the state glyph and the task say why it is there.
  const lifted = entry.key.startsWith('needs:')
  const glyph = lifted ? '' : entry.agent.role === 'lead' ? '◆' : entry.isLast ? '└─' : '├─'
  const marker = PICKER_STATE_MARKERS[entry.state]
  const statusColor = entry.state === 'blocked' ? theme.amber
    : entry.state === 'working' || entry.state === 'done' ? theme.green
    : entry.agent.status === 'failed' ? theme.amber
    : quiet
  const detail = entry.taskTitle ?? marker.label
  const showState = entry.state !== 'idle' || Boolean(entry.taskTitle)
  // Levels step by one column: bucket heading, its run (disclosure), the run's agents (tree glyph under the
  // run's status glyph). A lifted row sits one step inside NEEDS YOU. The selection bar stays at the row's edge.
  const indent = lifted ? '' : '  '
  const rowWidth = innerWidth - 3 - indent.length
  const head = glyph ? `${glyph} ${entry.agent.name}` : entry.agent.name
  const headText = fitText(head, Math.min(head.length, rowWidth)).trimEnd()
  const nameText = glyph ? headText.slice(glyph.length + 1) : headText
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
      <text fg={selected ? accent : quiet} wrapMode="none">{selected ? '▎' : ' '}</text>
      {glyph ? <text fg={quiet} wrapMode="none">{`${indent}${glyph} `}</text> : null}
      <text fg={accent} wrapMode="none">{nameText}</text>
      {showState && detailWidth > 0 ? (
        <>
          <text fg={statusColor} wrapMode="none">{` ${marker.glyph} `}</text>
          <text fg={selected ? theme.text : quiet} wrapMode="none">{fitText(detail, detailWidth).trimEnd()}</text>
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
  const scroll = useRef<ScrollBoxRenderable | null>(null)
  useEffect(() => {
    if (state.selectedKey) scroll.current?.scrollChildIntoView(`sidebar:${state.selectedKey}`)
  }, [state.selectedKey])

  const status = <CoordinatorStatus theme={props.theme} shown={state.agentEntries.length} counts={state.stateCounts} />
  if (state.entries.length === 0) {
    const empty = state.query.trim() ? 'No runs or agents match the search'
      : state.filter === 'all' ? 'No coordinator runs — ⌃K n to start one'
      : `No ${COORDINATOR_FILTER_LABELS[state.filter].toLowerCase()} agents — f for the next filter`
    return <>{status}<text fg={sidebarQuietColor(props.theme)}>{fitText(empty, props.innerWidth)}</text></>
  }
  return (
    <>
    {status}
    <scrollbox
      id="coordinator-sidebar-rows"
      ref={scroll}
      flexGrow={1}
      minHeight={0}
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
          afterAgent={state.entries[index - 1]?.type === 'agent'}
          selected={entry.type === 'agent' && entry.key === state.selectedKey}
          theme={props.theme}
          innerWidth={props.innerWidth}
          density={props.density}
        />
      ))}
    </scrollbox>
    </>
  )
})

/**
 * The Coordinator tab's controls, in the Sessions tab's form: search (runs by title, agents by name or task), the
 * agent-state filter as a chip (the `f` key cycles the same filter), and the rule. It reads the store itself, so
 * typing a search re-renders this row and the list, never the root. There is no project scope here: the
 * Coordinator lists every run this ledger holds.
 */
export const CoordinatorFilters = memo(function CoordinatorFilters({ theme, searchFocused, onSearchFocus, onSubmit, onOpenMenu }: {
  theme: TuiThemePalette; searchFocused: boolean; onSearchFocus: () => void; onSubmit: () => void
  onOpenMenu: (menu: SidebarFilterMenu) => void
}) {
  const state = useSyncExternalStore(subscribeCoordinator, getCoordinatorState, getCoordinatorState)
  return <box flexShrink={0} flexDirection="column">
    <SidebarSearchRow idPrefix="coordinator" theme={theme} placeholder="Search runs and agents  /" query={state.query}
      focused={searchFocused} onFocus={onSearchFocus} onQuery={setCoordinatorQuery} onSubmit={onSubmit} />
    <box flexShrink={0} flexDirection="row" paddingX={1}>
      <box id="coordinator-filter" height={1} flexShrink={0} onMouseDown={event => {
        if (event.button !== 0) return
        event.stopPropagation()
        onOpenMenu({ x: event.x, y: event.y, title: 'Agents', items: COORDINATOR_PICKER_FILTERS.map(filter => ({
          id: `coordinator-filter:${filter}`, label: `${state.filter === filter ? '✓ ' : '  '}${COORDINATOR_FILTER_LABELS[filter]}`, run: () => setCoordinatorFilter(filter),
        })) })
      }}><SidebarChip theme={theme} label={COORDINATOR_FILTER_LABELS[state.filter]} narrowing={state.filter !== 'all'} /></box>
    </box>
    <SidebarFiltersRule idPrefix="coordinator" theme={theme} />
  </box>
})

/** The chip labels for herdr's picker filter: the words the rows already use for each state. */
export const COORDINATOR_FILTER_LABELS: Record<CoordinatorPickerFilter, string> = {
  all: 'All', blocked: 'Needs you', working: 'Working', done: 'To review', idle: 'Idle',
}

function runStatusMark(status: string, theme: TuiThemePalette): { glyph: string; color: string } {
  switch (status) {
    case 'running': case 'synthesizing': return { glyph: '●', color: theme.green }
    case 'planning': return { glyph: '○', color: theme.cyan }
    case 'blocked': return { glyph: '!', color: theme.amber }
    case 'failed': return { glyph: '×', color: theme.red }
    case 'completed': return { glyph: '✓', color: sidebarQuietColor(theme) }
    default: return { glyph: '·', color: sidebarQuietColor(theme) }
  }
}

/** The bottom border's right end, as the sessions rail's: how many agents show, then who waits on you and what
 *  waits for review — kept under any filter or search, since hiding them is how a question sits unanswered. */
function CoordinatorStatus({ theme, shown, counts }: { theme: TuiThemePalette; shown: number; counts: Readonly<Record<CoordinatorPickerState, number>> }) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const quiet = sidebarQuietColor(theme)
  const count = `${shown === total ? total : `${shown} of ${total}`} agent${total === 1 ? '' : 's'}`
  return <box id="coordinator-status" position="absolute" bottom={-1} right={0} height={1} flexDirection="row" backgroundColor={theme.surface}>
    <text fg={quiet} wrapMode="none" selectable={false}>{` ${count} `}</text>
    {counts.blocked ? <text fg={theme.amber} wrapMode="none" selectable={false}>{`· !${counts.blocked} `}</text> : null}
    {counts.done ? <text fg={quiet} wrapMode="none" selectable={false}>{`· ✓${counts.done} `}</text> : null}
  </box>
}

/** The rail's box title: what the list is, in the sessions rail's form. Filter state is the chip under the
 *  search, and the agent counts are in the bottom border. */
export function coordinatorSidebarHeaderText(runCount: number): string {
  return `COORDINATOR · ${runCount} run${runCount === 1 ? '' : 's'}`
}
