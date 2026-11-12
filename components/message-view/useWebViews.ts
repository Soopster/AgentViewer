'use client'
// The web's side of transcript views (tui/viewSpec.ts). Views are the same
// records the TUI composes in its View Studio, read and written through
// /api/views, so a view made in either surface is listed in both. Which view
// this browser shows is its own (localStorage), and applying one sets the
// web's existing display settings, which can still be toggled afterwards.
import { useCallback, useEffect, useState } from 'react'
import {
  VIEW_SPEC_BASES, builtinViewSpec, customViewSpec, webSettingsFromSpec,
  type BuiltinViewOverrides, type CustomView, type ViewSpec, type WebViewSettings,
} from '@/tui/viewSpec'
import type { TuiTranscriptView } from '@/tui/theme'
import { readLocalStorageValue, writeLocalStorageValue } from './constants'

export const WEB_ACTIVE_VIEW_KEY = 'agentViewer:transcriptView'

export type WebViewRef = { kind: 'builtin'; view: TuiTranscriptView } | { kind: 'custom'; id: string }

export function webViewRefKey(ref: WebViewRef): string {
  return ref.kind === 'builtin' ? `builtin:${ref.view}` : `custom:${ref.id}`
}

function parseRef(raw: string | null): WebViewRef | null {
  if (!raw) return null
  if (raw.startsWith('custom:')) return { kind: 'custom', id: raw.slice('custom:'.length) }
  if (raw.startsWith('builtin:')) {
    const view = raw.slice('builtin:'.length) as TuiTranscriptView
    return VIEW_SPEC_BASES.includes(view) ? { kind: 'builtin', view } : null
  }
  return null
}

export type WebViewLibrary = {
  views: CustomView[]
  builtins: BuiltinViewOverrides
  loaded: boolean
  error: string | null
  active: WebViewRef | null
  specFor: (ref: WebViewRef) => ViewSpec | null
  choose: (ref: WebViewRef | null) => void
  save: (next: { views?: CustomView[]; builtins?: BuiltinViewOverrides }) => Promise<boolean>
  reload: () => void
}

export function useWebViews(): WebViewLibrary {
  const [views, setViews] = useState<CustomView[]>([])
  const [builtins, setBuiltins] = useState<BuiltinViewOverrides>({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<WebViewRef | null>(null)
  const [epoch, setEpoch] = useState(0)

  useEffect(() => { setActive(parseRef(readLocalStorageValue(WEB_ACTIVE_VIEW_KEY))) }, [])
  useEffect(() => {
    let cancelled = false
    void fetch('/api/views').then(async (response) => {
      const body = await response.json() as { views?: CustomView[]; builtins?: BuiltinViewOverrides; error?: string }
      if (cancelled) return
      if (!response.ok) { setError(body.error ?? `HTTP ${response.status}`); return }
      setViews(body.views ?? [])
      setBuiltins(body.builtins ?? {})
      setError(null)
      setLoaded(true)
    }).catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [epoch])

  const specFor = useCallback((ref: WebViewRef): ViewSpec | null => {
    if (ref.kind === 'builtin') return builtinViewSpec(ref.view, builtins)
    const view = views.find((candidate) => candidate.id === ref.id)
    return view ? customViewSpec(view) : null
  }, [builtins, views])

  const choose = useCallback((ref: WebViewRef | null) => {
    setActive(ref)
    writeLocalStorageValue(WEB_ACTIVE_VIEW_KEY, ref ? webViewRefKey(ref) : '')
  }, [])

  const save = useCallback(async (next: { views?: CustomView[]; builtins?: BuiltinViewOverrides }) => {
    try {
      const response = await fetch('/api/views', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) })
      const body = await response.json() as { views?: CustomView[]; builtins?: BuiltinViewOverrides; error?: string }
      if (!response.ok) { setError(body.error ?? `HTTP ${response.status}`); return false }
      setViews(body.views ?? [])
      setBuiltins(body.builtins ?? {})
      setError(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [])

  return { views, builtins, loaded, error, active, specFor, choose, save, reload: () => setEpoch((n) => n + 1) }
}

/** The web settings a spec asks for, for the caller to apply to its own state. */
export function webSettingsFor(spec: ViewSpec): WebViewSettings {
  return webSettingsFromSpec(spec)
}
