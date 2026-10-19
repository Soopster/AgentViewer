/** @jsxImportSource @opentui/react */
import { useCallback, useState } from 'react'

import type { TuiThemePalette } from '../theme'
import { normalizeBrowserUrl, openExternalUrl, terminalBrowserCommand, terminalBrowserEnabled } from './terminalBrowser'

/**
 * The browser surface the terminal has to build for itself.
 *
 * A terminal cannot host a rendering engine the way the web panel hosts an
 * iframe, so this view does not pretend to: it hands the URL to
 * `terminal-browser`, which puts a real browser in a pane of the user's own
 * terminal beside the TUI. The Terminal surface is `ProcessPane.tsx`.
 */

function clip(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  return width === 1 ? '…' : `${text.slice(0, width - 1)}…`
}

// ─── Browser ──────────────────────────────────────────────────────────────────

export function BrowserSurfaceView({
  theme,
  width,
  height,
  focused,
  recent,
  onOpened,
}: {
  theme: TuiThemePalette
  width: number
  height: number
  focused: boolean
  recent: readonly string[]
  onOpened: (url: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const submit = useCallback((value: string) => {
    const url = normalizeBrowserUrl(value)
    if (!url) return
    setDraft('')
    setStatus(`opening ${url}…`)
    openExternalUrl(url)
      .then(() => {
        onOpened(url)
        setStatus(terminalBrowserEnabled()
          ? `${url} — opened in a terminal split`
          : `${url} — opened in your desktop browser`)
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : `Could not open ${url}`)
      })
  }, [onOpened])

  return (
    <box height={height} flexDirection="column" paddingX={1} paddingTop={1}>
      <text fg={theme.dim} wrapMode="none">{clip('URL, host, or port', width - 2)}</text>
      <box paddingX={1} backgroundColor={theme.surface3} height={1}>
        <input focused={focused} value={draft} maxLength={400} onInput={setDraft} onSubmit={() => submit(draft)} />
      </box>
      <box height={1} />
      {status ? <text fg={theme.cyan} wrapMode="none">{clip(status, width - 2)}</text> : null}
      <box height={1} />
      <text fg={theme.dim} wrapMode="none">{clip('recent', width - 2)}</text>
      {recent.length === 0 ? (
        <text fg={theme.dim} wrapMode="none">{clip('  nothing opened yet', width - 2)}</text>
      ) : (
        recent.slice(0, Math.max(1, height - 10)).map((url) => (
          <text key={url} fg={theme.muted} wrapMode="none">{clip(`  ${url}`, width - 2)}</text>
        ))
      )}
      <box height={1} />
      <text fg={theme.dim} wrapMode="none">
        {clip(terminalBrowserEnabled()
          ? `opens beside the TUI via ${terminalBrowserCommand()}`
          : 'terminal-browser disabled — using the desktop opener', width - 2)}
      </text>
    </box>
  )
}
