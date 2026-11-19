import { spawn } from 'node:child_process'

/**
 * Opening a URL from the TUI.
 *
 * The `terminal-browser` package (zenbu-labs) runs a real browser in a terminal
 * pane, so a URL the agent wants to show can sit beside the TUI instead of
 * pulling the user into a desktop window. It owns the pane/daemon plumbing; we
 * only hand it a validated URL and ask for a borderless split.
 *
 * The desktop opener stays the fallback for SSH sessions, older installs, and
 * terminals where pane discovery is unavailable.
 */

export function terminalBrowserEnabled(): boolean {
  return process.env.AGENT_VIEWER_DISABLE_TERMINAL_BROWSER !== '1'
}

export function terminalBrowserCommand(): string {
  return process.env.AGENT_VIEWER_TERMINAL_BROWSER?.trim() || 'terminal-browser'
}

export function openInTerminalBrowser(url: string, split: 'right' | 'down' | 'left' | 'up' = 'right'): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(terminalBrowserCommand(), ['open', url, '--split', split, '--app-mode'], {
      detached: true,
      stdio: 'ignore',
    })
    child.once('spawn', () => { child.unref(); resolve() })
    child.once('error', reject)
  })
}

export function openNativeUrl(url: string): Promise<void> {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'linux'
    ? 'xdg-open'
    : null
  if (!command) return Promise.reject(new Error(`Open this URL in a browser: ${url}`))
  return new Promise((resolve, reject) => {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' })
    child.once('spawn', () => { child.unref(); resolve() })
    child.once('error', reject)
  })
}

export function openExternalUrl(url: string): Promise<void> {
  if (!terminalBrowserEnabled()) return openNativeUrl(url)
  return openInTerminalBrowser(url).catch(() => openNativeUrl(url))
}

/** Bare hosts, ports and paths all become something loadable. */
export function normalizeBrowserUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^\d{2,5}$/.test(trimmed)) return `http://localhost:${trimmed}`
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/')) return `http://localhost:3000${trimmed}`
  return `http://${trimmed}`
}
