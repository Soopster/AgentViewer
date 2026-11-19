/** @jsxImportSource @opentui/react */
import type { WindowLayout } from '../../windowLayout'
import type { TuiThemePalette } from '../../../theme'
import React from 'react'
import { type WindowGroupKey, type WindowArrangement } from '../../windowLayout'
import { useBordersVisible } from '../borders'

type GridSecondDividerProps = {
  arrangedVisible: boolean
  fullscreenMode: boolean
  windowZoom: number | 'reader' | null
  splitArrangement: WindowArrangement
  arrangedLayout: WindowLayout
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  windowAreaRect: () => { x: number; y: number; width: number; height: number; } | null
  setSecondaryDividerHovered: React.Dispatch<React.SetStateAction<boolean>>
  setSplitDividerDragging: React.Dispatch<React.SetStateAction<'primary' | 'secondary' | { group: WindowGroupKey; index: number; } | null>>
  secondaryDividerHovered: boolean
  splitDividerDragging: 'primary' | 'secondary' | { group: WindowGroupKey; index: number; } | null
  theme: TuiThemePalette
}

export function GridSecondDivider(props: GridSecondDividerProps) {
  const {
    arrangedVisible, fullscreenMode, windowZoom, splitArrangement, arrangedLayout, rectOf,
    windowAreaRect, setSecondaryDividerHovered, setSplitDividerDragging, secondaryDividerHovered,
    splitDividerDragging, theme,
  } = props
  const bordersVisible = useBordersVisible()
  return (
    (() => {
        // The second divider: the grid's row split (the reader's bottom border).
        // Drawn at the root over that border, where it is inside its parent's
        // bounds. Borders between panes are the group handles below.
        if (!arrangedVisible || fullscreenMode || windowZoom !== null) return null
        const anchor = splitArrangement === 'grid' && arrangedLayout.secondary ? rectOf('transcript-reader') : null
        if (!anchor) return null
        const area = windowAreaRect()
        const left = area ? area.x : anchor.x
        const span = area ? area.width : anchor.width
        return (
          <box
            id="split-secondary-divider"
            position="absolute"
            top={anchor.y + anchor.height - 1}
            left={left + 1}
            width={Math.max(1, span - 2)}
            height={1}
            zIndex={40}
            onMouseOver={() => setSecondaryDividerHovered(true)}
            onMouseOut={() => setSecondaryDividerHovered(false)}
            onMouseDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              setSplitDividerDragging('secondary')
            }}
          >
            <text fg={!bordersVisible ? theme.bg : secondaryDividerHovered || splitDividerDragging === 'secondary' ? theme.cyan : theme.border} wrapMode="none" selectable={false}>
              {(bordersVisible ? '─' : ' ').repeat(Math.max(1, span - 2))}
            </text>
          </box>
        )
      })()
  )
}
