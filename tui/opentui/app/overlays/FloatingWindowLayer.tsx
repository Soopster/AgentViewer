/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import React from 'react'
import { WindowButton } from '../../WindowButton'
import { clampFloatingRect, type FloatingRect } from '../../windowTabs'
import { type BoxRenderable } from '@opentui/core'
import { type Session } from '../../../../lib/types'
import { join } from 'node:path'
import { type WindowItem } from '../types'
import { FLOATING_PANE_INDEX } from '../layoutConstants'

export function FloatingWindowLayer({ presentationActive = false, maximized = false, floatingItem, floatingWindow, fullscreenMode, windowSurfacePeek, readerAreaWidth, windowAreaHeight, windowAreaRef, sidebarWidth, verticalTabsWidth, tabsEnabled, theme, rectOf, startFloatGesture, moveFloatGesture, endFloatGesture, renderSplitPane, dockFloatingWindow }: {
  presentationActive?: boolean
  maximized?: boolean
  floatingItem: WindowItem | null
  floatingWindow: { key: string; rect: FloatingRect; slot: number; } | null
  fullscreenMode: boolean
  windowSurfacePeek: string | null
  readerAreaWidth: number
  windowAreaHeight: number
  windowAreaRef: React.RefObject<BoxRenderable | null>
  sidebarWidth: number
  verticalTabsWidth: number
  tabsEnabled: boolean
  theme: TuiThemePalette
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  startFloatGesture: (mode: 'move' | 'resize', event: { x: number; y: number; }) => void
  moveFloatGesture: (event: { x: number; y: number; }) => void
  endFloatGesture: (event?: { x: number; y: number; }) => void
  renderSplitPane: (splitSession: Session, splitIndex: number, size: { width: number; height: number; boxHeight: number | undefined; }, hidden?: boolean) => React.ReactNode
  dockFloatingWindow: () => void
}) {
  return (
    floatingItem && floatingWindow ? (() => {
            const rect = maximized ? { x: 0, y: 0, width: readerAreaWidth, height: windowAreaHeight } : clampFloatingRect(floatingWindow.rect, { width: readerAreaWidth, height: windowAreaHeight })
            const hidden = Boolean(windowSurfacePeek) || (presentationActive && !maximized)
            const size = { width: rect.width, height: rect.height, boxHeight: rect.height }
            return (
              <box id="floating-window" visible={!hidden} position="absolute" left={(windowAreaRef.current?.x ?? sidebarWidth + verticalTabsWidth) + rect.x} top={(windowAreaRef.current?.y ?? (tabsEnabled ? 2 : 1)) + rect.y} width={rect.width} height={rect.height}
                // Over a floating surface (drawn by the surface layer at 41) it is
                // only its controls; over a session it is the window and opaque —
                // an unpainted cell would show the windows underneath through it.
                zIndex={50}
                backgroundColor={floatingItem.kind === 'surface' ? undefined : theme.bg}
                onMouseDown={(event) => {
                  const frame = rectOf('floating-window')
                  if (!maximized && floatingItem.kind === 'surface' && event.button === 0 && frame && event.y === frame.y) startFloatGesture('move', event)
                }}
                onMouseDrag={(event: { x: number; y: number }) => moveFloatGesture(event)}
                onMouseUp={(event: { x: number; y: number }) => endFloatGesture(event)}
              >
                {floatingItem.kind === 'session' ? <text position="absolute" left={0} top={0} width={rect.width} height={rect.height} fg={theme.bg} bg={theme.bg} selectable={false} wrapMode="none">{Array(rect.height).fill(' '.repeat(rect.width)).join('\n')}</text> : null}
                {floatingItem.kind === 'session' ? renderSplitPane(floatingItem.session, FLOATING_PANE_INDEX, size, hidden) : null}
                {!maximized ? <box position="absolute" top={0} right={20} height={1} flexDirection="row" zIndex={46}>
                  <WindowButton id="floating-dock" label=" ⊞ dock " theme={theme} onPress={() => dockFloatingWindow()} />
                </box> : null}
                {!maximized ? <box id="floating-resize" position="absolute" bottom={0} right={0} width={1} height={1} zIndex={46}
                  onMouseDown={(event) => { if (event.button === 0) startFloatGesture('resize', event) }}
                >
                  <text fg={theme.cyan} selectable={false}>◢</text>
                </box> : null}
              </box>
            )
          })() : null
  )
}
