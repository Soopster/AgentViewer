/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import { fitText } from '../../textLayout'
import { join } from 'node:path'
import { chordHintText, COMMAND_CHORD_MAP, SPLIT_CHORD_MAP } from '../../chordHelp'
import { type PaneFocus } from '../types'
import { ATTACHED_DAEMON_HOST } from '../timing'
import { type InlineTextSegment } from '../inlineText'
import { footerDockStatsReserve } from '../contextMeter'

export type FooterSegmentsContext = {
  composerActive: boolean
  composerKeysTargetTurn: boolean
  effectiveFocus: PaneFocus
  sidebarView: 'sessions' | 'coordinator'
  isScrollbackView: boolean
  scrollbackExpanded: boolean
  commandChordPending: boolean
  theme: TuiThemePalette
  splitChordPending: boolean
  attentionNeedsInputCount: number
  width: number
  statusBarInDock: boolean
  composerDockTextareaWidth: number
}

export function runFooterSegments(ctx: FooterSegmentsContext) {
  const {
    composerActive, composerKeysTargetTurn, effectiveFocus, sidebarView, isScrollbackView,
    scrollbackExpanded, commandChordPending, theme, splitChordPending, attentionNeedsInputCount,
    width, statusBarInDock, composerDockTextareaWidth,
  } = ctx
  // ⇧⏎ newline / ⌃O expand are already advertised by the composer's own hint
  // row directly above this bar — repeating them here just duplicated text.
  const groups: Array<Array<[string, string]>> = composerActive
    ? [[['Esc', 'transcript'], ...(composerKeysTargetTurn
        ? [['⌃C', 'cancel'], ['↵', 'queue']] as Array<[string, string]>
        : [['↵', 'send']] as Array<[string, string]>)]]
    : [
        // Only what changes with the focused pane and view; the fixed keys
        // (v, f, h, ⇧W, tabs, y, z) are in `?` and the ⌃K palette. Discovery
        // comes first so it survives even the narrowest terminal.
        [['⌃K', 'commands'], ['?', 'help']],
        // The rail's own keys, in groups the bar drops whole from the end
        // when narrow — the least-reached last.
        ...(effectiveFocus === 'sessions'
          ? sidebarView === 'coordinator'
            ? [[['j/k', 'select'], ['↵', 'open'], ['tab', 'focus']], [['a', 'sessions']]] as Array<Array<[string, string]>>
            : [
                [['j/k', 'select'], ['↵', 'open'], ['x', 'settle'], ['tab', 'focus']],
                [['/', 'search'], ['⌃R', 'rename']],
                [['⇧S', 'sort'], ['⇧Y', 'scratch'], ['a', 'agents']],
                [['[/]', 'width']],
              ] as Array<Array<[string, string]>>
          : isScrollbackView
            ? [[['j/k', 'scroll'], ['e', scrollbackExpanded ? 'fold all' : 'expand all'], ['c', 'compose'], ['tab', 'focus']]] as Array<Array<[string, string]>>
            : [[['j/k', 'move'], ['e', 'fold'], ['c', 'compose'], ['tab', 'focus']]] as Array<Array<[string, string]>>),
      ]
  const segs: InlineTextSegment[] = []
  // A pending prefix takes over the bar: the chord is modal, so the only keys
  // that matter right now are its own.
  if (commandChordPending) {
    return [
      { text: COMMAND_CHORD_MAP.prefix, fg: theme.amber },
      { text: `  ${chordHintText(COMMAND_CHORD_MAP)}`, fg: theme.muted },
    ]
  }
  if (splitChordPending) {
    return [
      { text: SPLIT_CHORD_MAP.prefix, fg: theme.amber },
      { text: `  ${chordHintText(SPLIT_CHORD_MAP)}`, fg: theme.muted },
    ]
  }
  // Attention badge leads the bar whenever an agent is blocked on a human —
  // it must be visible regardless of which pane or mode has focus.
  if (attentionNeedsInputCount > 0) {
    segs.push({ text: `⚠ ${attentionNeedsInputCount}`, fg: theme.amber })
    segs.push({ text: ' ! inbox · ⌃N next', fg: theme.muted })
  }
  // Only include complete hints. A clipped key legend is both noisy and
  // misleading; the command palette retains the full shortcut registry.
  const hostLabel = ATTACHED_DAEMON_HOST
    ? fitText(`⇌ ${ATTACHED_DAEMON_HOST}`, Math.max(Math.floor(width / 4), 8)).trimEnd()
    : ''
  // In the dock border the bar shares its row with the dock's stats, which
  // keep at least FOOTER_DOCK_STATS_RESERVE columns.
  const budget = statusBarInDock ? Math.max(composerDockTextareaWidth - footerDockStatsReserve(composerDockTextareaWidth), 18) : width - 2
  let remaining = Math.max(budget - segs.reduce((n, segment) => n + segment.text.length, 0)
    - (hostLabel ? hostLabel.length + 3 : 0), 0)
  // Groups are in priority order: the first that does not fit ends the bar,
  // so a small late group never shows while a more useful one was dropped.
  let full = false
  groups.forEach((group) => {
    if (full) return
    const text = group.map(([key, label]) => `${key} ${label}`).join('  ')
    const separator = segs.length > 0 ? ' │ ' : ''
    if (text.length + separator.length > remaining) {
      full = true
      return
    }
    if (separator) segs.push({ text: separator, fg: theme.dim })
    group.forEach((binding, bi) => {
      if (bi > 0) segs.push({ text: '  ', fg: theme.dim })
      segs.push({ text: binding[0], fg: theme.text })
      segs.push({ text: ` ${binding[1]}`, fg: theme.muted })
    })
    remaining -= text.length + separator.length
  })
  if (hostLabel) {
    segs.push({ text: ' │ ', fg: theme.dim })
    segs.push({ text: hostLabel, fg: theme.cyan })
  }
  return segs
}
