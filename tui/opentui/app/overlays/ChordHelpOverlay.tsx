/** @jsxImportSource @opentui/react */
import type { Toast } from '../../toastStore'
import type { TuiThemePalette } from '../../../theme'
import { toastExtraRows, toastStackTop } from '../../ToastOverlay'
import { fitText } from '../../textLayout'
import { chordHelpKeyWidth, chordHelpRows, SPLIT_CHORD_MAP, type ChordMap } from '../../chordHelp'
import { RUNNING_INSIDE_TMUX } from '../commands'

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
          // The panel is a reference card, so it is sized to the content and
          // clipped rather than scrolled — but it must not be clipped by the
          // composer dock, which draws over it. The old `height - 8` budget
          // ignored the dock and swallowed the footer, which is where the panel
          // says how to dismiss it; an overflow note the reader never sees is
          // worse than showing fewer rows.
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
          const visible = rows.slice(0, maxRows)
          const hidden = rows.length - visible.length
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
              {visible.map((row) => (row.keys === null ? (
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
              <box paddingX={1} backgroundColor={theme.surface2}>
                <text fg={theme.dim} wrapMode="none">
                  {fitText(
                    chordHelp.dismissOnKey
                      ? (hidden > 0 ? `${hidden} more — widen the terminal · any key closes` : 'any key closes')
                      : (hidden > 0 ? `${hidden} more — widen the terminal · press a key` : 'press a key'),
                    overlayW - 4,
                  )}
                </text>
              </box>
            </box>
          )
        })() : null
  )
}
