/** @jsxImportSource @opentui/react */
import type { WindowItem } from '../types'
import type { WindowLayout } from '../../windowLayout'
import type { SplitRect } from '../../windowSplitTree'
import type { SplitDivider } from '../../windowSplitTree'
import type { TuiThemePalette } from '../../../theme'
import { type WindowSplitTree } from '../../windowSplitTree'
import { surfaceTitle } from '../../windowSurfaceNames'
import { windowDropZoneRect, type WindowDropZone } from '../../windowLayout'
import { formatSessionTitle } from '../../../format'
import { type Session } from '../../../../lib/types'
import { fitText } from '../../textLayout'
import { type WindowSurfaceId } from '../SplitTranscriptPane'

export function SessionDragOverlay({ sessionDrag, rectOf, windowAreaRect, nestedDragPreview, windowNumberOffset, windowKeyTitle, windowItems, hasPrimaryFrame, theme, height, width }: {
  sessionDrag: { session: Session | null; surface?: WindowSurfaceId; tab?: string; reader?: boolean; fromPane: number | null; zone: WindowDropZone | null; pane: number | null; insert: WindowDropZone | null; title?: boolean; x: number; y: number; } | null
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  windowAreaRect: () => { x: number; y: number; width: number; height: number; } | null
  nestedDragPreview: { tree: WindowSplitTree; geometry: { layout: WindowLayout; rects: Map<number, SplitRect>; dividers: SplitDivider[]; }; key: string; } | null
  windowNumberOffset: 1 | 2
  windowKeyTitle: (key: string) => string
  windowItems: WindowItem[]
  hasPrimaryFrame: boolean
  theme: TuiThemePalette
  height: number
  width: number
}) {
  return (
    sessionDrag ? (() => {
        // Where a dragged session would land, and the session itself under the
        // pointer. Drawn only: the press that started the drag holds it, so
        // these boxes take no events of their own.
        const reader = rectOf('transcript-reader')
        const paneRect = sessionDrag.pane !== null ? rectOf(`split-pane:${sessionDrag.pane}`) : null
        const area = windowAreaRect()
        const previewRect = nestedDragPreview?.geometry.rects.get(nestedDragPreview.tree.keys.indexOf(nestedDragPreview.key))
        const splitting = !sessionDrag.title && Boolean(sessionDrag.insert || (sessionDrag.pane === null && sessionDrag.zone && sessionDrag.zone !== 'center'))
        const rect = splitting ? (previewRect && area ? { ...previewRect, x: previewRect.x + area.x, y: previewRect.y + area.y } : null) : !sessionDrag.session && !sessionDrag.tab && !paneRect && reader && sessionDrag.zone ? reader
          : paneRect
          ? (sessionDrag.title ? { ...paneRect, height: Math.min(paneRect.height, 3) } : sessionDrag.insert ? windowDropZoneRect(paneRect, sessionDrag.insert) : paneRect)
          : (reader && sessionDrag.zone ? windowDropZoneRect(reader, sessionDrag.zone) : null)
        const label = sessionDrag.pane !== null && sessionDrag.insert ? `Beside pane ${sessionDrag.pane + windowNumberOffset}`
          : sessionDrag.pane !== null ? `Replace pane ${sessionDrag.pane + windowNumberOffset}`
          : !sessionDrag.zone ? 'Drop on the reader or a pane'
          : sessionDrag.zone === 'center' ? 'Open session'
          : `Put it ${sessionDrag.zone === 'left' ? 'left of' : sessionDrag.zone === 'right' ? 'right of' : sessionDrag.zone === 'top' ? 'above' : 'below'} the reader`
        // fitText pads to its width; trimmed, so the label is as long as what it says.
        const dragged = sessionDrag.tab ? windowKeyTitle(sessionDrag.tab) : sessionDrag.session ? formatSessionTitle(sessionDrag.session) : surfaceTitle(sessionDrag.surface ?? '')
        const overSurface = sessionDrag.pane !== null && windowItems[sessionDrag.pane]?.kind === 'surface'
        const shown = splitting ? (nestedDragPreview ? 'Split here' : 'Split does not fit') : hasPrimaryFrame && sessionDrag.pane === null && sessionDrag.zone === 'center' ? 'Add as a tab of window 1' : sessionDrag.reader && sessionDrag.pane !== null ? `Add as a tab of window ${sessionDrag.pane + windowNumberOffset}`
          : sessionDrag.tab ? (sessionDrag.pane !== null ? `Add as a tab of window ${sessionDrag.pane + windowNumberOffset}` : 'Its own window')
          : sessionDrag.title && sessionDrag.pane !== null ? `Add as a tab of window ${sessionDrag.pane + windowNumberOffset}`
          : !sessionDrag.session && sessionDrag.pane === null ? (sessionDrag.zone ? 'Float it here' : 'Drop on a window')
          : (overSurface || !sessionDrag.session) && sessionDrag.pane !== null && !sessionDrag.insert ? `Add as a tab of window ${sessionDrag.pane + windowNumberOffset}`
          : label
        const ghost = `⠿ ${fitText(dragged, 28).trimEnd()} · ${shown}`
        return (
          <>
            {rect ? (
              <box
                id="window-drop-zone"
                position="absolute"
                top={rect.y}
                left={rect.x}
                width={rect.width}
                height={rect.height}
                zIndex={900}
                border
                borderStyle="double"
                borderColor={theme.cyan}
              />
            ) : null}
            <box
              id="window-drag-ghost"
              position="absolute"
              top={Math.min(Math.max(0, sessionDrag.y + 1), height - 1)}
              // Kept on screen whole: the label plus its padding must fit left of the right edge.
              left={Math.min(Math.max(0, sessionDrag.x + 2), Math.max(0, width - ghost.length - 3))}
              height={1}
              zIndex={901}
              backgroundColor={rect ? theme.cyan : theme.surface3}
              paddingX={1}
            >
              <text fg={rect ? theme.bg : theme.text} wrapMode="none" selectable={false}>{ghost}</text>
            </box>
          </>
        )
      })() : null
  )
}
