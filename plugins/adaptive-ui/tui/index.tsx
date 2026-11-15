/** @jsxImportSource @opentui/react */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoxRenderable, ScrollBoxRenderable } from '@opentui/core'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { cardBlockLines } from '../../../lib/plugins/cardBlocks'
import { explainRule, explanationLines } from '../../../lib/adaptiveUi/explain'
import { sampleLines, type SampleTone } from '../../../lib/adaptiveUi/sampleView'
import { popoverRootProps, PopoverDetachButton, fitText, ShortcutHelp, type ShortcutHelpGroup, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { ADAPTIVE_FILTERS, coverageWarnings, countAdaptive, describeAdaptiveItem, filterAdaptiveItems, historyFor, previewRule, useAdaptiveView, type AdaptiveFilter, type AdaptiveItem, type AdaptiveRowTone } from '../useAdaptiveView'

// Layout follows the workspace hierarchy the other plugins use: a short context row, filters over a two-line
// item list on the left, and the selected item with its tabs and actions on the right. Narrow panels show the
// list or the detail, with Esc/← to go back.
const RULE_TABS = [['preview', 'Preview'], ['why', 'Why'], ['history', 'History'], ['rule', 'Rule']] as const
type RuleTab = (typeof RULE_TABS)[number][0]
type Region = 'list' | 'detail'
type Theme = TuiPluginViewProps['theme']
type BodyTone = 'text' | 'muted' | 'dim' | 'title' | 'good' | 'warn' | 'bad'
type BodyLine = { readonly text: string; readonly tone?: BodyTone; /** Several colours on one line (already laid out to the pane's width). */ readonly parts?: readonly (readonly [string, SampleTone])[] }

const HELP: readonly ShortcutHelpGroup[] = [
  { title: 'Move', rows: [['j / k, ↑ / ↓', 'Move in the list, or scroll the detail when it has focus'], ['Tab / Shift+Tab', 'Switch between the list and the detail'], ['← / →', 'Switch detail tabs (or go back to the list when narrow)'], ['Enter', 'Open the selected item'], ['[ / ]', 'Previous / next filter'], ['1 / 2', 'Focus the list / the detail']] },
  { title: 'A card', rows: [['a', 'Enable a draft or disabled card'], ['d', 'Disable an active card'], ['x', 'Delete (press twice)'], ['f', 'Change it: hands an agent the request'], ['w', 'Open the Why tab']] },
  { title: 'A tool drawn generically', rows: [['h', 'Design a card here, with a model that has no tools'], ['g', 'Design a card with an agent'], ['i', 'Dismiss it']] },
  { title: 'A suggestion', rows: [['a', 'Apply it (adds a view, or drafts the card)'], ['i', 'Dismiss it']] },
  { title: 'Other', rows: [['r', 'Refresh'], ['?', 'This help'], ['Esc', 'Back one level, then close']] },
]

function toneColor(theme: Theme, tone: AdaptiveRowTone | BodyTone): string {
  switch (tone) {
    case 'accent': case 'title': return theme.cyan
    case 'good': return theme.green
    case 'warn': return theme.amber
    case 'bad': return theme.red
    case 'muted': return theme.muted
    case 'dim': return theme.dim
    default: return theme.text
  }
}

function sampleToneColor(theme: Theme, tone: SampleTone): string { return tone === 'label' ? theme.cyan : tone === 'key' ? theme.muted : tone === 'bad' ? theme.red : tone === 'dim' ? theme.dim : tone === 'muted' ? theme.muted : theme.text }

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

function AdaptiveUi(props: TuiPluginViewProps) {
  const { services, theme, width, height, placement, focused, detach, registerKeys, useState: scoped } = props
  const state = useAdaptiveView(services['adaptive-ui']!, services.composer?.insertPrompt)
  const [filter, setFilter] = scoped<AdaptiveFilter>('filter', 'all')
  const [selectedKey, setSelectedKey] = scoped<string>('selected', '')
  const [tab, setTab] = scoped<RuleTab>('tab', 'preview')
  const [region, setRegion] = scoped<Region>('region', 'list')
  const [help, setHelp] = useState(false)
  const listScroll = useRef<ScrollBoxRenderable>(null), selectedRow = useRef<BoxRenderable>(null)
  const detailScroll = useRef<ScrollBoxRenderable>(null), helpScroll = useRef<ScrollBoxRenderable>(null)

  const overlay = placement === 'overlay'
  const w = overlay ? Math.max(1, Math.min(width - 4, 132)) : width
  const h = overlay ? Math.max(1, height - 4) : height
  const inner = Math.max(1, w - 2)
  const wide = inner >= 92
  const listWidth = wide ? Math.max(30, Math.min(46, Math.floor(inner * 0.4))) : inner
  const detailWidth = wide ? inner - listWidth : inner
  const showList = wide || region === 'list'
  const showDetail = wide || region === 'detail'

  const visible = useMemo(() => filterAdaptiveItems(state.items, filter), [state.items, filter])
  const selected: AdaptiveItem | undefined = visible.find(item => item.key === selectedKey) ?? visible[0]
  const selectedIndex = selected ? visible.indexOf(selected) : -1
  const modRule = selected?.kind === 'rule' && !!state.origins[selected.rule.id]
  const tabs = selected?.kind === 'rule' ? RULE_TABS : []
  const activeTab: RuleTab = selected?.kind === 'rule' && RULE_TABS.some(([id]) => id === tab) ? tab : 'preview'

  useEffect(() => { if (selectedRow.current) listScroll.current?.scrollChildIntoView(selectedRow.current) }, [selected?.key, filter, visible.length])
  useEffect(() => { detailScroll.current?.scrollTo(0) }, [selected?.key, activeTab])

  const select = (index: number) => { const item = visible[Math.max(0, Math.min(visible.length - 1, index))]; if (item) { state.disarm(); setSelectedKey(item.key) } }
  const openDetail = () => { if (selected) setRegion('detail') }
  const cycleFilter = (step: number) => { const i = ADAPTIVE_FILTERS.findIndex(entry => entry.id === filter); setFilter(ADAPTIVE_FILTERS[(i + step + ADAPTIVE_FILTERS.length) % ADAPTIVE_FILTERS.length]!.id) }
  const stepTab = (step: number) => { if (!tabs.length) return false; const i = RULE_TABS.findIndex(([id]) => id === activeTab); setTab(RULE_TABS[Math.max(0, Math.min(RULE_TABS.length - 1, i + step))]![0]); return true }
  const closeOrBack = () => { if (!wide && region === 'detail') { setRegion('list'); return true } if (overlay) { props.close(); return true } return false }

  // The one place an item's actions are defined: the buttons, the keys and the help all read it.
  const itemActions = useMemo((): readonly { key: string; label: string; run: () => void; enabled: boolean }[] => {
    if (!selected) return []
    if (selected.kind === 'suggestion') return [
      { key: 'a', label: selected.suggestion.kind === 'view' ? 'Add the view' : 'Design here', run: () => void state.applySuggestion(selected.suggestion), enabled: true },
      { key: 'i', label: 'Dismiss', run: () => void state.dismissSuggestion(selected.suggestion.id), enabled: true },
    ]
    if (selected.kind === 'shape') return [
      { key: 'h', label: 'Design here', run: () => void state.designHere(selected.shape.key), enabled: selected.shape.samples.length > 0 },
      { key: 'g', label: 'Design with an agent', run: () => void state.design(selected.shape.key).then(ok => { if (ok && overlay) props.close() }), enabled: state.insertAvailable },
      { key: 'i', label: 'Dismiss', run: () => void state.dismiss(selected.shape.key), enabled: true },
    ]
    if (selected.kind === 'rule' && !modRule) return [
      selected.rule.status === 'active'
        ? { key: 'd', label: 'Disable', run: () => void state.setStatus(selected.rule.id, 'disabled'), enabled: true }
        : { key: 'a', label: 'Enable', run: () => void state.setStatus(selected.rule.id, 'active'), enabled: true },
      { key: 'f', label: 'Change with an agent', run: () => void state.refineWithAgent(selected.rule.id).then(ok => { if (ok && overlay) props.close() }), enabled: state.insertAvailable },
      { key: 'x', label: state.armed === selected.rule.id ? 'Delete: press again' : 'Delete', run: () => void state.remove(selected.rule.id), enabled: true },
    ]
    return []
  }, [selected, state, modRule, overlay, props])

  useEffect(() => {
    registerKeys(key => {
      if (!focused) return false
      if (help) {
        if (key.name === 'escape' || key.sequence === '?') setHelp(false)
        else if (key.name === 'j' || key.name === 'down') helpScroll.current?.scrollBy(1)
        else if (key.name === 'k' || key.name === 'up') helpScroll.current?.scrollBy(-1)
        else if (key.name === 'pagedown') helpScroll.current?.scrollBy(10)
        else if (key.name === 'pageup') helpScroll.current?.scrollBy(-10)
        return true
      }
      if (key.ctrl || key.meta) return false
      if (key.sequence === '?') { setHelp(true); return true }
      if (key.name === 'escape') { if (state.armed) { state.disarm(); return true } return closeOrBack() }
      if (key.name === 'tab') { setRegion(region === 'list' ? 'detail' : 'list'); return true }
      if (key.name === '1') { setRegion('list'); return true }
      if (key.name === '2') { openDetail(); return true }
      if (key.name === '[') { cycleFilter(-1); return true }
      if (key.name === ']') { cycleFilter(1); return true }
      if (key.name === 'right') { if (region === 'list' && !wide) { openDetail(); return true } return stepTab(1) }
      if (key.name === 'left') { if (!wide && region === 'detail' && (activeTab === 'preview' || !tabs.length)) { setRegion('list'); return true } return stepTab(-1) }
      if (key.name === 'down' || key.name === 'j') { if (region === 'detail') detailScroll.current?.scrollBy(1); else select(selectedIndex + 1); return true }
      if (key.name === 'up' || key.name === 'k') { if (region === 'detail') detailScroll.current?.scrollBy(-1); else select(selectedIndex - 1); return true }
      if (key.name === 'pagedown') { detailScroll.current?.scrollBy(10); return true }
      if (key.name === 'pageup') { detailScroll.current?.scrollBy(-10); return true }
      if (key.name === 'return') { if (region === 'list') { openDetail(); return true } return false }
      if (key.name === 'r') { void state.refresh(); return true }
      if (key.name === 'w' && selected?.kind === 'rule') { setTab('why'); openDetail(); return true }
      const action = itemActions.find(entry => entry.key === key.name)
      if (action) { if (action.enabled && !state.busy) action.run(); return true }
      return false
    })
    return () => registerKeys(null)
  })

  // ── the selected item as lines of text ──────────────────────────────────────────────────────────────
  const body = useMemo((): BodyLine[] => {
    if (!selected) return []
    if (selected.kind === 'suggestion') return [
      { text: selected.suggestion.detail, tone: 'text' },
      { text: '' },
      { text: selected.suggestion.kind === 'view' ? 'Applying adds a new custom view. It is never selected for you; pick it from the View menu.' : 'Applying drafts a card in place with a model that has no tools. The draft shows beside real calls for you to keep or discard.', tone: 'muted' },
    ]
    if (selected.kind === 'invalid') return [{ text: 'This file is not drawn:', tone: 'warn' }, ...selected.problems.map(problem => ({ text: `  · ${problem}`, tone: 'bad' as const }))]
    if (selected.kind === 'shape') {
      const { shape } = selected
      // The header already says "no card · N calls": the body adds what it does not.
      const lines: BodyLine[] = [{ text: `${shape.mcpServer ? `MCP server ${shape.mcpServer} · ` : ''}input keys: ${shape.inputKeys.join(', ') || 'none'}`, tone: 'muted' }, { text: '' }]
      if (!shape.samples.length) return [...lines, { text: 'No samples yet: call this tool once and let it finish. "Design here" needs one; "Design with an agent" can ask for it.', tone: 'muted' }]
      shape.samples.forEach((sample, index) => { for (const line of sampleLines(sample, index, shape.samples.length, Math.max(24, detailWidth - 3))) lines.push({ text: line.parts.map(([text]) => text).join(''), parts: line.parts }); lines.push({ text: '' }) })
      return [...lines, { text: 'Samples are redacted: secret-looking keys are removed and long values cut. [h] drafts a card from them.', tone: 'dim' }]
    }
    const { rule } = selected
    if (activeTab === 'preview') {
      const cards = previewRule(rule)
      const out: BodyLine[] = []
      if (!cards.length) out.push({ text: 'No samples were kept with this rule, so there is nothing to preview here. It draws on real calls once enabled; while it is a draft it also shows beside them.', tone: 'muted' })
      cards.forEach((card, index) => {
        if (cards.length > 1) out.push({ text: `Sample ${index + 1}`, tone: 'dim' })
        out.push({ text: card.title || rule.match.tool, tone: card.tone === 'error' ? 'bad' : card.tone === 'success' ? 'good' : card.tone === 'warning' ? 'warn' : 'title' })
        for (const text of cardBlockLines(card.blocks)) out.push({ text: `  ${text}`, tone: 'text' })
        out.push({ text: '' })
      })
      const warnings = coverageWarnings(rule)
      if (warnings.length) out.push({ text: 'Check against its samples', tone: 'warn' }, ...warnings.map(warning => ({ text: `  ⚠ ${warning}`, tone: 'warn' as const })))
      else if (cards.length) out.push({ text: `Reads everything it reads in ${cards.length} sample${cards.length === 1 ? '' : 's'}.`, tone: 'dim' })
      return out
    }
    if (activeTab === 'why') return explanationLines(explainRule(rule)).map(text => ({ text, tone: /^(Derived|Declared)/.test(text) ? 'title' as const : text.startsWith('  ') ? 'text' as const : 'muted' as const }))
    if (activeTab === 'history') {
      const entries = historyFor(state, rule.id)
      return entries.length ? entries.map(entry => ({ text: `${entry.at.slice(5, 16).replace('T', ' ')}  ${entry.actor.padEnd(5)} ${entry.action.padEnd(7)}${entry.revision ? ` r${entry.revision}` : ''}  ${entry.summary}`, tone: 'text' as const })) : [{ text: 'Nothing recorded for this card yet.', tone: 'muted' as const }]
    }
    return [{ text: `${state.snapshot?.dir ?? ''}/${rule.id}.json`, tone: 'dim' }, { text: '' }, ...JSON.stringify(rule, null, 2).split('\n').map(text => ({ text, tone: 'text' as const }))]
  }, [selected, activeTab, state, detailWidth])

  const counts = (id: AdaptiveFilter) => countAdaptive(state.items, id)
  const ruleCount = state.snapshot?.rules.length ?? 0
  const genericCount = counts('generic')
  const button = (label: string, run: () => void, enabled = true) => <box flexShrink={0} paddingX={1} onMouseDown={() => { if (focused && enabled && !state.busy) run() }}><text fg={enabled ? theme.cyan : theme.dim} wrapMode="none">{label}</text></box>

  // Section headers appear in the unfiltered list only: with a filter the chip already says which kind it is.
  const rows: ({ kind: 'section'; label: string } | { kind: 'item'; item: AdaptiveItem })[] = []
  let lastSection = ''
  for (const item of visible) {
    const section = describeAdaptiveItem(item, state.origins).section
    if (filter === 'all' && section !== lastSection) { rows.push({ kind: 'section', label: section }); lastSection = section }
    rows.push({ kind: 'item', item })
  }

  const emptyList = !state.snapshot ? 'Loading…' : visible.length || filter === 'all' ? null : `Nothing under ${ADAPTIVE_FILTERS.find(entry => entry.id === filter)!.label}.`

  return <box {...popoverRootProps(!overlay, { top: 2, left: Math.max(0, Math.floor((width - w) / 2)), width: w, height: h }, props.zIndex ?? 50)} border={overlay} borderColor={theme.border2} backgroundColor={theme.surface} flexDirection="column" overflow="hidden" title={overlay ? ' Adaptive UI ' : undefined}>
    {overlay && detach ? <PopoverDetachButton theme={theme} onPress={detach} /> : null}
    <box height={1} flexShrink={0} flexDirection="row" paddingX={1}>
      <text fg={theme.cyan} wrapMode="none">{fitText(`Cards for tool calls · ${ruleCount} card${ruleCount === 1 ? '' : 's'} · ${genericCount} drawn generically${counts('suggested') ? ` · ★ ${counts('suggested')}` : ''}`, Math.max(1, inner - 12))}</text>
      {button('[?] help', () => setHelp(true))}
    </box>
    <box height={1} flexShrink={0} flexDirection="row" paddingX={1} backgroundColor={theme.surface2}>
      {ADAPTIVE_FILTERS.map(entry => <box key={entry.id} flexShrink={0} paddingX={1} backgroundColor={filter === entry.id ? theme.surface3 : undefined} onMouseDown={() => { if (focused) setFilter(entry.id) }}>
        <text fg={filter === entry.id ? theme.cyan : theme.muted} wrapMode="none">{`${entry.label} ${counts(entry.id)}`}</text>
      </box>)}
    </box>
    {state.notice ? <box height={1} flexShrink={0} paddingX={1}><text fg={state.busy ? theme.amber : theme.text} wrapMode="none">{fitText(state.notice, inner - 2)}</text></box> : null}
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      {showList ? <box width={listWidth} flexShrink={0} flexDirection="column" backgroundColor={theme.surface2} border={wide ? ['right'] : false} borderColor={region === 'list' ? theme.cyan : theme.border}>
        <scrollbox ref={listScroll} flexGrow={1} minHeight={1}>
          {rows.map(row => {
            if (row.kind === 'section') return <box key={`s:${row.label}`} height={1} flexShrink={0} paddingX={1}><text fg={theme.dim} wrapMode="none">{row.label.toUpperCase()}</text></box>
            const item = row.item, d = describeAdaptiveItem(item, state.origins), on = item.key === selected?.key
            return <box key={item.key} ref={on ? selectedRow : undefined} height={2} flexShrink={0} flexDirection="column" paddingX={1} backgroundColor={on ? theme.surface3 : undefined} onMouseDown={() => { if (!focused) return; setSelectedKey(item.key); state.disarm(); if (!wide) { setRegion('detail') } }}>
              <text fg={on ? theme.cyan : toneColor(theme, d.tone === 'muted' ? 'text' : d.tone)} wrapMode="none">{fitText(`${on ? '›' : ' '} ${d.glyph} ${d.title}`, listWidth - 2)}</text>
              <text fg={theme.muted} wrapMode="none">{fitText(`    ${d.sub}`, listWidth - 2)}</text>
            </box>
          })}
          {emptyList ? <box padding={1}><text fg={theme.dim} wrapMode="word">{emptyList}</text></box> : null}
          {!emptyList && !visible.length ? <box padding={1} flexDirection="column" gap={1}>
            <text fg={theme.text} wrapMode="word">No cards yet.</text>
            <text fg={theme.dim} wrapMode="word">A card is a small recipe for how one tool call reads in the transcript. Tools that no built-in card draws appear here after their first finished call, then you can design a card for them.</text>
            {button('[r] Refresh', () => void state.refresh())}
          </box> : null}
        </scrollbox>
      </box> : null}
      {showDetail ? <box flexGrow={1} minWidth={0} flexDirection="column" onMouseDown={() => { if (focused && wide) setRegion('detail') }}>
        {selected ? <>
          <box height={1} flexShrink={0} flexDirection="row" paddingX={1} backgroundColor={region === 'detail' ? theme.surface2 : undefined}>
            {!wide ? button('[‹ list]', () => setRegion('list')) : null}
            <text fg={theme.cyan} wrapMode="none">{fitText(describeAdaptiveItem(selected, state.origins).title, Math.max(1, detailWidth - 4))}</text>
          </box>
          <box height={1} flexShrink={0} paddingX={1}><text fg={toneColor(theme, describeAdaptiveItem(selected, state.origins).tone === 'muted' ? 'muted' : describeAdaptiveItem(selected, state.origins).tone)} wrapMode="none">{fitText(describeAdaptiveItem(selected, state.origins).sub, Math.max(1, detailWidth - 2))}</text></box>
          {tabs.length ? <box height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.surface2}>
            {tabs.map(([id, label]) => <box key={id} paddingX={1} backgroundColor={activeTab === id ? theme.surface3 : undefined} onMouseDown={() => { if (focused) { setTab(id); setRegion('detail') } }}><text fg={activeTab === id ? theme.cyan : theme.muted} wrapMode="none">{label}</text></box>)}
          </box> : null}
          <scrollbox ref={detailScroll} flexGrow={1} minHeight={1} paddingX={1}>
            {body.map((line, index) => line.parts
              ? <text key={index} wrapMode="none">{line.parts.map(([text, tone], part) => <span key={part} fg={sampleToneColor(theme, tone)}>{text}</span>)}</text>
              : <text key={index} fg={toneColor(theme, line.tone ?? 'text')} wrapMode="word">{line.text || ' '}</text>)}
          </scrollbox>
          <box flexShrink={0} flexDirection="row" flexWrap="wrap" backgroundColor={theme.surface2}>
            {itemActions.map(entry => <box key={entry.key} flexShrink={0}>{button(`[${entry.key}] ${entry.label}`, entry.run, entry.enabled)}</box>)}
            {modRule ? <box paddingX={1}><text fg={theme.dim} wrapMode="none">{`shipped by mod ${state.origins[(selected as Extract<AdaptiveItem, { kind: 'rule' }>).rule.id]}: read-only here`}</text></box> : null}
            {selected.kind === 'shape' && !state.insertAvailable ? <box paddingX={1}><text fg={theme.dim} wrapMode="none">open a session to design with an agent</text></box> : null}
          </box>
        </> : <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" paddingX={2} gap={1}>
          <text fg={theme.text}>Select a card or a tool</text>
          <text fg={theme.dim} wrapMode="word">The list on the left shows your cards and the tools no built-in card draws.</text>
        </box>}
      </box> : null}
    </box>
    <box height={1} flexShrink={0} paddingX={1}><text fg={state.busy ? theme.amber : theme.dim} wrapMode="none">{fitText(state.busy ? 'Working…' : wide ? 'Tab pane · ←/→ tabs · j/k move · [ ] filter · ? help · Esc close' : region === 'list' ? 'Enter open · [ ] filter · ? help · Esc close' : '← list · ←/→ tabs · j/k scroll · ? help', inner - 2)}</text></box>
    {help ? <ShortcutHelp title="Adaptive UI shortcuts" groups={HELP} theme={theme} width={inner} height={h - (overlay ? 2 : 0)} scrollRef={helpScroll} onClose={() => setHelp(false)} /> : null}
  </box>
}
export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'adaptive-ui', views: { 'adaptive-ui': AdaptiveUi } }
