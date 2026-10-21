/** @jsxImportSource @opentui/react */
// The window layout menu: macOS's "Move & Resize / Fill & Arrange", for the
// focused pane and its neighbours, plus the layouts saved for this project. Each
// arrangement is a small picture of the layout it makes; everything is
// clickable, lit under the pointer, and reachable by arrows and Enter.
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { TuiThemePalette } from '../theme'
import { MODAL_CONTENT_Z_INDEX } from './layers'
import { WindowButton } from './WindowButton'
import { fitText } from './textLayout'

export type WindowLayoutAction =
  | 'reader-left' | 'reader-right' | 'reader-top' | 'reader-bottom'
  | 'fill' | 'two' | 'main-stack' | 'grid' | 'grid-six'
  | 'fullscreen'

type Choice = { action: WindowLayoutAction; label: string; icon: [string, string] }

// Icon cells: `r` the focused pane, `p` another pane, `·` free space.
export const WINDOW_LAYOUT_SECTIONS: ReadonlyArray<{ title: string; choices: Choice[] }> = [
  {
    title: 'Move & Resize',
    choices: [
      { action: 'reader-left', label: 'Focused pane on the left', icon: ['rrr··', 'rrr··'] },
      { action: 'reader-right', label: 'Focused pane on the right', icon: ['··rrr', '··rrr'] },
      { action: 'reader-top', label: 'Focused pane on top', icon: ['rrrrr', '·····'] },
      { action: 'reader-bottom', label: 'Focused pane below', icon: ['·····', 'rrrrr'] },
    ],
  },
  {
    title: 'Fill & Arrange',
    choices: [
      { action: 'fill', label: 'Fill focused pane', icon: ['rrrrr', 'rrrrr'] },
      { action: 'two', label: 'Two panes', icon: ['rr pp', 'rr pp'] },
      { action: 'main-stack', label: 'Focused pane and a stack', icon: ['rrr p', 'rrr p'] },
      { action: 'grid', label: 'Grid of four', icon: ['rr pp', 'pp pp'] },
      { action: 'grid-six', label: 'Grid of six', icon: ['r p p', 'p p p'] },
    ],
  },
]

export type SavedLayoutRow = { id: string; name: string; detail: string }

type Target =
  | { kind: 'icon'; section: number; column: number; action: WindowLayoutAction }
  | { kind: 'fullscreen' }
  | { kind: 'saved'; id: string }
  | { kind: 'save' }

const PER_ROW = Math.max(...WINDOW_LAYOUT_SECTIONS.map((section) => section.choices.length))
const ICON_WIDTH = 9
const MENU_WIDTH = PER_ROW * (ICON_WIDTH + 2) + 4
const ICONS: Array<Extract<Target, { kind: 'icon' }>> = WINDOW_LAYOUT_SECTIONS.flatMap((section, sectionIndex) =>
  section.choices.map((choice, column) => ({ kind: 'icon' as const, section: sectionIndex, column, action: choice.action })))

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }

export function WindowLayoutPicker({
  theme,
  width,
  height,
  current,
  fullscreen,
  saved = [],
  onPick,
  onRestore,
  onSave,
  onDelete,
  onRename,
  onUpdate,
  onPreview,
  previewLines = [],
  previewDetail,
  onClose,
  onKeyHandlerReady,
}: {
  theme: TuiThemePalette
  width: number
  height: number
  /** The choice the current layout matches, lit like the active button in the macOS menu. */
  current: WindowLayoutAction | null
  fullscreen: boolean
  /** Layouts saved for this project, newest first. */
  saved?: SavedLayoutRow[]
  onPick: (action: WindowLayoutAction) => void
  onRestore?: (id: string) => void
  onSave?: (name?: string) => void
  onDelete?: (id: string) => void
  onRename?: (id: string, name: string) => void
  onUpdate?: (id: string) => void
  onPreview?: (target: string | null) => void
  previewLines?: string[]
  previewDetail?: string
  onClose: () => void
  onKeyHandlerReady: (handler: (key: Key) => boolean) => void
}) {
  const targets = useMemo<Target[]>(() => [
    ...ICONS,
    { kind: 'fullscreen' },
    ...saved.map((row): Target => ({ kind: 'saved', id: row.id })),
    ...(onSave ? [{ kind: 'save' } as Target] : []),
  ], [onSave, saved])
  const [cursor, setCursor] = useState(() => Math.max(0, ICONS.findIndex((icon) => icon.action === current)))
  const at = Math.min(cursor, targets.length - 1)
  const target = targets[at]
  const [editing, setEditing] = useState<{ id: string | null; draft: string } | null>(null)
  const previewKey = target?.kind === 'icon' ? `action:${target.action}` : target?.kind === 'saved' ? `saved:${target.id}` : target?.kind === 'fullscreen' ? 'action:fullscreen' : null
  useEffect(() => { onPreview?.(previewKey) }, [onPreview, previewKey])
  const rename = (id: string) => {
    setCursor(ICONS.length + 1 + Math.max(0, saved.findIndex((row) => row.id === id)))
    setEditing({ id, draft: saved.find((row) => row.id === id)?.name ?? '' })
  }

  const activate = useCallback((entry: Target | undefined) => {
    if (!entry) return
    if (entry.kind === 'icon') onPick(entry.action)
    else if (entry.kind === 'fullscreen') onPick('fullscreen')
    else if (entry.kind === 'saved') onRestore?.(entry.id)
    else onSave?.()
  }, [onPick, onRestore, onSave])

  const handleKey = useCallback((key: Key) => {
    if (editing) {
      if (key.name === 'escape') { setEditing(null); return true }
      if (key.name === 'return') {
        if (!editing.draft.trim()) return true
        if (editing.id) onRename?.(editing.id, editing.draft)
        else onSave?.(editing.draft)
        setEditing(null)
        return true
      }
      return false // the focused input owns typing, selection, navigation and paste
    }
    if (key.name === 'escape' || key.sequence === 'q') { onClose(); return true }
    const current = targets[at]
    const iconAt = (section: number, column: number) => {
      const row = ICONS.filter((icon) => icon.section === section)
      return ICONS.indexOf(row[Math.min(column, row.length - 1)]!)
    }
    if (key.name === 'right' || key.sequence === 'l') {
      if (current?.kind === 'icon') setCursor(Math.min(ICONS.length - 1, at + 1))
      return true
    }
    if (key.name === 'left' || key.sequence === 'h') {
      if (current?.kind === 'icon') setCursor(Math.max(0, at - 1))
      return true
    }
    // Up and down move between rows of icons by column, then through the list below.
    if (key.name === 'down' || key.sequence === 'j') {
      if (current?.kind === 'icon' && current.section < WINDOW_LAYOUT_SECTIONS.length - 1) setCursor(iconAt(current.section + 1, current.column))
      else if (current?.kind === 'icon') setCursor(ICONS.length)
      else setCursor(Math.min(targets.length - 1, at + 1))
      return true
    }
    if (key.name === 'up' || key.sequence === 'k') {
      if (current?.kind === 'icon' && current.section > 0) setCursor(iconAt(current.section - 1, current.column))
      else if (current?.kind === 'fullscreen') setCursor(iconAt(WINDOW_LAYOUT_SECTIONS.length - 1, 0))
      else if (current?.kind !== 'icon') setCursor(Math.max(0, at - 1))
      return true
    }
    if (key.name === 'return' || key.name === 'space') { activate(current); return true }
    if (key.sequence === 'f') { onPick('fullscreen'); return true }
    if (key.sequence === 'S' || key.sequence === 's') { onSave?.(); return true }
    if ((key.sequence === 'x' || key.name === 'delete') && current?.kind === 'saved') { onDelete?.(current.id); return true }
    if (key.sequence === 'n' && onSave) { setEditing({ id: null, draft: '' }); return true }
    if (key.sequence === 'r' && current?.kind === 'saved') { setEditing({ id: current.id, draft: saved.find((row) => row.id === current.id)?.name ?? '' }); return true }
    if (key.sequence === 'u' && current?.kind === 'saved') { onUpdate?.(current.id); return true }
    // 1–9 pick an arrangement by position, as the icons read left to right.
    if (/^[1-9]$/.test(key.sequence)) {
      const icon = ICONS[Number(key.sequence) - 1]
      if (icon) onPick(icon.action)
    }
    return true
  }, [editing, onRename, onUpdate, saved, activate, at, onClose, onDelete, onPick, onSave, targets])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const listRows = 1 + (saved.length || onSave ? 1 + saved.length + (onSave ? 1 : 0) : 0)
  const baseHeight = 2 + 5 + 1 + 5 + 2 + listRows + 1 + (editing ? 2 : 0)
  const previewHeight = onPreview ? Math.min(8, Math.max(0, height - baseHeight - 2)) : 0
  const menuHeight = baseHeight + previewHeight
  const left = Math.max(0, Math.floor((width - MENU_WIDTH) / 2))
  const top = Math.max(0, Math.floor((height - menuHeight) / 2))

  const iconCell = (char: string, lit: boolean) => {
    if (char === 'r') return <span fg={lit ? theme.bg : theme.cyan}>{'█'}</span>
    if (char === 'p') return <span fg={lit ? theme.bg : theme.muted}>{'█'}</span>
    return <span fg={lit ? theme.bg : theme.dim}>{char === '·' ? '░' : ' '}</span>
  }
  const listRow = (id: string, index: number, children: React.ReactNode, onPress: () => void) => (
    <box
      key={id}
      id={id}
      flexDirection="row"
      height={1}
      backgroundColor={at === index ? theme.surface3 : undefined}
      onMouseOver={() => { if (!editing) setCursor(index) }}
      onMouseDown={(event: { button: number; stopPropagation?: () => void }) => {
        if (event.button !== 0) return
        event.stopPropagation?.()
        onPress()
      }}
    >
      {children}
    </box>
  )

  const hint = target?.kind === 'icon'
    ? `${WINDOW_LAYOUT_SECTIONS[target.section]!.choices[target.column]!.label} · ⏎ applies · esc`
    : target?.kind === 'saved' ? '⏎ restore · r rename · u update · x delete · esc'
    : target?.kind === 'save' ? 's save · n named layout · esc'
    : 'Toggle full screen · ⏎ · esc'

  return (
    <box
      position="absolute"
      top={top}
      left={left}
      width={MENU_WIDTH}
      height={menuHeight}
      zIndex={MODAL_CONTENT_Z_INDEX}
      border
      borderStyle="rounded"
      borderColor={theme.border2}
      backgroundColor={theme.surface}
      flexDirection="column"
      paddingX={1}
      title=" Window layout "
      titleColor={theme.cyan}
      // A press inside the menu is the menu's; the backdrop behind it closes on any other.
      onMouseDown={(event: { stopPropagation?: () => void }) => event.stopPropagation?.()}
    >
      {WINDOW_LAYOUT_SECTIONS.map((section, sectionIndex) => (
        <box key={section.title} flexDirection="column" marginTop={sectionIndex === 0 ? 0 : 1}>
          <text fg={theme.dim} wrapMode="none">{section.title}</text>
          <box flexDirection="row" height={4}>
            {section.choices.map((choice) => {
              const index = ICONS.findIndex((icon) => icon.action === choice.action)
              const selected = index === at
              const lit = choice.action === current
              return (
                <box
                  key={choice.action}
                  id={`window-layout:${choice.action}`}
                  width={ICON_WIDTH}
                  height={4}
                  marginRight={2}
                  border
                  borderStyle="rounded"
                  borderColor={selected || lit ? theme.cyan : theme.border}
                  backgroundColor={lit ? theme.cyan : selected ? theme.surface3 : theme.surface}
                  // Pointing at a choice selects it, so the line below names what a click would do.
                  onMouseOver={() => { if (!editing) setCursor(index) }}
                  onMouseDown={(event: { button: number; stopPropagation?: () => void }) => {
                    if (event.button !== 0) return
                    event.stopPropagation?.()
                    setCursor(index)
                    onPick(choice.action)
                  }}
                >
                  {choice.icon.map((row, rowIndex) => (
                    <text key={rowIndex} wrapMode="none">
                      <span>{' '}</span>
                      {[...row].map((char, charIndex) => <span key={charIndex}>{iconCell(char, lit)}</span>)}
                    </text>
                  ))}
                </box>
              )
            })}
          </box>
        </box>
      ))}
      <box height={1} marginTop={1} border={['top']} borderStyle="single" borderColor={theme.border} />
      {listRow('window-layout:fullscreen', ICONS.length, (
        <>
          <text fg={theme.text} wrapMode="none">{fullscreen ? 'Leave Full Screen' : 'Full Screen'}</text>
          <box flexGrow={1} />
          <text fg={theme.dim} wrapMode="none">{'f ›'}</text>
        </>
      ), () => onPick('fullscreen'))}
      {saved.length > 0 || onSave ? <text fg={theme.dim} wrapMode="none">Saved layouts</text> : null}
      {saved.map((row, index) => listRow(`window-layout:saved:${row.id}`, ICONS.length + 1 + index, (
        <>
          <text fg={theme.text} width={MENU_WIDTH - 16} flexShrink={0} wrapMode="none">{fitText(`  ${row.name} · ${row.detail}`, MENU_WIDTH - 16)}</text>
          {onRename ? <WindowButton id={`window-layout:rename:${row.id}`} label=" r " theme={theme} onPress={() => rename(row.id)} /> : null}
          {onUpdate ? <WindowButton id={`window-layout:update:${row.id}`} label=" u " theme={theme} onPress={() => onUpdate(row.id)} /> : null}
          {onDelete ? <WindowButton id={`window-layout:delete:${row.id}`} label=" × " theme={theme} tone="danger" onPress={() => onDelete(row.id)} /> : null}
        </>
      ), () => onRestore?.(row.id)))}
      {onSave ? listRow('window-layout:save', ICONS.length + 1 + saved.length, (
        <text fg={theme.cyan} wrapMode="none">{'  + Save this layout'}</text>
      ), () => onSave()) : null}
      {editing ? (
        <box height={2} flexShrink={0} flexDirection="column">
          <text fg={theme.cyan} wrapMode="none">{editing.id ? 'Rename layout · enter saves · esc cancels' : 'Name this layout · enter saves · esc cancels'}</text>
          <input id="window-layout:name" focused value={editing.draft} maxLength={60} placeholder="Review, Debugging…"
            onInput={(draft: string) => setEditing((current) => current ? { ...current, draft } : null)} />
        </box>
      ) : null}
      {previewHeight > 0 ? (
        <box id="window-layout:preview" height={previewHeight} flexShrink={0} flexDirection="column" overflow="hidden">
          <text fg={theme.dim} wrapMode="none">{previewDetail ?? 'Choose a layout to preview its windows'}</text>
          <text fg={theme.cyan} wrapMode="none">{previewLines.slice(0, Math.max(0, previewHeight - 2)).join('\n')}</text>
          <text fg={theme.dim} wrapMode="none">Numbers identify panes · placement uses focus · ⏎ applies</text>
        </box>
      ) : null}
      <text fg={theme.dim} wrapMode="none">{hint}</text>
    </box>
  )
}
