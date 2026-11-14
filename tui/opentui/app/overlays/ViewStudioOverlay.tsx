/** @jsxImportSource @opentui/react */
// The View Studio: compose a transcript view from every choice a built-in
// makes (tui/viewSpec.ts). It is a panel, not a modal: the transcript behind it
// is drawn with the draft, so every change is seen on the real conversation,
// and the specimen at the bottom shows the style fields on a fixed sample even
// when the open session has no prompt, thinking or tool call to show them on.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BoxRenderable, MouseEvent } from '@opentui/core'
import { registerTabPaintOccluder, type TabPaintOccluder } from '../../SessionTabConnection'
import type { TuiThemePalette } from '../../../theme'
import {
  BUILTIN_VIEW_SPECS, CUSTOM_VIEW_NAME_MAX, VIEW_SPEC_BASES, VIEW_SPEC_FIELDS, VIEW_SPEC_SECTIONS, customViewSpec,
  cycleViewSpecValue, viewCardStyle, viewQuietTurns, viewSpecField, viewSpecValueLabel,
  type CustomView, type ViewSpec, type ViewSpecField, type ViewSpecKey,
} from '../../../viewSpec'
import { TRANSCRIPT_VIEW_LABELS } from '../commands'
import { WindowButton } from '../../WindowButton'
import { TranscriptCard, type TranscriptCardProps } from '../TranscriptCard'
import { densityConfig, streamCompletedTurnHint, streamLandmarkText, transcriptAccent } from '../transcriptStyle'
import { IDLE_TICKER_PHRASES } from '../chrome'
import { TextAttributes } from '@opentui/core'
import { computeAllLandmarks, renderedBodyLines, usesAgentCardPresentation, visibleCardsForTranscriptView } from '../transcriptRows'
import { EMPTY_EXPANDED_KEYS } from '../timing'
import { buildThreadedMessages } from '../../../../lib/threading'
import { formatTranscriptCards } from '../../../format'
import type { SessionMessage } from '../../../../lib/types'
import type { TuiDensity } from '../../../theme'

export type ViewStudioKey = { name: string; sequence: string; ctrl: boolean; meta: boolean; shift: boolean }
export type ViewStudioKeyHandler = (key: ViewStudioKey) => boolean

type Props = {
  theme: TuiThemePalette
  top: number
  width: number
  height: number
  draft: CustomView
  /** The stored view this draft edits, or null for a new one. */
  saved: CustomView | null
  globalDensity: TuiDensity
  onChange: (next: CustomView) => void
  onSave: (asNew: boolean) => void
  onDiscard: () => void
  onDelete: () => void
  keyHandlerRef: React.MutableRefObject<ViewStudioKeyHandler | null>
}

export const VIEW_STUDIO_WIDTH = 56

const FIELDS_BY_SECTION = new Map(VIEW_SPEC_SECTIONS.map((section) => [section, VIEW_SPEC_FIELDS.filter((field) => field.section === section)]))
const SPECIMEN_MIN_ROWS = 12
const SPECIMEN_MAX_ROWS = 26
const MOST_FIELDS = Math.max(...[...FIELDS_BY_SECTION.values()].map((fields) => fields.length))

function setField(draft: CustomView, key: ViewSpecKey, value: ViewSpec[ViewSpecKey]): CustomView {
  const overrides: Record<string, unknown> = { ...draft.overrides }
  if (value === BUILTIN_VIEW_SPECS[draft.base][key]) delete overrides[key]
  else overrides[key] = value
  return { ...draft, overrides }
}

function sameView(a: CustomView | null, b: CustomView): boolean {
  if (!a) return false
  return a.name === b.name && a.base === b.base && JSON.stringify(a.overrides) === JSON.stringify(b.overrides)
}

export function ViewStudioOverlay(props: Props) {
  const { theme, top, width, height, draft, saved, keyHandlerRef } = props
  const [sectionIndex, setSectionIndex] = useState(0)
  const [rowIndex, setRowIndex] = useState(0)
  const [renaming, setRenaming] = useState(false)
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null)
  // The tab strip's outline is painted after the frame; tell it where the panel is.
  const boxRef = useRef<BoxRenderable | null>(null)
  useLayoutEffect(() => registerTabPaintOccluder((): TabPaintOccluder | null => {
    const box = boxRef.current
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
  }), [])
  const spec = customViewSpec(draft)
  const base = BUILTIN_VIEW_SPECS[draft.base]
  const section = VIEW_SPEC_SECTIONS[sectionIndex]!
  const fields = FIELDS_BY_SECTION.get(section) ?? []
  const row = Math.min(rowIndex, fields.length - 1)
  const focused = fields[row]
  // A new view with nothing changed has nothing to lose.
  const dirty = saved ? !sameView(saved, draft) : Object.keys(draft.overrides).length > 0
  const changedCount = Object.keys(draft.overrides).length

  const cycle = (field: ViewSpecField, step: 1 | -1) => props.onChange(setField(draft, field.key, cycleViewSpecValue(spec, field.key, step)))
  const cycleBase = (step: 1 | -1) => {
    const index = VIEW_SPEC_BASES.indexOf(draft.base)
    props.onChange({ ...draft, base: VIEW_SPEC_BASES[(index + step + VIEW_SPEC_BASES.length) % VIEW_SPEC_BASES.length]! })
  }
  const switchSection = (index: number) => { setSectionIndex((index + VIEW_SPEC_SECTIONS.length) % VIEW_SPEC_SECTIONS.length); setRowIndex(0) }
  const resetField = () => { if (focused) props.onChange(setField(draft, focused.key, base[focused.key])) }
  const resetAll = () => props.onChange({ ...draft, overrides: {} })
  const requestDiscard = () => { if (dirty && confirm !== 'discard') setConfirm('discard'); else props.onDiscard() }
  const requestDelete = () => { if (!saved) return; if (confirm === 'delete') props.onDelete(); else setConfirm('delete') }

  keyHandlerRef.current = (key) => {
    if (renaming) {
      if (key.name === 'return' || key.name === 'escape') { setRenaming(false); return true }
      if (key.name === 'backspace') { props.onChange({ ...draft, name: draft.name.slice(0, -1) }); return true }
      const text = key.sequence
      if (text && text.length === 1 && text >= ' ' && !key.ctrl && !key.meta && draft.name.length < CUSTOM_VIEW_NAME_MAX) {
        props.onChange({ ...draft, name: draft.name + text })
      }
      return true
    }
    const wasConfirm = confirm
    if (wasConfirm) setConfirm(null)
    if (key.name === 'escape') { if (wasConfirm === 'discard') props.onDiscard(); else requestDiscard(); return true }
    if (key.name === 's' && !key.ctrl) { props.onSave(key.shift || key.sequence === 'S'); return true }
    if (key.sequence === 'x') { if (wasConfirm === 'delete') props.onDelete(); else requestDelete(); return true }
    if (key.name === 'up' || key.sequence === 'k') { setRowIndex(Math.max(row - 1, 0)); return true }
    if (key.name === 'down' || key.sequence === 'j') { setRowIndex(Math.min(row + 1, fields.length - 1)); return true }
    if (key.name === 'left' || key.sequence === 'h') { if (focused) cycle(focused, -1); return true }
    if (key.name === 'right' || key.sequence === 'l' || key.name === 'space' || key.name === 'return') { if (focused) cycle(focused, 1); return true }
    if (key.name === 'tab') { switchSection(sectionIndex + (key.shift ? -1 : 1)); return true }
    if (/^[1-7]$/.test(key.sequence)) { switchSection(Number(key.sequence) - 1); return true }
    // A built-in keeps its name and is its own base.
    if (key.sequence === 'r') { if (!draft.builtin) setRenaming(true); return true }
    if (key.sequence === 'b') { if (!draft.builtin) cycleBase(1); return true }
    if (key.sequence === 'B') { if (!draft.builtin) cycleBase(-1); return true }
    if (key.sequence === 'u') { resetField(); return true }
    if (key.sequence === 'R') { resetAll(); return true }
    if (key.name === 'q' && key.ctrl) return false
    return true
  }

  const inner = width - 2
  const labelWidth = 18
  // Rows: border 2, name, base, rule, tabs, rule, help 2, changes 2, rule, specimen label, specimen, rule, footer.
  const chromeRows = 2 + 2 + 1 + 1 + 1 + 2 + 2 + 1 + 1 + 1 + 1
  // As tall as its content (the longest section, so tabs do not resize it), never taller than given.
  const panelHeight = Math.min(height, chromeRows + MOST_FIELDS + SPECIMEN_MAX_ROWS)
  const listRows = Math.max(Math.min(MOST_FIELDS, panelHeight - chromeRows - SPECIMEN_MIN_ROWS), Math.min(3, fields.length))
  const specimenRows = Math.max(panelHeight - chromeRows - listRows, 0)
  const changes = VIEW_SPEC_FIELDS.filter((field) => spec[field.key] !== base[field.key])
  const listStart = Math.min(Math.max(row - listRows + 1, 0), Math.max(fields.length - listRows, 0))
  const visibleFields = fields.slice(listStart, listStart + listRows)
  const footerHint = confirm === 'discard' ? 'Discard changes? esc again · s save'
    : confirm === 'delete' ? draft.builtin ? `Reset ${draft.name} to its defaults? x again · esc keeps` : `Delete "${draft.name}"? x again deletes · esc keeps`
    : null

  return (
    <box ref={boxRef} id="view-studio" position="absolute" top={top} right={1} width={width} height={panelHeight}
      border borderStyle="rounded" borderColor={theme.cyan} backgroundColor={theme.surface}
      zIndex={22} flexDirection="column" title=" VIEW STUDIO " titleColor={theme.cyan}
      onMouseScroll={(event: MouseEvent) => {
        const direction = event.scroll?.direction
        if (direction === 'up') setRowIndex(Math.max(row - 1, 0))
        else if (direction === 'down') setRowIndex(Math.min(row + 1, fields.length - 1))
      }}>
      <box id="view-studio-name" height={1} paddingX={1} flexDirection="row" onMouseDown={() => { if (!draft.builtin) setRenaming(true) }}>
        <text fg={theme.muted} width={6} wrapMode="none">Name</text>
        <text fg={renaming ? theme.text : theme.cyan} bg={renaming ? theme.surface3 : undefined} wrapMode="none">
          {renaming ? `${draft.name}▏` : draft.name}
        </text>
        <text fg={theme.dim} wrapMode="none">{draft.builtin ? '  built-in view' : renaming ? '  ⏎ done' : '  r rename'}</text>
      </box>
      <box id="view-studio-base" height={1} paddingX={1} flexDirection="row">
        {draft.builtin ? (
          <text fg={theme.dim} wrapMode="none">{changedCount ? `${changedCount} changed from the defaults · x resets` : 'as it ships · change anything, s saves'}</text>
        ) : (
          <>
            <text fg={theme.muted} width={6} wrapMode="none">Base</text>
            <WindowButton id="view-studio-base-prev" label="‹" theme={theme} background={theme.surface} foreground={theme.muted} onPress={() => cycleBase(-1)} />
            <text fg={theme.text} wrapMode="none">{` ${TRANSCRIPT_VIEW_LABELS[draft.base]} `}</text>
            <WindowButton id="view-studio-base-next" label="›" theme={theme} background={theme.surface} foreground={theme.muted} onPress={() => cycleBase(1)} />
            <text fg={theme.dim} wrapMode="none">{`  b base · ${changedCount} changed`}</text>
          </>
        )}
      </box>
      <Rule theme={theme} width={inner} />
      <box id="view-studio-tabs" height={1} paddingX={1} flexDirection="row">
        {VIEW_SPEC_SECTIONS.map((name, index) => (
          // Seven sections fit across the panel only by name; 1–7 still select them.
          <box key={name} id={`view-studio-tab:${name}`} marginRight={1} onMouseDown={() => switchSection(index)}>
            <text fg={index === sectionIndex ? theme.cyan : theme.muted} bg={index === sectionIndex ? theme.surface3 : undefined} wrapMode="none">
              {name}
            </text>
          </box>
        ))}
      </box>
      <Rule theme={theme} width={inner} />
      <box id="view-studio-fields" height={listRows} flexDirection="column">
        {visibleFields.map((field, offset) => {
          const index = listStart + offset
          const active = index === row
          const changed = spec[field.key] !== base[field.key]
          return (
            <box key={field.key} id={`view-studio-field:${field.key}`} height={1} paddingX={1} flexDirection="row"
              backgroundColor={active ? theme.surface3 : undefined}
              onMouseDown={(event: MouseEvent) => {
                setRowIndex(index)
                if (event.button === 0 || event.button === 2) cycle(field, event.button === 2 ? -1 : 1)
              }}>
              <text fg={active ? theme.cyan : theme.dim} width={2} wrapMode="none">{active ? '▸' : ' '}</text>
              <text fg={active ? theme.text : theme.muted} width={labelWidth} wrapMode="none">{field.label}</text>
              <text fg={theme.dim} wrapMode="none">‹ </text>
              <text fg={changed ? theme.cyan : theme.text} wrapMode="none">{viewSpecValueLabel(spec, field.key)}</text>
              <text fg={theme.dim} wrapMode="none"> ›</text>
              <text fg={theme.amber} wrapMode="none">{changed ? '  •' : ''}</text>
            </box>
          )
        })}
      </box>
      <Rule theme={theme} width={inner} />
      <box height={2} paddingX={1}>
        <text fg={theme.muted} wrapMode="word">{focused ? `${focused.help}${spec[focused.key] !== base[focused.key] ? ` Was ${viewSpecValueLabel(base, focused.key)}.` : ''}` : ''}</text>
      </box>
      <box id="view-studio-changes" height={2} paddingX={1}>
        <text fg={theme.dim} wrapMode="word">
          {changes.length === 0
            ? <span fg={theme.dim}>{draft.builtin ? `${draft.name} as it ships. Changed fields are listed here.` : `Same as ${TRANSCRIPT_VIEW_LABELS[draft.base]}. Changed fields are listed here.`}</span>
            : <>
                <span fg={theme.dim}>{draft.builtin ? 'vs defaults: ' : `vs ${TRANSCRIPT_VIEW_LABELS[draft.base]}: `}</span>
                {changes.map((field, index) => (
                  <span key={field.key} fg={field.key === focused?.key ? theme.amber : theme.cyan}>
                    {`${index ? ' · ' : ''}${field.label} ${viewSpecValueLabel(spec, field.key)}`}
                  </span>
                ))}
              </>}
        </text>
      </box>
      <Rule theme={theme} width={inner} label={focused ? `preview · ${focused.label.toLowerCase()} marked ▎` : 'preview'} />
      <box id="view-studio-specimen" height={specimenRows} overflow="hidden" flexDirection="column" paddingX={1}>
        {specimenRows > 0 ? <ViewMockup spec={spec} theme={theme} width={inner - 2} name={draft.name} focus={focused?.key ?? null} density={spec.density ?? props.globalDensity} /> : null}
      </box>
      <Rule theme={theme} width={inner} />
      <box height={1} paddingX={1} flexDirection="row">
        {footerHint ? <text fg={theme.amber} wrapMode="none">{footerHint}</text> : (
          <>
            <WindowButton id="view-studio-save" label={dirty || !saved ? ' s save ' : ' s saved '} theme={theme} background={theme.surface} foreground={dirty || !saved ? theme.cyan : theme.muted} onPress={() => props.onSave(false)} />
            {saved ? <WindowButton id="view-studio-save-as" label=" S copy " theme={theme} background={theme.surface} foreground={theme.muted} onPress={() => props.onSave(true)} /> : null}
            <WindowButton id="view-studio-reset" label=" u reset " theme={theme} background={theme.surface} foreground={theme.muted} onPress={resetField} />
            <WindowButton id="view-studio-reset-all" label=" R all " theme={theme} background={theme.surface} foreground={theme.muted} onPress={resetAll} />
            {saved ? <WindowButton id="view-studio-delete" label={draft.builtin ? ' x defaults ' : ' x delete '} theme={theme} tone="danger" background={theme.surface} foreground={theme.muted} onPress={requestDelete} /> : null}
            <WindowButton id="view-studio-close" label=" esc " theme={theme} background={theme.surface} foreground={theme.muted} onPress={requestDiscard} />
          </>
        )}
      </box>
    </box>
  )
}

function Rule({ theme, width, label }: { theme: TuiThemePalette; width: number; label?: string }) {
  const text = label ? `─ ${label} ${'─'.repeat(Math.max(width - label.length - 3, 0))}` : '─'.repeat(width)
  return <text fg={theme.border2} height={1} wrapMode="none">{text}</text>
}

// ── specimen ───────────────────────────────────────────────────────────────

let specimenCards: ReturnType<typeof formatTranscriptCards> | null = null
function specimenSource() {
  if (specimenCards) return specimenCards
  const at = (minute: number) => `2026-01-01T09:${String(minute).padStart(2, '0')}:00.000Z`
  let n = 0
  const message = (type: 'user' | 'assistant', content: unknown, minute: number): SessionMessage => ({
    type, uuid: `view-specimen-${n += 1}`, session_id: 'view-specimen', parent_tool_use_id: null, timestamp: at(minute),
    message: { role: type, content } as SessionMessage['message'],
  })
  specimenCards = formatTranscriptCards(buildThreadedMessages([
    message('user', 'Why is the build slow?', 0),
    message('assistant', [{ type: 'thinking', thinking: 'Check the bundler cache first.' }], 1),
    message('assistant', [{ type: 'tool_use', id: 'specimen-tool', name: 'Bash', input: { command: 'npm run build' } }], 1),
    message('user', [{ type: 'tool_result', tool_use_id: 'specimen-tool', content: 'built in 41s' }], 2),
    message('assistant', 'The cache is **cold** after every install.', 2),
  ]))
  return specimenCards
}

const NOOP = () => {}
const NO_SET = new Set<string>()

function ViewSpecimen({ spec, theme, width, density, cursor }: { spec: ViewSpec; theme: TuiThemePalette; width: number; density: TuiDensity; cursor: boolean }) {
  const cards = useMemo(() => visibleCardsForTranscriptView(specimenSource(), spec), [spec])
  const landmarks = useMemo(() => computeAllLandmarks(cards, -1, -1, 0, null, spec.flow === 'stream', viewQuietTurns(spec), spec.timeMarkers), [cards, spec])
  const densityState = densityConfig(density)
  const stream = spec.flow === 'stream'
  return (
    <>
      {cards.map((card, index) => {
        const expanded = spec.foldDefault === 'expand-all' || (stream && (card.category === 'conversation' || card.category === 'insight'))
        const agentsMode = usesAgentCardPresentation(card, spec)
        const bodyLines = renderedBodyLines(card, expanded, densityState.bodyLines, false, agentsMode, stream && card.category === 'conversation')
        const props: TranscriptCardProps = {
          card,
          display: {
            landmarks: landmarks[index] ?? [], bodyLines, diffView: null, codeBlockLineCounts: [], headerMeta: card.timestamp ?? '',
            accent: transcriptAccent(card.role, card.provider ?? 'claude'), isThinkingCard: card.lines.some((line) => line.tone === 'thinking'),
            categoryEmoji: card.category === 'technical' ? '⚒ ' : '', isInsight: false, markdownFallbackLines: null,
          },
          theme, densityState, syntaxStyle: null, rightPaneWidth: width + 4, isExpanded: expanded, hasCursor: cursor && index === cards.length - 1, isSelected: cursor && index === cards.length - 1,
          isSearchHit: false, isActiveMatch: false, bookmarked: false, onSelectCard: NOOP, thinkingMode: false,
          diffLayout: spec.diffLayout ?? 'stack', imessageStyle: false, transcriptWidth: 'full', streamMode: stream,
          viewStyle: viewCardStyle(spec), turnFooter: null, agentsMode,
          agentToolCursorKey: null, agentToolExpandedKeys: EMPTY_EXPANDED_KEYS, agentToolCollapsedKeys: EMPTY_EXPANDED_KEYS,
          onSelectAgentTool: NOOP, noteNamespace: 'view-specimen', diffNotes: new Map(), diffDraft: null, hoveredDiffAnchor: null,
          activateDiffHover: NOOP, openDiffNote: NOOP, sendDiffNoteToComposer: NOOP, diffPlain: false, diffShowLineNumbers: true,
          diffShowHunkHeaders: true, diffRowCursor: 0, diffSelectionAnchor: null, diffPlainCardKeys: NO_SET,
          diffHiddenLineNumberCardKeys: NO_SET, diffHiddenHunkHeaderCardKeys: NO_SET, diffRowCursorByCardKey: {},
          diffSelectionAnchorByCardKey: {}, setDiffRowCursor: NOOP, setDiffSelectionAnchor: NOOP,
        }
        return <TranscriptCard key={card.key} {...props} />
      })}
    </>
  )
}

// ── the mock window ────────────────────────────────────────────────────────
// A miniature reader drawn from the draft: every Layout field has a place in
// it, the sample cards carry the Content and Style fields, and whatever the
// focused field changes is marked, or shown as a dim placeholder when it is
// turned off, so a value with nothing on screen to change still says where it
// would be.

type MockRegion = 'tabs' | 'header' | 'cards' | 'hint' | 'reasoning' | 'ticker' | 'composer' | 'sidebar' | 'keys'
  | 'rail' | 'tabstrip' | 'frame' | 'fleet' | 'taskpanel' | 'sidepanel' | 'scrollbar' | 'status' | 'livetext'
const FIELD_REGION: Partial<Record<ViewSpecKey, MockRegion>> = {
  appTabs: 'tabs', readerHeader: 'header', completedTurnHint: 'hint', liveReasoning: 'reasoning', idleTicker: 'ticker',
  composer: 'composer', contextSidebar: 'sidebar', scrollbar: 'scrollbar', scrollMarkerJump: 'scrollbar',
  liveText: 'livetext', composerStatus: 'status', composerTitle: 'composer', composerBorder: 'composer', composerSize: 'composer', composerWidth: 'composer', cursor: 'keys', stickyHeaders: 'header',
  sessionRail: 'rail', sidebarView: 'rail', tabs: 'tabstrip', tabOrientation: 'tabstrip',
  tabStyle: 'tabstrip', tabWidth: 'tabstrip', tabClose: 'tabstrip', tabNumbers: 'tabstrip', tabIcons: 'tabstrip', tabSeparators: 'tabstrip', tabTitle: 'tabstrip', focusMode: 'header',
  borders: 'frame', fleetStrip: 'fleet', taskPanel: 'taskpanel', sidePanel: 'sidepanel', sidePanelPlacement: 'sidepanel',
}
function regionOf(key: ViewSpecKey | null): MockRegion | null {
  if (!key) return null
  return FIELD_REGION[key] ?? 'cards'
}

/** A row of the mock, marked with an amber rule when the focused field changes it. */
function MockRow({ theme, marked, children }: { theme: TuiThemePalette; marked: boolean; children: React.ReactNode }) {
  return (
    <box flexDirection="column" border={marked ? ['left'] : []} borderStyle="heavy" borderColor={theme.amber} paddingLeft={marked ? 0 : 1}>
      {children}
    </box>
  )
}

function Placeholder({ theme, text }: { theme: TuiThemePalette; text: string }) {
  return <MockRow theme={theme} marked><text fg={theme.dim} wrapMode="none">{`┄ ${text}`}</text></MockRow>
}

function ViewMockup({ spec, theme, width, name, focus, density }: {
  spec: ViewSpec; theme: TuiThemePalette; width: number; name: string; focus: ViewSpecKey | null; density: TuiDensity
}) {
  const region = regionOf(focus)
  const marked = (r: MockRegion) => region === r
  // A pin left at "global" is drawn the way the app starts; focus mode hides the rail and header.
  const focusMode = spec.focusMode === true
  const showRail = spec.sessionRail !== false && !focusMode
  const tabsOn = spec.tabs !== false
  const sideTabs = tabsOn && spec.tabOrientation === 'vertical'
  const sidePanel = spec.sidePanel && spec.sidePanel !== 'closed' ? spec.sidePanel : null
  const panelBeside = sidePanel !== null && spec.sidePanelPlacement !== 'bottom'
  const taskPanel = spec.taskPanel === 'open'
  const railWidth = showRail ? 11 : 0
  const verticalTabsWidth = sideTabs ? 7 : 0
  const rightWidth = (panelBeside || taskPanel ? 12 : 0) + (spec.contextSidebar ? 12 : 0)
  // Frame border 2 and a row's marker column 1.
  const scrollbarWidth = spec.scrollbar === 'hidden' ? 0 : 1
  const columnWidth = Math.max(width - railWidth - verticalTabsWidth - rightWidth - 3 - scrollbarWidth, 16)
  const hint = useMemo(() => spec.completedTurnHint ? streamCompletedTurnHint(visibleCardsForTranscriptView(specimenSource(), spec)) : null, [spec])
  const sideLabel = sidePanel ? (viewSpecField('sidePanel')?.options.find((option) => option.value === sidePanel)?.label ?? sidePanel) : ''
  const composerRow = <text fg={theme.muted} wrapMode="none">{'› '}<span fg={theme.dim}>Ask about this session…</span></text>
  const column = (title: string, lines: string[], r: MockRegion, w: number) => (
    <box flexDirection="column" width={w} border={['left']} borderColor={marked(r) ? theme.amber : theme.border2} paddingLeft={1}>
      <text fg={theme.cyan} wrapMode="none">{title}</text>
      {lines.map((line) => <text key={line} fg={theme.muted} wrapMode="none">{line}</text>)}
    </box>
  )
  return (
    <box flexDirection="column">
      {spec.fleetStrip
        ? <MockRow theme={theme} marked={marked('fleet')}><text fg={theme.green} wrapMode="none">● 2 running <span fg={theme.dim}>· build · docs</span></text></MockRow>
        : marked('fleet') ? <Placeholder theme={theme} text={spec.fleetStrip === false ? 'fleet strip hidden' : 'fleet strip: global'} /> : null}
      {tabsOn && !sideTabs
        ? <MockRow theme={theme} marked={marked('tabstrip')}><MockTabStrip spec={spec} theme={theme} indent={railWidth} /></MockRow>
        : marked('tabstrip') && !sideTabs ? <Placeholder theme={theme} text="session tabs off" /> : null}
      <box flexDirection="row">
        {showRail
          ? <box flexDirection="column" width={railWidth} border borderStyle="rounded" borderColor={marked('rail') ? theme.amber : theme.border2}>
              <text fg={theme.cyan} wrapMode="none">{spec.sidebarView === 'coordinator' ? 'TEAM' : 'SESSIONS'}</text>
              <text fg={theme.text} wrapMode="none">▸ build</text>
              <text fg={theme.muted} wrapMode="none">  docs</text>
            </box>
          : null}
        {sideTabs
          ? <box flexDirection="column" width={verticalTabsWidth} border={['right']} borderColor={marked('tabstrip') ? theme.amber : theme.border2}>
              <text fg={theme.cyan} wrapMode="none">build</text>
              <text fg={theme.muted} wrapMode="none">docs</text>
              <text fg={theme.muted} wrapMode="none">fix</text>
            </box>
          : null}
        <box flexDirection="column" flexGrow={1}>
          <box border={spec.borders !== false} borderStyle="rounded" borderColor={region === 'cards' || marked('frame') ? theme.amber : theme.border2}
            title={spec.borders !== false && !focusMode ? ` ${name} ` : undefined} titleColor={theme.cyan} flexDirection="row">
            <box flexDirection="column" width={columnWidth + 1}>
              {spec.appTabs
                ? <MockRow theme={theme} marked={marked('tabs')}><text fg={theme.muted} wrapMode="none"><span fg={theme.text} bg={theme.surface3}> Current </span>  Sessions  Agents</text></MockRow>
                : marked('tabs') ? <Placeholder theme={theme} text="app tabs off" /> : null}
              {spec.readerHeader && !focusMode
                ? <MockRow theme={theme} marked={marked('header')}>
                    <text fg={theme.cyan} wrapMode="none">{name.toUpperCase()}<span fg={theme.text}>{'  Why is the build slow?'}</span></text>
                    <text fg={theme.dim} wrapMode="none">ctx 12% · 4 messages · claude</text>
                  </MockRow>
                : marked('header') ? <Placeholder theme={theme} text={focusMode ? 'focus mode hides the header' : 'reader header off'} /> : null}
              <MockRow theme={theme} marked={marked('cards')}>
                <ViewSpecimen spec={spec} theme={theme} width={columnWidth} density={density} cursor={spec.cursor === 'card'} />
              </MockRow>
              {hint
                ? <MockRow theme={theme} marked={marked('hint')}><text fg={theme.dim} wrapMode="none">{streamLandmarkText(hint, columnWidth)}</text></MockRow>
                : marked('hint') ? <Placeholder theme={theme} text="turn-done hint off" /> : null}
              {spec.liveReasoning
                ? <MockRow theme={theme} marked={marked('reasoning')}><text fg={theme.muted} attributes={TextAttributes.ITALIC} wrapMode="none">∴ checking lockfile hashes… <span fg={theme.dim}>(thinking)</span></text></MockRow>
                : marked('reasoning') ? <Placeholder theme={theme} text="live reasoning off" /> : null}
              {spec.idleTicker
                ? <MockRow theme={theme} marked={marked('ticker')}><text fg={theme.dim} wrapMode="none">{`◦ ${IDLE_TICKER_PHRASES[2]} (idle)`}</text></MockRow>
                : marked('ticker') ? <Placeholder theme={theme} text="idle ticker off" /> : null}
              {spec.composer === 'inline'
                ? <MockRow theme={theme} marked={marked('composer')}>
                    <text fg={theme.border2} wrapMode="none">{'─'.repeat(columnWidth)}</text>
                    {composerRow}
                  </MockRow>
                : null}
            </box>
            {scrollbarWidth ? (
              <box flexDirection="column" width={1} backgroundColor={marked('scrollbar') ? theme.amber : theme.surface2}>
                {(spec.scrollbar === 'markers' ? [['·', theme.cyan], ['▪', theme.green], ['', ''], ['▪', theme.red], ['·', theme.cyan], ['█', theme.muted], ['█', theme.muted]] : [['', ''], ['', ''], ['', ''], ['', ''], ['', ''], ['█', theme.muted], ['█', theme.muted]])
                  .map(([glyph, color], index) => <text key={index} fg={color || theme.dim} wrapMode="none">{glyph || ' '}</text>)}
              </box>
            ) : null}
            {spec.contextSidebar ? column('CONTEXT', ['12% used', '2 files'], 'sidebar', 12) : null}
          </box>
          {sidePanel && !panelBeside ? (
            <box border borderStyle="rounded" borderColor={marked('sidepanel') ? theme.amber : theme.border2} title={` ${sideLabel} `} titleColor={theme.cyan} height={3}>
              <text fg={theme.muted} wrapMode="none">the side panel, under the reader</text>
            </box>
          ) : null}
        </box>
        {panelBeside ? column(sideLabel.toUpperCase().slice(0, 10), ['side panel'], 'sidepanel', 12)
          : taskPanel ? column('TASKS', ['▢ fix cache', '▣ profile'], 'taskpanel', 12) : null}
      </box>
      {!showRail && marked('rail') ? <Placeholder theme={theme} text={focusMode ? 'focus mode hides the rail' : 'session rail hidden'} /> : null}
      {marked('sidepanel') && !sidePanel ? <Placeholder theme={theme} text={spec.sidePanel === 'closed' ? 'side panel closed on entering' : 'side panel left as is'} /> : null}
      {marked('taskpanel') && !taskPanel ? <Placeholder theme={theme} text={spec.taskPanel === 'closed' ? 'task panel closed on entering' : 'task panel left as is'} /> : null}
      {spec.liveText
        ? <MockRow theme={theme} marked={marked('livetext')}><text fg={theme.text} wrapMode="none">The cache is cold after… <span fg={theme.dim}>(streaming)</span></text></MockRow>
        : marked('livetext') ? <Placeholder theme={theme} text="live reply drawn in the transcript" /> : null}
      <MockRow theme={theme} marked={marked('status')}>
        {spec.composerStatus === 'dot'
          ? <text fg={theme.cyan} wrapMode="none">{'● '}<span fg={theme.muted}>Working · 12s</span></text>
          : <text fg={theme.cyan} bg={theme.surface2} wrapMode="none">{'▌ '}<span fg={theme.muted}>Working · 12s</span></text>}
      </MockRow>
      {spec.composer === 'docked'
        ? <box border borderStyle={spec.composerBorder === 'square' ? 'single' : spec.composerBorder} borderColor={marked('composer') ? theme.amber : theme.border2}
            title={spec.composerTitle ? ' To: build · CLAUDE ' : undefined} titleColor={theme.dim}
            height={spec.composerSize === 'tall' ? 5 : 3} marginLeft={spec.composerWidth === 'reader' ? railWidth : 0} paddingX={1}>{composerRow}</box>
        : null}
      <MockRow theme={theme} marked={marked('keys')}>
        <text fg={theme.dim} wrapMode="none">
          {spec.cursor === 'card' ? 'j/k move · e fold · cursor card lit' : 'j/k scroll · e expand all · no cursor'}
        </text>
      </MockRow>
    </box>
  )
}

const MOCK_TABS = [
  { title: 'Why is the build slow?', folder: 'web', provider: 'C', glyph: '' },
  { title: 'Docs pass', folder: 'docs', provider: 'X', glyph: '✓' },
  { title: 'Fix flaky test', folder: 'api', provider: 'C', glyph: '◌' },
]

/** The tab strip as the view's Tabs fields draw it, on three sample sessions. */
function MockTabStrip({ spec, theme, indent }: { spec: ViewSpec; theme: TuiThemePalette; indent: number }) {
  const width = spec.tabWidth === 'compact' ? 10 : spec.tabWidth === 'wide' ? 16 : spec.tabWidth === 'fit' ? 0 : 12
  const label = (tab: typeof MOCK_TABS[number], index: number, active: boolean) => {
    const title = spec.tabTitle === 'folder' ? tab.folder : spec.tabTitle === 'folder-title' ? `${tab.folder} · ${tab.title}` : tab.title
    const icons = spec.tabIcons === 'none' ? '' : `${spec.tabIcons === 'provider' ? `${tab.provider} ` : ''}${tab.glyph ? `${tab.glyph} ` : ''}`
    const close = spec.tabClose === 'all' || (spec.tabClose === 'active' && active) ? ' ×' : ''
    const text = `${spec.tabNumbers ? `${index + 1} ` : ''}${icons}${title}`
    const budget = width ? Math.max(width - close.length, 3) : text.length
    return (text.length > budget ? `${text.slice(0, budget - 1)}…` : text.padEnd(budget)) + close
  }
  const parts = MOCK_TABS.map((tab, index) => ({ text: label(tab, index, index === 0), active: index === 0 }))
  const sep = spec.tabSeparators && spec.tabStyle !== 'boxed' ? '│' : ' '
  const underline = spec.tabStyle === 'underline' ? `${' '.repeat(indent + 1)}${'━'.repeat(parts[0]!.text.length + 2)}` : null
  return (
    <>
      <text fg={theme.muted} wrapMode="none">
        {' '.repeat(indent)}
        {parts.map((part, index) => {
          const active = part.active
          const fg = active ? theme.cyan : theme.muted
          const body = spec.tabStyle === 'pills' && active ? <span fg={theme.text} bg={theme.surface3}>{` ${part.text} `}</span>
            : spec.tabStyle === 'chrome' && active ? <span fg={fg}>{`╭${part.text}╮`}</span>
            : spec.tabStyle === 'boxed' ? <span fg={active ? theme.cyan : theme.border2}>{'│'}<span fg={fg}>{part.text}</span>{'│'}</span>
            : <span fg={fg} attributes={active && spec.tabStyle === 'minimal' ? TextAttributes.BOLD : undefined}>{` ${part.text} `}</span>
          return <span key={index}>{body}{index < parts.length - 1 && !(active || parts[index + 1]!.active) ? <span fg={theme.border2}>{sep}</span> : ' '}</span>
        })}
        <span fg={theme.dim}> +</span>
      </text>
      {underline ? <text fg={theme.cyan} wrapMode="none">{underline}</text> : null}
    </>
  )
}
