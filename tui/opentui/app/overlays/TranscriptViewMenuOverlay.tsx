/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import React from 'react'
import { type TuiTranscriptView } from '../../../theme'
import type { CustomView } from '../../../viewSpec'
import { TRANSCRIPT_VIEWS, TRANSCRIPT_VIEW_LABELS, TRANSCRIPT_VIEW_DESCRIPTIONS } from '../commands'

export type ViewMenuItem =
  | { kind: 'builtin'; key: string; view: TuiTranscriptView }
  | { kind: 'custom'; key: string; view: CustomView }
  | { kind: 'new'; key: 'new' }

/** The built-ins, then the user's views, then "New view…". */
export function viewMenuItems(customViews: readonly CustomView[]): ViewMenuItem[] {
  return [
    ...TRANSCRIPT_VIEWS.map((view): ViewMenuItem => ({ kind: 'builtin', key: `builtin:${view}`, view })),
    ...customViews.map((view): ViewMenuItem => ({ kind: 'custom', key: `custom:${view.id}`, view })),
    { kind: 'new', key: 'new' },
  ]
}

export function viewMenuItemKey(transcriptView: TuiTranscriptView, customViewId: string | null): string {
  return customViewId ? `custom:${customViewId}` : `builtin:${transcriptView}`
}

export function TranscriptViewMenuOverlay({ transcriptViewMenuOpen, width, height, viewMenuItems: items, editedBuiltinViews, viewMenuOriginKey, focusMode, theme, transcriptViewMenuIndex, setTranscriptViewMenuIndex, previewViewMenuItem, chooseViewMenuItem, lightweightWindows }: {
  transcriptViewMenuOpen: boolean
  width: number
  height: number
  viewMenuItems: ViewMenuItem[]
  /** Built-ins the user has edited: marked •, and `e` resets them from the studio. */
  editedBuiltinViews: ReadonlySet<string>
  viewMenuOriginKey: string | null
  focusMode: boolean
  theme: TuiThemePalette
  transcriptViewMenuIndex: number
  setTranscriptViewMenuIndex: React.Dispatch<React.SetStateAction<number>>
  previewViewMenuItem: (item: ViewMenuItem) => void
  chooseViewMenuItem: (item: ViewMenuItem) => void
  lightweightWindows: boolean
}) {
  if (!transcriptViewMenuOpen) return null
  const menuWidth = Math.min(Math.max(width - 8, 28), 46)
  const top = focusMode ? 1 : 3
  // Borders, title row and its gap, the hint row and the bottom pad.
  const chrome = 6
  const menuHeight = Math.max(Math.min(items.length + chrome, height - top - 2), 11)
  const options = items.map((item) => {
    const name = item.kind === 'builtin' ? `${TRANSCRIPT_VIEW_LABELS[item.view]}${editedBuiltinViews.has(item.view) ? ' •' : ''}`
      : item.kind === 'custom' ? `★ ${item.view.name}`
      : '＋ New view…'
    return {
      name: `${name}${item.key === viewMenuOriginKey ? ' ✓' : ''}`,
      description: item.kind === 'builtin' ? `${TRANSCRIPT_VIEW_DESCRIPTIONS[item.view]}${editedBuiltinViews.has(item.view) ? ' (edited)' : ''}`
        : item.kind === 'custom' ? `Custom view based on ${TRANSCRIPT_VIEW_LABELS[item.view.base]}`
        : 'Compose a view in the View Studio',
      value: item.key,
    }
  })
  const highlighted = items[transcriptViewMenuIndex]
  return (
    <box
      id="transcript-view-menu"
      position="absolute"
      top={top}
      right={2}
      width={menuWidth}
      height={menuHeight}
      border
      borderStyle="single"
      borderColor={theme.border2}
      backgroundColor={theme.surface}
      zIndex={20}
      flexDirection="column"
    >
      <box paddingX={2} paddingBottom={1} flexDirection="row">
        <text fg={theme.cyan} wrapMode="none">TRANSCRIPT VIEW</text>
        <text fg={theme.dim} wrapMode="none">  v / esc close</text>
      </box>
      <box flexGrow={1} paddingX={1} paddingBottom={1}>
        <select
          style={{ height: menuHeight - 5 }}
          focused
          options={options}
          selectedIndex={transcriptViewMenuIndex}
          selectedBackgroundColor={theme.surface3}
          selectedTextColor={theme.text}
          textColor={theme.muted}
          descriptionColor={theme.dim}
          selectedDescriptionColor={theme.cyan}
          backgroundColor={theme.surface}
          focusedBackgroundColor={theme.surface}
          showScrollIndicator={false}
          showDescription={false}
          itemSpacing={0}
          onChange={(index) => {
            const next = items[index]
            if (!next) return
            setTranscriptViewMenuIndex(index)
            previewViewMenuItem(next)
          }}
          onSelect={(index) => {
            const next = items[index]
            if (next) chooseViewMenuItem(next)
          }}
        />
      </box>
      <box id="transcript-view-lightweight" height={1} paddingX={2} flexDirection="row">
        <text fg={theme.cyan} wrapMode="none">tab </text>
        <text fg={lightweightWindows ? theme.text : theme.muted} wrapMode="none">
          {lightweightWindows ? '● lightweight' : '○ lightweight'}
        </text>
        <text fg={theme.cyan} wrapMode="none">  c </text>
        <text fg={theme.muted} wrapMode="none">{highlighted?.kind === 'new' ? 'new' : 'clone'}</text>
        {highlighted?.kind === 'custom' || (highlighted?.kind === 'builtin' && highlighted.view !== 'engineering') ? (
          <>
            <text fg={theme.cyan} wrapMode="none">  e </text>
            <text fg={theme.muted} wrapMode="none">edit</text>
          </>
        ) : null}
      </box>
    </box>
  )
}
