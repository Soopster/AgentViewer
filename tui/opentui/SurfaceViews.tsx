/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useRef, useState } from 'react'
import { spawn, type ChildProcess } from 'node:child_process'

import type { TuiThemePalette } from '../theme'
import { normalizeBrowserUrl, openExternalUrl, terminalBrowserCommand, terminalBrowserEnabled } from './terminalBrowser'

/**
 * The two surface-panel views the terminal has to build for itself.
 *
 * A terminal cannot host a rendering engine or a nested PTY the way the web
 * panel hosts an iframe and a wterm, so neither view pretends to. The browser
 * hands the URL to `terminal-browser`, which puts a real browser in a pane of
 * the user's own terminal beside the TUI; the shell view runs one command at a
 * time and shows its output, which is what the panel width can honestly carry.
 */

const OUTPUT_LINE_CAP = 2000

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

// ─── Shell ────────────────────────────────────────────────────────────────────

export function ShellSurfaceView({
  theme,
  width,
  height,
  focused,
  cwd,
}: {
  theme: TuiThemePalette
  width: number
  height: number
  focused: boolean
  cwd: string
}) {
  const [draft, setDraft] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const childRef = useRef<ChildProcess | null>(null)

  // A command outliving the panel would keep writing into unmounted state, so
  // the child is killed with the view rather than left to finish unseen.
  useEffect(() => () => { childRef.current?.kill('SIGTERM') }, [])

  const append = useCallback((chunk: string) => {
    setLines((current) => {
      const next = [...current, ...chunk.replace(/\r/g, '').split('\n')]
      return next.length > OUTPUT_LINE_CAP ? next.slice(next.length - OUTPUT_LINE_CAP) : next
    })
  }, [])

  const submit = useCallback((command: string) => {
    const trimmed = command.trim()
    if (!trimmed || childRef.current) return
    setDraft('')
    append(`$ ${trimmed}`)
    setRunning(trimmed)
    const shell = process.env.SHELL || '/bin/sh'
    const child = spawn(shell, ['-lc', trimmed], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    childRef.current = child
    child.stdout?.on('data', (data: Buffer) => append(data.toString('utf8')))
    child.stderr?.on('data', (data: Buffer) => append(data.toString('utf8')))
    child.once('error', (error) => { append(String(error)); childRef.current = null; setRunning(null) })
    child.once('close', (code) => {
      append(`— exit ${code ?? 0}`)
      childRef.current = null
      setRunning(null)
    })
  }, [append, cwd])

  const outputHeight = Math.max(1, height - 4)
  const visible = lines.slice(Math.max(0, lines.length - outputHeight))

  return (
    <box height={height} flexDirection="column" paddingX={1}>
      <box height={outputHeight} flexDirection="column" overflow="hidden">
        {visible.length === 0 ? (
          <text fg={theme.dim} wrapMode="none">{clip(`run a command in ${cwd}`, width - 2)}</text>
        ) : (
          visible.map((line, index) => (
            <text
              key={`${index}:${line.slice(0, 12)}`}
              fg={line.startsWith('$ ') ? theme.cyan : line.startsWith('— exit') ? theme.dim : theme.text}
              wrapMode="none"
            >
              {clip(line, width - 2)}
            </text>
          ))
        )}
      </box>
      <text fg={theme.dim} wrapMode="none">
        {clip(running ? `running: ${running} · ⌃C stops it` : 'enter runs · ⌃C stops', width - 2)}
      </text>
      <box paddingX={1} backgroundColor={theme.surface3} height={1}>
        <input focused={focused && !running} value={draft} maxLength={500} onInput={setDraft} onSubmit={() => submit(draft)} />
      </box>
    </box>
  )
}
