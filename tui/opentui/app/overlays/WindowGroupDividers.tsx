/** @jsxImportSource @opentui/react */
import type { WindowLayout } from '../../windowLayout'
import type { TuiThemePalette } from '../../../theme'
import React from 'react'
import { type WindowGroupKey } from '../../windowLayout'
import { join } from 'node:path'
import { useBordersVisible } from '../borders'

export function WindowGroupDividers({ fullscreenMode, windowZoom, windowSurfacePeek, fittedWindows, rectOf, hoveredWindowBorder, splitDividerDragging, setHoveredWindowBorder, setSplitDividerDragging, theme }: {
  fullscreenMode: boolean
  windowZoom: number | 'reader' | null
  windowSurfacePeek: string | null
  fittedWindows: WindowLayout
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  hoveredWindowBorder: string | null
  splitDividerDragging: 'primary' | 'secondary' | { group: WindowGroupKey; index: number; } | null
  setHoveredWindowBorder: React.Dispatch<React.SetStateAction<string | null>>
  setSplitDividerDragging: React.Dispatch<React.SetStateAction<'primary' | 'secondary' | { group: WindowGroupKey; index: number; } | null>>
  theme: TuiThemePalette
}) {
  const bordersVisible = useBordersVisible()
  return (
    !fullscreenMode && windowZoom === null && !windowSurfacePeek ? fittedWindows.groups.flatMap((group) => group.members.slice(0, -1).map((member, index) => {
        const rect = rectOf(`split-pane:${member}`)
        if (!rect) return null
        const id = `window-border:${group.key}:${index}`
        const lit = hoveredWindowBorder === id || (typeof splitDividerDragging === 'object' && splitDividerDragging?.group === group.key && splitDividerDragging.index === index)
        const vertical = group.axis === 'x'
        const length = Math.max(1, (vertical ? rect.height : rect.width) - 2)
        return (
          <box
            key={id}
            id={id}
            position="absolute"
            top={vertical ? rect.y + 1 : rect.y + rect.height - 1}
            left={vertical ? rect.x + rect.width - 1 : rect.x + 1}
            width={vertical ? 1 : length}
            height={vertical ? length : 1}
            zIndex={40}
            onMouseOver={() => setHoveredWindowBorder(id)}
            onMouseOut={() => setHoveredWindowBorder((current) => (current === id ? null : current))}
            onMouseDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              setSplitDividerDragging({ group: group.key, index })
            }}
          >
            <text fg={!bordersVisible ? theme.bg : lit ? theme.cyan : theme.border} wrapMode="none" selectable={false}>
              {vertical ? Array.from({ length }, () => bordersVisible ? '│' : ' ').join('\n') : (bordersVisible ? '─' : ' ').repeat(length)}
            </text>
          </box>
        )
      })) : null
  )
}
