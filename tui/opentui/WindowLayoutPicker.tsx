/** @jsxImportSource @opentui/react */
// The window layout menu: macOS's "Move & Resize / Fill & Arrange", for the
// reader and its split panes. Each choice is a small picture of the layout it
// makes, clickable, and reachable by arrows and Enter.
import { useCallback, useEffect, useState } from 'react'

import type { TuiThemePalette } from '../theme'
import { MODAL_CONTENT_Z_INDEX } from './layers'

export type WindowLayoutAction =
  | 'reader-left' | 'reader-right' | 'reader-top' | 'reader-bottom'
  | 'fill' | 'two' | 'main-stack' | 'grid'
  | 'fullscreen'

type Choice = { action: WindowLayoutAction; label: string; icon: [string, string] }

// Icon cells: `r` the reader, `p` a pane, `·` empty space beside a moved reader.
export const WINDOW_LAYOUT_SECTIONS: ReadonlyArray<{ title: string; choices: Choice[] }> = [
  {
    title: 'Move & Resize',
    choices: [
      { action: 'reader-left', label: 'Reader on the left', icon: ['rrr··', 'rrr··'] },
      { action: 'reader-right', label: 'Reader on the right', icon: ['··rrr', '··rrr'] },
      { action: 'reader-top', label: 'Reader on top', icon: ['rrrrr', '·····'] },
      { action: 'reader-bottom', label: 'Reader below', icon: ['·····', 'rrrrr'] },
    ],
  },
  {
    title: 'Fill & Arrange',
    choices: [
      { action: 'fill', label: 'Reader only', icon: ['rrrrr', 'rrrrr'] },
      { action: 'two', label: 'Reader and one pane', icon: ['rr pp', 'rr pp'] },
      { action: 'main-stack', label: 'Reader and a stack', icon: ['rrr p', 'rrr p'] },
      { action: 'grid', label: 'Grid of four', icon: ['rr pp', 'pp pp'] },
    ],
  },
]

const FLAT: WindowLayoutAction[] = [...WINDOW_LAYOUT_SECTIONS.flatMap((section) => section.choices.map((choice) => choice.action)), 'fullscreen']
const PER_ROW = 4
const ICON_WIDTH = 9
const MENU_WIDTH = PER_ROW * (ICON_WIDTH + 2) + 4

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }

export function WindowLayoutPicker({
  theme,
  width,
  height,
  current,
  fullscreen,
  onPick,
  onClose,
  onKeyHandlerReady,
}: {
  theme: TuiThemePalette
  width: number
  height: number
  /** The choice the current layout matches, lit like the active button in the macOS menu. */
  current: WindowLayoutAction | null
  fullscreen: boolean
  onPick: (action: WindowLayoutAction) => void
  onClose: () => void
  onKeyHandlerReady: (handler: (key: Key) => void) => void
}) {
  const [cursor, setCursor] = useState(() => Math.max(0, current ? FLAT.indexOf(current) : 0))

  const handleKey = useCallback((key: Key) => {
    if (key.name === 'escape' || key.sequence === 'q') { onClose(); return }
    const last = FLAT.length - 1
    if (key.name === 'right' || key.sequence === 'l') { setCursor((index) => Math.min(last, index + 1)); return }
    if (key.name === 'left' || key.sequence === 'h') { setCursor((index) => Math.max(0, index - 1)); return }
    if (key.name === 'down' || key.sequence === 'j') { setCursor((index) => Math.min(last, index + PER_ROW)); return }
    if (key.name === 'up' || key.sequence === 'k') { setCursor((index) => Math.max(0, index - PER_ROW)); return }
    if (key.name === 'return' || key.name === 'space') { onPick(FLAT[cursor]!); return }
    if (key.sequence === 'f') { onPick('fullscreen'); return }
    // 1–8 pick by position, as the icons read left to right.
    if (/^[1-8]$/.test(key.sequence)) onPick(FLAT[Number(key.sequence) - 1]!)
  }, [cursor, onClose, onPick])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const menuHeight = 17
  const left = Math.max(0, Math.floor((width - MENU_WIDTH) / 2))
  const top = Math.max(0, Math.floor((height - menuHeight) / 2))

  const iconCell = (char: string, lit: boolean) => {
    if (char === 'r') return <span fg={lit ? theme.bg : theme.cyan}>{'█'}</span>
    if (char === 'p') return <span fg={lit ? theme.bg : theme.muted}>{'█'}</span>
    return <span fg={lit ? theme.bg : theme.dim}>{char === '·' ? '░' : ' '}</span>
  }

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
    >
      {WINDOW_LAYOUT_SECTIONS.map((section, sectionIndex) => (
        <box key={section.title} flexDirection="column" marginTop={sectionIndex === 0 ? 0 : 1}>
          <text fg={theme.dim} wrapMode="none">{section.title}</text>
          <box flexDirection="row" height={4}>
            {section.choices.map((choice) => {
              const index = FLAT.indexOf(choice.action)
              const selected = index === cursor
              const active = choice.action === current
              const lit = active
              return (
                <box
                  key={choice.action}
                  id={`window-layout:${choice.action}`}
                  width={ICON_WIDTH}
                  height={4}
                  marginRight={2}
                  border
                  borderStyle="rounded"
                  borderColor={selected ? theme.cyan : active ? theme.cyan : theme.border}
                  backgroundColor={lit ? theme.cyan : selected ? theme.surface3 : theme.surface}
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
      <box
        id="window-layout:fullscreen"
        flexDirection="row"
        height={1}
        backgroundColor={FLAT[cursor] === 'fullscreen' ? theme.surface3 : undefined}
        onMouseDown={(event: { button: number; stopPropagation?: () => void }) => {
          if (event.button !== 0) return
          event.stopPropagation?.()
          onPick('fullscreen')
        }}
      >
        <text fg={theme.text} wrapMode="none">{fullscreen ? 'Leave Full Screen' : 'Full Screen'}</text>
        <box flexGrow={1} />
        <text fg={theme.dim} wrapMode="none">{'f ›'}</text>
      </box>
      <text fg={theme.dim} wrapMode="none">
        {(() => {
          const choice = WINDOW_LAYOUT_SECTIONS.flatMap((section) => section.choices).find((entry) => entry.action === FLAT[cursor])
          return choice ? `${choice.label} · ⏎ applies · esc` : 'Toggle full screen · ⏎ · esc'
        })()}
      </text>
    </box>
  )
}
