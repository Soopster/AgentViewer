'use client'

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'

export async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error ?? `Request failed (${response.status})`)
  return payload as T
}

/** Loads on mount and on `reload`; a stale answer from a superseded request is dropped. `null` url loads nothing. */
export function useRemote<T>(url: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: url !== null })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (url === null) { setState({ data: null, error: null, loading: false }); return }
    let current = true
    setState((prev) => ({ ...prev, loading: true }))
    api<T>(url).then(
      (data) => { if (current) setState({ data, error: null, loading: false }) },
      (error: Error) => { if (current) setState({ data: null, error: error.message, loading: false }) },
    )
    return () => { current = false }
  }, [url, tick])
  return { ...state, reload: useCallback(() => setTick((value) => value + 1), []) }
}

/** Runs an async action with a busy flag and an error string; `onDone` runs after success. */
export function useAction(onDone?: () => void) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const run = useCallback(async (work: () => Promise<string | void>, done = 'Done') => {
    setBusy(true); setMessage(null)
    try {
      const url = await work()
      setMessage({ tone: 'ok', text: url ? `${done} ${url}` : done })
      onDone?.()
      return true
    } catch (error) {
      setMessage({ tone: 'error', text: (error as Error).message })
      return false
    } finally { setBusy(false) }
  }, [onDone])
  return { busy, message, run, clear: () => setMessage(null) }
}

export const q = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
  return search.toString()
}

export const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : '')
export const muted: CSSProperties = { color: 'var(--text-muted, #888)', fontSize: 12 }
export const red = 'var(--red, #d33)'
export const green = 'var(--green, #2a9d4a)'

export const stateDot = (state: string) => (state === 'success' || state === 'SUCCESS' ? '🟢' : state === 'failure' || state === 'FAILURE' ? '🔴' : state === 'pending' || state === 'in_progress' || state === 'queued' ? '🟡' : '⚪')

export function Row({ selected, onClick, children }: { selected?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <div onClick={onClick} style={{ padding: '8px 10px', cursor: onClick ? 'pointer' : 'default', borderBottom: '1px solid var(--border-2)', background: selected ? 'var(--surface-2, rgba(127,127,127,0.12))' : 'transparent' }}>
      {children}
    </div>
  )
}

export function Status({ loading, error, children }: { loading: boolean; error: string | null; children?: ReactNode }) {
  if (error) return <div style={{ padding: 16, color: red }}>{error}</div>
  if (loading) return <div style={{ padding: 16, ...muted }}>Loading…</div>
  return <>{children}</>
}

export function Message({ message }: { message: { tone: 'ok' | 'error'; text: string } | null }) {
  return message ? <div style={{ marginTop: 6, fontSize: 13, color: message.tone === 'error' ? red : green, wordBreak: 'break-word' }}>{message.text}</div> : null
}

/** List on the left, detail on the right; the left stays put while the right scrolls. */
export function Split({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div style={{ width: '42%', minWidth: 0, borderRight: '1px solid var(--border-2)', overflow: 'auto' }}>{list}</div>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 12 }}>{detail}</div>
    </div>
  )
}

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}{count !== undefined ? <span style={{ ...muted, marginLeft: 6 }}>{count}</span> : null}</div>
      {children}
    </div>
  )
}

export function Pre({ children }: { children: ReactNode }) {
  return <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, wordBreak: 'break-word' }}>{children}</pre>
}

export function Pill({ children, tone }: { children: ReactNode; tone?: 'ok' | 'bad' | 'warn' }) {
  const color = tone === 'ok' ? green : tone === 'bad' ? red : tone === 'warn' ? 'var(--amber, #c80)' : 'var(--text-muted, #888)'
  return <span style={{ border: `1px solid ${color}`, color, borderRadius: 10, padding: '0 7px', fontSize: 11, marginRight: 4, whiteSpace: 'nowrap' }}>{children}</span>
}
