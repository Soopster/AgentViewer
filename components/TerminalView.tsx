'use client'

import { WTerm } from '@wterm/dom'
import { GhosttyCore } from '@wterm/ghostty'
import '@wterm/dom/css'
import './terminal-wterm.css'
import { useEffect, useRef, useState } from 'react'

const GHOSTTY_WASM_PATH = '/ghostty-vt.wasm'
const FALLBACK_BG = '#07091c'
const FALLBACK_FG = '#dde3f5'

function cssVar(name: string): string | undefined {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || undefined
}

// The terminal renderer reads its palette from --term-* CSS custom properties,
// so we bind it to the app's per-theme semantic variables (mirrors the old
// xterm theme mapping).
function paletteVars(): Record<string, string> {
  const color = (key: string, fallback: string) => cssVar(key) ?? fallback
  const palette = {
    '--term-bg': color('--bg', FALLBACK_BG),
    '--term-fg': color('--text', FALLBACK_FG),
    '--term-cursor': color('--cyan', '#38d9f5'),
    '--term-color-0': color('--surface', '#0c1028'),
    '--term-color-1': color('--red', '#f06060'),
    '--term-color-2': color('--green', '#2dd4a0'),
    '--term-color-3': color('--amber', '#eaaa40'),
    '--term-color-4': color('--t-read', '#60a8ff'),
    '--term-color-5': color('--violet', '#8b80f0'),
    '--term-color-6': color('--cyan', '#38d9f5'),
    '--term-color-7': color('--text', FALLBACK_FG),
    '--term-color-8': color('--text-3', '#3a4c6a'),
    '--term-color-9': color('--red', '#f06060'),
    '--term-color-10': color('--green', '#2dd4a0'),
    '--term-color-11': color('--amber', '#eaaa40'),
    '--term-color-12': color('--t-read', '#60a8ff'),
    '--term-color-13': color('--violet', '#8b80f0'),
    '--term-color-14': color('--cyan', '#38d9f5'),
    '--term-color-15': color('--text', FALLBACK_FG),
    '--term-font-family': "'IBM Plex Mono', ui-monospace, monospace",
    '--term-font-size': '13px',
    '--term-line-height': '1.1',
  }
  return palette
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export default function TerminalView() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [exited, setExited] = useState(false)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const sessionId = crypto.randomUUID()
    const controller = new AbortController()
    let disposed = false
    let sessionEnded = false
    let term: WTerm | null = null
    let cols = 80
    let rows = 24

    const applyPalette = () => {
      const vars = paletteVars()
      for (const [name, value] of Object.entries(vars)) {
        mount.style.setProperty(name, value)
      }
      return vars
    }
    applyPalette()
    const themeObserver = new MutationObserver(applyPalette)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-render-font'],
    })

    const post = (path: string, body: object) =>
      fetch(path, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {})

    async function runStream(instance: WTerm) {
      let eventName = ''
      let payload = ''
      const dispatch = (event: string, data: string) => {
        if (event !== 'out') {
          if (event === 'state') {
            try {
              const st = JSON.parse(data) as { state?: string; message?: string; code?: number | null }
              if (st.state === 'exited') {
                sessionEnded = true
                setExited(true)
                instance.write('\r\n\x1b[90m[the TUI session ended]\x1b[0m\r\n')
              } else if (st.state === 'error') {
                sessionEnded = true
                setError(st.message ?? 'Could not start the embedded terminal.')
                instance.write(`\r\n\x1b[31m${st.message ?? 'Could not start the embedded terminal.'}\x1b[0m\r\n`)
              }
            } catch {
              // malformed state frame — ignore
            }
          }
          return
        }
        if (!data) return
        const bytes = base64ToBytes(data)
        const CHUNK = 32 * 1024
        for (let i = 0; i < bytes.length; i += CHUNK) {
          instance.write(bytes.subarray(i, i + CHUNK))
        }
      }
      while (!disposed && !sessionEnded) {
        try {
          const res = await fetch(`/api/terminal/stream?session=${sessionId}&cols=${cols}&rows=${rows}`, {
            signal: controller.signal,
          })
          if (!res.ok || !res.body) {
            throw new Error(`terminal stream failed (${res.status})`)
          }
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          eventName = ''
          payload = ''
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let nl: number
            while ((nl = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, nl).replace(/\r$/, '')
              buffer = buffer.slice(nl + 1)
              if (line === '') {
                dispatch(eventName, payload)
                eventName = ''
                payload = ''
                continue
              }
              if (line.startsWith(':')) continue
              const colon = line.indexOf(':')
              if (colon < 0) continue
              const field = line.slice(0, colon)
              const valuePart = line.slice(colon + 1).replace(/^ /, '')
              if (field === 'event') eventName = valuePart
              else if (field === 'data') payload += valuePart
            }
          }
          if (!disposed && !sessionEnded) {
            // stream ended without an exit signal — transient, reconnect
            await sleep(1000)
          }
        } catch (err) {
          if (disposed || sessionEnded) return
          if ((err as Error)?.name === 'AbortError') return
          await sleep(1000)
        }
      }
    }

    const vars = applyPalette()
    let cancelled = false
    void (async () => {
      try {
        const core = await GhosttyCore.load({
          wasmPath: GHOSTTY_WASM_PATH,
          scrollbackLimit: 4 * 1024 * 1024,
          foregroundColor: vars['--term-fg'],
          backgroundColor: vars['--term-bg'],
        })
        if (disposed || cancelled) return
        const instance = new WTerm(mount, {
          core,
          cols,
          rows,
          cursorBlink: true,
          autoResize: true,
          onData: (data) => {
            if (disposed) return
            void post(`/api/terminal/input?session=${sessionId}`, { data: utf8ToBase64(data) })
          },
          onResize: (nextCols, nextRows) => {
            if (disposed) return
            cols = nextCols
            rows = nextRows
            void post(`/api/terminal/resize?session=${sessionId}`, { cols, rows })
          },
        })
        term = instance
        await instance.init()
        if (disposed) {
          instance.destroy()
          return
        }
        void runStream(instance)
      } catch (err) {
        if (disposed || cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
      }
    })()

    return () => {
      disposed = true
      cancelled = true
      controller.abort()
      themeObserver.disconnect()
      term?.destroy()
      void fetch(`/api/terminal/session?session=${sessionId}`, { method: 'DELETE' }).catch(() => {})
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
      {(error || exited) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            fontSize: 11,
            fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: '0.04em',
            color: error ? 'var(--red, #f06060)' : 'var(--text-3)',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 99, flexShrink: 0, background: error ? 'var(--red, #f06060)' : 'var(--text-3)' }} />
          {error ?? 'The TUI session has ended. Reload the page to start a new one.'}
        </div>
      )}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          padding: 0,
          background: 'var(--bg)',
        }}
      >
        <div ref={mountRef} style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }} />
      </div>
    </div>
  )
}