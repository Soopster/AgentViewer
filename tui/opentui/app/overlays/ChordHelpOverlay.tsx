/** @jsxImportSource @opentui/react */
import type { Toast } from '../../toastStore'
import type { TuiThemePalette } from '../../../theme'
import { toastExtraRows, toastStackTop } from '../../ToastOverlay'
import { fitText } from '../../textLayout'
import { chordHelpKeyWidth, chordHelpRows, SPLIT_CHORD_MAP, type ChordMap } from '../../chordHelp'
import { RUNNING_INSIDE_TMUX } from '../commands'
import type { ScrollBoxRenderable } from '@opentui/core'

/**
 * The panel's scrollbox, for the key handler: a panel opened with `?` scrolls
 * on ↑↓/j/k/PgUp/PgDn/Home/End. A self-revealed panel scrolls on the wheel
 * only, since its keys belong to the pending chord.
 */
export const chordHelpScroll: { current: ScrollBoxRenderable | null; page: number } = { current: null, page: 6 }

/** Scroll the open panel for a key; false for a key that is not a scroll key. */
export function scrollChordHelpForKey(key: { name: string; sequence?: string; shift?: boolean }): boolean {
  const box = chordHelpScroll.current
  if (!box) return false
  const step = key.name === 'down' || key.sequence === 'j' ? 1
    : key.name === 'up' || key.sequence === 'k' ? -1
    : key.name === 'pagedown' || key.name === 'space' ? chordHelpScroll.page
    : key.name === 'pageup' ? -chordHelpScroll.page
    : key.name === 'home' ? -Number.MAX_SAFE_INTEGER
    : key.name === 'end' ? Number.MAX_SAFE_INTEGER
    : 0
  if (!step) return false
  box.scrollTop = Math.max(0, Math.min(box.scrollTop + step, Math.max(box.scrollHeight - box.viewport.height, 0)))
  return true
}

export function ChordHelpOverlay({ chordHelp, width, height, composerDockHeight, composerStatusBlockHeight, toasts, theme }: {
  chordHelp: { map: ChordMap; dismissOnKey: boolean; } | null
  width: number
  height: number
  composerDockHeight: number
  composerStatusBlockHeight: number
  toasts: Toast[]
  theme: TuiThemePalette
}) {
  return (
    chordHelp ? (() => {
          const map = chordHelp.map
          const keysW = chordHelpKeyWidth(map)
          const overlayW = Math.min(width - 6, Math.max(keysW + 44, 52))
          const labelW = overlayW - keysW - 6
          // Sized to the content, and scrolled once that outgrows the space
          // above the composer dock (which draws over it): the old `height - 8`
          // budget ignored the dock and swallowed the footer, which is where
          // the panel says how to dismiss it.
          const overlayTop = 2
          const overlayChromeRows = 4 // two borders, the header, the footer
          const rows = chordHelpRows(map)
          // A toast (the "is not bound" notice a hesitated chord leaves behind)
          // draws over this panel too, and over its last row, which is the one
          // that says how to close it — so end above the stack while it shows.
          const panelBottom = Math.min(
            height - composerDockHeight - composerStatusBlockHeight,
            toasts.length > 0 ? toastStackTop(toasts.length, height, toastExtraRows(toasts.map(item => item.message), width)) : height,
          )
          const maxRows = Math.max(panelBottom - overlayTop - overlayChromeRows, 6)
          const bodyRows = Math.min(rows.length, maxRows)
          const hidden = rows.length - bodyRows
          chordHelpScroll.page = Math.max(bodyRows - 1, 1)
          return (
            <box
              position="absolute"
              top={overlayTop}
              left={Math.max(Math.floor((width - overlayW) / 2), 2)}
              width={overlayW}
              border
              borderStyle="single"
              borderColor={theme.amber}
              backgroundColor={theme.surface}
              zIndex={32}
              flexDirection="column"
            >
              <box paddingX={1} backgroundColor={theme.surface2} flexDirection="row">
                <box flexGrow={1}>
                  <text fg={theme.amber} wrapMode="none">{map.title}</text>
                </box>
                <text fg={theme.dim} wrapMode="none">
                  {map === SPLIT_CHORD_MAP && RUNNING_INSIDE_TMUX
                    ? 'tmux owns ⌃B — use ?'
                    : `prefix ${map.prefix}`}
                </text>
              </box>
              <scrollbox
                ref={(box: ScrollBoxRenderable | null) => { chordHelpScroll.current = box }}
                id="chord-help-scroll"
                height={bodyRows}
                scrollY
                backgroundColor={theme.surface}
                scrollbarOptions={{ visible: hidden > 0, trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
              >
                {rows.map((row) => (row.keys === null ? (
                  <box key={row.id} paddingX={1} backgroundColor={theme.surface2} flexDirection="row">
                    <text fg={theme.cyan} wrapMode="none">{'┄ '}</text>
                    <text fg={theme.cyan} wrapMode="none">{row.label.toUpperCase()}</text>
                  </box>
                ) : (
                  <box key={row.id} paddingX={1} flexDirection="row">
                    <box width={keysW}>
                      <text fg={theme.amber} wrapMode="none">{fitText(row.keys, keysW)}</text>
                    </box>
                    <box flexGrow={1} paddingLeft={2}>
                      <text fg={theme.muted} wrapMode="none">{fitText(row.label, labelW)}</text>
                    </box>
                  </box>
                )))}
              </scrollbox>
              <box paddingX={1} backgroundColor={theme.surface2}>
                <text fg={theme.dim} wrapMode="none">
                  {fitText(
                    chordHelp.dismissOnKey
                      ? (hidden > 0 ? 'any other key closes · ↑↓ PgUp/PgDn wheel scroll' : 'any key closes')
                      : (hidden > 0 ? 'press a key · wheel scrolls' : 'press a key'),
                    overlayW - 4,
                  )}
                </text>
              </box>
            </box>
          )
        })() : null
  )
}
