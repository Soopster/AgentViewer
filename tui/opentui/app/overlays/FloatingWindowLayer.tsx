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
            const left = (windowAreaRef.current?.x ?? sidebarWidth + verticalTabsWidth) + rect.x
            const top = (windowAreaRef.current?.y ?? (tabsEnabled ? 2 : 1)) + rect.y
            if (floatingItem.kind === 'surface') {
              // The surface itself is drawn by the surface layer (41). This box only marks where it is
              // (its geometry is read by id) and must sit UNDER the whole window area (zIndex 0; a child's 41 does not lift it above a sibling of its parent): over it, the box took every press
              // meant for the surface's own title controls (≡, ⊞ layout, ⇥ panel, ×), its body and its
              // right-click menu. What the window owns that the surface does not — dragging it by the
              // title's left part, docking it, resizing it — is a few small boxes over the surface.
              return (
                <>
                  <box id="floating-window" visible={!hidden} position="absolute" left={left} top={top} width={rect.width} height={rect.height} zIndex={-1} />
                  {!hidden && !maximized ? (
                    <>
                      <box id="floating-title-handle" position="absolute" left={left} top={top} width={Math.max(1, rect.width - 30)} height={1} zIndex={50}
                        onMouseDown={(event: { button: number; x: number; y: number }) => { if (event.button === 0) startFloatGesture('move', event) }}
                        onMouseDrag={(event: { x: number; y: number }) => moveFloatGesture(event)}
                        onMouseUp={(event: { x: number; y: number }) => endFloatGesture(event)}
                      />
                      <box position="absolute" left={left + Math.max(0, rect.width - 28)} top={top} height={1} flexDirection="row" zIndex={50}>
                        <WindowButton id="floating-dock" label=" ⊞ dock " theme={theme} onPress={() => dockFloatingWindow()} />
                      </box>
                      <box id="floating-resize" position="absolute" left={left + rect.width - 1} top={top + rect.height - 1} width={1} height={1} zIndex={50}
                        onMouseDown={(event) => { if (event.button === 0) startFloatGesture('resize', event) }}
                        onMouseDrag={(event: { x: number; y: number }) => moveFloatGesture(event)}
                        onMouseUp={(event: { x: number; y: number }) => endFloatGesture(event)}
                      >
                        <text fg={theme.cyan} selectable={false}>◢</text>
                      </box>
                    </>
                  ) : null}
                </>
              )
            }
            return (
              <box id="floating-window" visible={!hidden} position="absolute" left={(windowAreaRef.current?.x ?? sidebarWidth + verticalTabsWidth) + rect.x} top={(windowAreaRef.current?.y ?? (tabsEnabled ? 2 : 1)) + rect.y} width={rect.width} height={rect.height}
                // Over a floating surface (drawn by the surface layer at 41) it is
                // only its controls; over a session it is the window and opaque —
                // an unpainted cell would show the windows underneath through it.
                zIndex={50}
                backgroundColor={theme.bg}
                onMouseDown={(event) => {
                  const frame = rectOf('floating-window')
                  if (!maximized && event.button === 0 && frame && event.y === frame.y) startFloatGesture('move', event)
                }}
                onMouseDrag={(event: { x: number; y: number }) => moveFloatGesture(event)}
                onMouseUp={(event: { x: number; y: number }) => endFloatGesture(event)}
              >
                <text position="absolute" left={0} top={0} width={rect.width} height={rect.height} fg={theme.bg} bg={theme.bg} selectable={false} wrapMode="none">{Array(rect.height).fill(' '.repeat(rect.width)).join('\n')}</text>
                {renderSplitPane(floatingItem.session, FLOATING_PANE_INDEX, size, hidden)}
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
