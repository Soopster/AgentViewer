/** @jsxImportSource @opentui/react */
import { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { secondOpinionGlyph, secondOpinionLabel, latestReviewFor, type SecondOpinionFinding, type SecondOpinionRecord } from '../../../lib/plugins/secondOpinion'
import { popoverRootProps, PopoverDetachButton, fitText, type TuiPluginView, type TuiPluginViewProps, type TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import { turnAge, useSecondOpinionView, type SecondOpinionViewState } from '../useSecondOpinionView'

const SPLIT_MIN_WIDTH = 90
const TURN_PANE_WIDTH = 38

type Pane = 'turns' | 'findings'

const severityColor = (theme: TuiThemePalette, severity: SecondOpinionFinding['severity']) => severity === 'bug' ? theme.red : severity === 'risk' ? theme.amber : theme.muted

function recordColor(theme: TuiThemePalette, record: SecondOpinionRecord | undefined): string {
  if (!record) return theme.dim
  if (record.status === 'running') return theme.cyan
  if (record.status !== 'done') return theme.red
  const open = record.review?.findings.filter(finding => !record.dismissed.includes(finding.id)) ?? []
  if (open.some(finding => finding.severity === 'bug')) return theme.red
  if (open.some(finding => finding.severity === 'risk')) return theme.amber
  return theme.green
}

/** Hints dropped from the middle when they do not fit: the last one is how to leave. */
export function fitHints(hints: readonly string[], width: number): string {
  const kept = [...hints]
  while (kept.length > 2 && kept.join(' · ').length > width) kept.splice(kept.length - 2, 1)
  return fitText(kept.join(' · '), width)
}

function useKeys(state: SecondOpinionViewState, pane: Pane, setPane: (pane: Pane) => void, props: Pick<TuiPluginViewProps, 'registerKeys' | 'focused' | 'close' | 'services'>) {
  const { registerKeys, focused, close, services } = props
  useEffect(() => {
    registerKeys(key => {
      if (!focused || key.ctrl || key.meta || key.option) return false
      const name = key.name
      // A shifted letter is the host's (⇧U, ⇧D…), never one of this view's lowercase keys.
      if (key.shift && /^[a-z]$/.test(name)) return false
      const vertical = name === 'down' || name === 'j' ? 1 : name === 'up' || name === 'k' ? -1 : 0
      if (vertical) { if (pane === 'turns') state.moveTurn(vertical); else state.moveFinding(vertical); return true }
      switch (name) {
        case 'escape': close(); return true
        // Tab may be the host's (window focus); ←/→ always switch panes.
        case 'tab': setPane(pane === 'turns' ? 'findings' : 'turns'); return true
        case 'right': case 'l': setPane('findings'); return true
        case 'left': case 'h': setPane('turns'); return true
        case 'r': state.review(); return true
        case 'o': state.cycleReviewer(); return true
        case 'c': state.handToAuthor(); return true
        case 'x': state.dismiss(); return true
        case 'a': state.toggleAuto(); return true
        case 'g': void state.refresh(); return true
        case 's': state.toggleScope(); return true
        case 'return': {
          const excerpt = state.finding?.excerpts[0]
          if (pane === 'turns') { setPane('findings'); return true }
          if (excerpt && services['open-file']) services['open-file'].open(excerpt.path, excerpt.startLine)
          return true
        }
      }
      if (key.sequence === '.') { state.cancel(); return true }
      return false
    })
    return () => registerKeys(null)
  })
}

function TurnList({ state, theme, width, rows, focused }: { state: SecondOpinionViewState; theme: TuiThemePalette; width: number; rows: number; focused: boolean }) {
  const turns = state.turns ?? []
  return <scrollbox height={rows} width={width}>
    {!state.turns ? <text fg={theme.muted}>Loading turns…</text> : null}
    {state.turns && !turns.length ? <text fg={theme.muted} wrapMode="word">{state.scopedToSession
      ? `No turn of this session was checkpointed (it ran outside agent-viewer, or before checkpoints).${state.repositoryTurns ? ` s shows all ${state.repositoryTurns} in this repository.` : ''}`
      : 'No agent turns have been checkpointed in this repository yet.'}</text> : null}
    {turns.map(turn => {
      const record = latestReviewFor(state.snapshot, turn.sha)
      const selected = turn.sha === state.turn?.sha
      const status = record ? (record.status === 'running' ? '◌' : record.status === 'done' ? (record.stale ? '◇' : '◆') : '✖') : ' '
      return <text key={turn.sha} wrapMode="none" onMouseDown={() => state.selectTurn(turn.sha)}
        fg={selected ? (focused ? theme.cyan : theme.text) : theme.text}>
        <span fg={selected ? theme.cyan : theme.dim}>{selected ? '›' : ' '}</span>
        <span fg={recordColor(theme, record)}>{status}</span>
        {fitText(` ${turnAge(turn.createdAt).padStart(3)} ${turn.label || '(no prompt)'}`, Math.max(1, width - 2))}
      </text>
    })}
  </scrollbox>
}

function Excerpt({ lines, theme, width }: { lines: string[]; theme: TuiThemePalette; width: number }) {
  return <>{lines.map((line, index) => <text key={index} wrapMode="none" fg={line.startsWith('+') ? theme.green : line.startsWith('-') ? theme.red : theme.muted}>{fitText(line || ' ', width)}</text>)}</>
}

function Findings({ state, theme, width, rows, focused }: { state: SecondOpinionViewState; theme: TuiThemePalette; width: number; rows: number; focused: boolean }) {
  const record = state.record
  if (!state.turn) return <box height={rows} />
  const header = record
    ? `${record.reviewer}${record.model ? ` (${record.model})` : ''} · ${secondOpinionLabel(record)}${record.stale ? ' · stale: the code moved since' : ''}`
    : `Not reviewed yet. r reviews with ${state.nextReviewer}.`
  return <scrollbox height={rows} width={width}>
    <text fg={theme.text} wrapMode="word">{state.turn.label || '(no prompt)'}</text>
    <text fg={record ? recordColor(theme, record) : theme.muted} wrapMode="word">{header}</text>
    {record?.fellBackFrom ? <text fg={theme.amber} wrapMode="word">{record.fellBackFrom} is not installed, so {record.reviewer} reviewed instead.</text> : null}
    {record?.error ? <text fg={theme.red} wrapMode="word">{record.error}</text> : null}
    {record?.review?.summary ? <text fg={theme.muted} wrapMode="word">{record.review.summary}</text> : null}
    {record?.review?.unread.length ? <text fg={theme.amber} wrapMode="word">{`Not read (too large for one review): ${record.review.unread.slice(0, 3).join(', ')}${record.review.unread.length > 3 ? ` and ${record.review.unread.length - 3} more` : ''}`}</text> : null}
    {state.findings.map(finding => {
      const selected = finding.id === state.finding?.id
      return <box key={finding.id} flexDirection="column" marginTop={1} onMouseDown={() => state.selectFinding(finding.id)}>
        <text wrapMode="word" fg={theme.text}>
          <span fg={selected && focused ? theme.cyan : theme.dim}>{selected ? '› ' : '  '}</span>
          <span fg={severityColor(theme, finding.severity)}>{`${secondOpinionGlyph(finding.severity)} ${finding.severity} `}</span>
          {finding.title}
        </text>
        {selected ? <>
          {finding.why ? <text fg={theme.text} wrapMode="word">{finding.why}</text> : null}
          {finding.suggestion ? <text fg={theme.muted} wrapMode="word">{`Suggested: ${finding.suggestion}`}</text> : null}
          {finding.excerpts.map(excerpt => <box key={`${excerpt.path}:${excerpt.startLine}`} flexDirection="column">
            <text fg={theme.cyan} wrapMode="none">{fitText(`${excerpt.path}:${excerpt.startLine}-${excerpt.endLine}`, width)}</text>
            <Excerpt lines={excerpt.lines} theme={theme} width={width} />
          </box>)}
        </> : null}
      </box>
    })}
  </scrollbox>
}

function SecondOpinion(props: TuiPluginViewProps) {
  const { services, theme, width, height, placement, close, detach, focused, useState: scopedState } = props
  const cwd = services.repository!.cwd
  const state = useSecondOpinionView({
    service: services['second-opinion']!, checkpoints: services.checkpoints!, cwd,
    sessionId: services.repository!.sessionId, insert: services.composer?.insertText ? text => services.composer!.insertText!(text) : undefined, scoped: scopedState,
  })
  const [pane, setPane] = useState<Pane>('turns')
  useKeys(state, pane, setPane, props)
  const overlay = placement === 'overlay'
  const w = overlay ? Math.max(1, Math.min(width - 4, 140)) : width
  const h = overlay ? Math.max(1, height - 4) : height
  const inner = Math.max(1, w - (overlay ? 4 : 2))
  const split = inner >= SPLIT_MIN_WIDTH
  // A scrollbox needs an explicit row budget: frame, header, notice and footer come off the top.
  const noticeRows = state.error || state.notice ? 1 : 0
  const bodyRows = Math.max(4, h - (overlay ? 2 : 0) - 2 - noticeRows)
  const turnRows = split ? bodyRows - 1 : Math.min(8, Math.max(2, (state.turns?.length ?? 1) + 1))
  const findingRows = split ? bodyRows - 1 : Math.max(2, bodyRows - turnRows - 2)
  const auto = state.snapshot?.settings.autoReview
  const hints = [
    'j/k move', '←/→ pane', ...(services.repository!.sessionId ? [state.allTurns ? 's this session' : 's all turns'] : []), state.armed ? 'r again to confirm' : `r review (${state.nextReviewer})`, 'o other reviewer',
    'c to composer', '⏎ open', 'x dismiss', `a auto ${auto ? 'on' : 'off'}`, '. cancel', 'Esc close',
  ]
  return <box {...popoverRootProps(!overlay, { top: 2, left: Math.max(0, Math.floor((width - w) / 2)), width: w, height: h }, 50)}
    {...(overlay ? { border: true, borderColor: theme.border2, title: ' Second opinion ' } : {})} backgroundColor={theme.surface} flexDirection="column" paddingX={1}>
    {overlay && detach ? <PopoverDetachButton theme={theme} onPress={detach} /> : null}
    <text fg={theme.text} wrapMode="none">
      {fitText(`Second opinion · ${cwd.split('/').filter(Boolean).slice(-2).join('/')} · ${state.scopedToSession ? 'this session' : 'all turns'}`, Math.max(1, inner - 16))}
      <span fg={auto ? theme.amber : theme.dim}>{auto ? '  auto-review on' : ''}</span>
    </text>
    {state.error || state.notice ? <text fg={state.error ? theme.red : state.armed ? theme.amber : theme.muted} wrapMode="none">{state.error ?? state.notice}</text> : null}
    <box flexDirection={split ? 'row' : 'column'} height={bodyRows} gap={split ? 2 : 0}>
      <box flexDirection="column" width={split ? TURN_PANE_WIDTH : inner} height={turnRows + 1}>
        <text fg={pane === 'turns' && focused ? theme.cyan : theme.dim} wrapMode="none">TURNS</text>
        <TurnList state={state} theme={theme} width={split ? TURN_PANE_WIDTH : inner} rows={turnRows} focused={pane === 'turns' && focused} />
      </box>
      <box flexDirection="column" flexGrow={1} height={findingRows + 1}>
        <text fg={pane === 'findings' && focused ? theme.cyan : theme.dim} wrapMode="none">FINDINGS</text>
        <Findings state={state} theme={theme} width={split ? Math.max(1, inner - TURN_PANE_WIDTH - 2) : inner} rows={findingRows} focused={pane === 'findings' && focused} />
      </box>
    </box>
    <text fg={theme.dim} wrapMode="none">{fitHints(hints, inner)}</text>
  </box>
}

export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'second-opinion', views: { 'second-opinion': SecondOpinion } }
