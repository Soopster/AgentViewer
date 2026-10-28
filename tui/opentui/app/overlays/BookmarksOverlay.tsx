/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import { type MessageBookmark } from '../../../../lib/messageBookmarks'
import { fitText } from '../../textLayout'
import { clamp } from '../util'
import { TUI_PROVIDER_TAG } from '../pickers'

export function BookmarksOverlay({ bookmarksOverlayOpen, width, bookmarksOverlay, focusMode, height, bookmarksOverlayIndex, theme }: {
  bookmarksOverlayOpen: boolean
  width: number
  bookmarksOverlay: MessageBookmark[]
  focusMode: boolean
  height: number
  bookmarksOverlayIndex: number
  theme: TuiThemePalette
}) {
  return (
    bookmarksOverlayOpen ? (() => {
          const overlayW = Math.min(width - 6, 88)
          const labelW = overlayW - 4
          const maxRows = Math.max(Math.min(bookmarksOverlay.length, (focusMode ? height - 6 : height - 8)), 1)
          const startIdx = clamp(bookmarksOverlayIndex - Math.floor(maxRows / 2), 0, Math.max(0, bookmarksOverlay.length - maxRows))
          const visible = bookmarksOverlay.slice(startIdx, startIdx + maxRows)
          return (
            <box
              position="absolute"
              top={focusMode ? 2 : 4}
              left={Math.max(Math.floor((width - overlayW) / 2), 2)}
              width={overlayW}
              border
              borderStyle="single"
              borderColor={theme.amber}
              backgroundColor={theme.surface}
              zIndex={32}
              flexDirection="column"
            >
              <box paddingX={1} paddingTop={1} backgroundColor={theme.surface2}>
                <text fg={theme.amber}>{fitText(`★ BOOKMARKS  ·  ${bookmarksOverlay.length} saved  ·  j/k move  ·  enter open  ·  esc close`, overlayW - 4)}</text>
              </box>
              {bookmarksOverlay.length === 0 ? (
                <box paddingX={1} paddingY={1}>
                  <text fg={theme.dim}>No bookmarks yet — press b on a message to save one.</text>
                </box>
              ) : visible.map((record, i) => {
                const absoluteIndex = startIdx + i
                const isSelected = absoluteIndex === bookmarksOverlayIndex
                const tag = TUI_PROVIDER_TAG[record.provider] ?? record.provider
                const title = record.sessionTitle || 'Untitled session'
                const preview = (record.preview || '').replace(/\s+/g, ' ').trim()
                return (
                  <box key={`${record.provider}:${record.sessionId}:${record.uuid}`} paddingX={1} backgroundColor={isSelected ? theme.surface3 : theme.surface} flexDirection="column">
                    <box flexDirection="row">
                      <text fg={isSelected ? theme.cyan : theme.amber} wrapMode="none">{`${isSelected ? '> ' : '  '}[${tag}] `}</text>
                      <text fg={isSelected ? theme.text : theme.muted} wrapMode="none">{fitText(title, labelW - tag.length - 6)}</text>
                    </box>
                    {preview ? (
                      <box paddingLeft={2}>
                        <text fg={theme.dim} wrapMode="none">{fitText(preview, labelW - 2)}</text>
                      </box>
                    ) : null}
                  </box>
                )
              })}
            </box>
          )
        })() : null
  )
}
