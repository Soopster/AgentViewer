'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { AgentProvider } from '@/lib/types'

export type PromptSummary = {
  slug: string
  title: string
  description: string
  tags: string[]
  providers: AgentProvider[]
  createdAt: string
  updatedAt: string
  preview: string
  placeholders: string[]
}

type PromptRecord = {
  meta: Omit<PromptSummary, 'preview' | 'placeholders'>
  body: string
  placeholders: string[]
}

export type PromptLibraryAccent = { cssVar: string; cssRgb: string; label: string }

type Mode = 'browse' | 'editor' | 'fill'

type Draft = {
  slug?: string
  title: string
  description: string
  tags: string
  providers: AgentProvider[]
  body: string
}

const EMPTY_DRAFT: Draft = { title: '', description: '', tags: '', providers: [], body: '' }

const PROVIDER_OPTIONS: { value: AgentProvider; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'copilot', label: 'Copilot' },
  { value: 'pi', label: 'Pi' },
]

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z][\w.-]*)\s*\}\}/g

function applyPlaceholders(body: string, values: Record<string, string>): string {
  return body.replace(PLACEHOLDER_PATTERN, (full, name: string) => {
    const value = values[name]
    return value && value.length > 0 ? value : full
  })
}

function draftFromRecord(meta: PromptSummary, body: string): Draft {
  return {
    slug: meta.slug,
    title: meta.title,
    description: meta.description,
    tags: meta.tags.join(', '),
    providers: meta.providers,
    body,
  }
}

function matchesQuery(prompt: PromptSummary, query: string): boolean {
  if (!query) return true
  const haystack = `${prompt.title} ${prompt.description} ${prompt.tags.join(' ')} ${prompt.slug}`.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term))
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 6px)',
  left: 0,
  width: 440,
  maxWidth: 'calc(100vw - 96px)',
  maxHeight: 480,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 18px 40px rgba(0,0,0,0.34)',
  zIndex: 40,
  overflow: 'hidden',
  fontFamily: "'IBM Plex Sans', sans-serif",
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 10px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--surface-2)',
  flexShrink: 0,
}

const fieldLabelStyle: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 9,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
  marginBottom: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-2)',
  border: '1px solid var(--border-2)',
  borderRadius: 5,
  padding: '6px 8px',
  fontFamily: "'IBM Plex Sans', sans-serif",
  fontSize: 12,
  color: 'var(--text)',
  outline: 'none',
}

const iconButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 5,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--text-2)',
  cursor: 'pointer',
}

export default function PromptLibrary({
  accent,
  activeProvider,
  onInsert,
  onClose,
}: {
  accent: PromptLibraryAccent
  activeProvider?: AgentProvider
  onInsert: (text: string) => void
  onClose: () => void
}) {
  const [prompts, setPrompts] = useState<PromptSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [mode, setMode] = useState<Mode>('browse')
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmDeleteSlug, setConfirmDeleteSlug] = useState<string | null>(null)
  const [pendingInsert, setPendingInsert] = useState<{ body: string; placeholders: string[] } | null>(null)
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({})

  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const accentColor = `var(${accent.cssVar})`
  const accentBg = `rgba(${accent.cssRgb},0.16)`

  const load = useCallback(() => {
    const controller = new AbortController()
    setLoadError(null)
    fetch('/api/prompts', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => { if (!controller.signal.aborted) setPrompts(Array.isArray(data?.prompts) ? data.prompts : []) })
      .catch((err) => { if (!controller.signal.aborted) setLoadError(err instanceof Error ? err.message : 'Failed to load prompts') })
    return () => controller.abort()
  }, [])

  useEffect(() => load(), [load])

  // Close on outside click / Escape (when not mid-edit, where Escape steps back instead).
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null
      if (rootRef.current?.contains(target)) return
      if (target?.closest('[data-prompt-library-trigger]')) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [onClose])

  useEffect(() => {
    if (mode === 'browse') searchRef.current?.focus()
  }, [mode])

  const filtered = useMemo(() => {
    const list = prompts ?? []
    const matches = list.filter((p) => matchesQuery(p, query))
    if (!activeProvider) return matches
    return [...matches].sort((a, b) => {
      const aFits = a.providers.length === 0 || a.providers.includes(activeProvider) ? 0 : 1
      const bFits = b.providers.length === 0 || b.providers.includes(activeProvider) ? 0 : 1
      return aFits - bFits
    })
  }, [prompts, query, activeProvider])

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(filtered.length - 1, 0)))
  }, [filtered.length])

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const beginInsert = useCallback(async (summary: PromptSummary) => {
    try {
      const res = await fetch(`/api/prompts/${summary.slug}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { prompt?: PromptRecord }
      const body = data.prompt?.body ?? ''
      const placeholders = data.prompt?.placeholders ?? summary.placeholders
      if (placeholders.length > 0) {
        setPendingInsert({ body, placeholders })
        setPlaceholderValues(Object.fromEntries(placeholders.map((name) => [name, ''])))
        setMode('fill')
      } else {
        onInsert(body)
        onClose()
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load prompt')
    }
  }, [onInsert, onClose])

  const finishInsert = useCallback(() => {
    if (!pendingInsert) return
    onInsert(applyPlaceholders(pendingInsert.body, placeholderValues))
    onClose()
  }, [pendingInsert, placeholderValues, onInsert, onClose])

  const openCreate = useCallback(() => {
    setDraft(EMPTY_DRAFT)
    setFormError(null)
    setMode('editor')
  }, [])

  const openEdit = useCallback(async (summary: PromptSummary) => {
    try {
      const res = await fetch(`/api/prompts/${summary.slug}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { prompt?: PromptRecord }
      const body = data.prompt?.body ?? summary.preview
      setDraft(draftFromRecord(summary, body))
      setFormError(null)
      setMode('editor')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load prompt')
    }
  }, [])

  const saveDraft = useCallback(async () => {
    const title = draft.title.trim()
    const body = draft.body.trim()
    if (!title || !body) {
      setFormError('Title and prompt body are required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        title,
        description: draft.description.trim(),
        tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
        providers: draft.providers,
        body,
      }
      const url = draft.slug ? `/api/prompts/${draft.slug}` : '/api/prompts'
      const method = draft.slug ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(data?.error ?? `HTTP ${res.status}`)
      }
      setMode('browse')
      load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save prompt')
    } finally {
      setSaving(false)
    }
  }, [draft, load])

  const confirmDelete = useCallback(async (slug: string) => {
    try {
      const res = await fetch(`/api/prompts/${slug}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setConfirmDeleteSlug(null)
      setPrompts((prev) => (prev ? prev.filter((p) => p.slug !== slug) : prev))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to delete prompt')
    }
  }, [])

  const toggleProvider = useCallback((value: AgentProvider) => {
    setDraft((prev) => ({
      ...prev,
      providers: prev.providers.includes(value)
        ? prev.providers.filter((p) => p !== value)
        : [...prev.providers, value],
    }))
  }, [])

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (mode === 'browse') {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const entry = filtered[activeIndex]
        if (entry) void beginInsert(entry)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    } else if (mode === 'fill') {
      if (event.key === 'Escape') {
        event.preventDefault()
        setPendingInsert(null)
        setMode('browse')
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        finishInsert()
      }
    } else if (mode === 'editor') {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMode('browse')
      }
    }
  }, [mode, filtered, activeIndex, beginInsert, onClose, finishInsert])

  return (
    <div ref={rootRef} style={panelStyle} role="dialog" aria-label="Prompt library" onKeyDown={onKeyDown}>
      <div style={headerStyle}>
        {mode !== 'browse' ? (
          <button
            type="button"
            className="av-hover-control"
            onClick={() => { setMode('browse'); setPendingInsert(null); setFormError(null) }}
            style={iconButtonStyle}
            title="Back to library"
          >
            <ChevronLeft size={14} />
          </button>
        ) : (
          <Search size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        )}
        {mode === 'browse' && (
          <label style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-3)' }}>
            Search
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
              placeholder="Search prompts by title, tag, description…"
              style={{ ...inputStyle, flex: 1, border: 'none', background: 'transparent', padding: '4px 0' }}
            />
          </label>
        )}
        {mode === 'editor' && (
          <span style={{ fontSize: 11, color: 'var(--text-2)', letterSpacing: '0.04em' }}>
            {draft.slug ? 'Edit prompt' : 'New prompt'}
          </span>
        )}
        {mode === 'fill' && (
          <span style={{ fontSize: 11, color: 'var(--text-2)', letterSpacing: '0.04em' }}>
            Fill in placeholders
          </span>
        )}
        <div style={{ flex: 1 }} />
        {mode === 'browse' && (
          <button type="button" className="av-hover-control" onClick={openCreate} style={{ ...iconButtonStyle, color: accentColor }} title="New prompt">
            <Plus size={15} />
          </button>
        )}
        <button type="button" className="av-hover-control" onClick={onClose} style={iconButtonStyle} title="Close (esc)">
          <X size={14} />
        </button>
      </div>

      {mode === 'browse' && (
        <div style={{ overflowY: 'auto', padding: 4 }}>
          <div style={{
            padding: '4px 8px 6px',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 9,
            color: accentColor,
            letterSpacing: '0.06em',
          }}>
            {accent.label} prompt library · ↑↓ select · ⏎ insert · esc close
          </div>
          {loadError && (
            <div style={{ padding: '6px 8px', fontSize: 11, color: 'rgba(248,113,113,0.85)' }}>{loadError}</div>
          )}
          {prompts === null && !loadError && (
            <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--text-3)' }}>Loading…</div>
          )}
          {prompts !== null && filtered.length === 0 && (
            <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
              {prompts.length === 0 ? 'No prompts yet — create one to get started.' : 'No prompts match your search.'}
            </div>
          )}
          {filtered.map((prompt, index) => {
            const active = index === activeIndex
            const fits = prompt.providers.length === 0 || (activeProvider ? prompt.providers.includes(activeProvider) : true)
            return (
              <div
                key={prompt.slug}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 6,
                  borderRadius: 6,
                  background: active ? accentBg : 'transparent',
                  padding: '2px 2px 2px 0',
                }}
              >
                <button
                  type="button"
                  className="av-hover-control"
                  ref={(node) => { itemRefs.current[index] = node }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => { event.preventDefault(); void beginInsert(prompt) }}
                  style={{
                    ...iconButtonStyle,
                    width: 'auto',
                    flex: 1,
                    height: 'auto',
                    minHeight: 0,
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    textAlign: 'left',
                    padding: '5px 8px',
                    color: 'var(--text)',
                    opacity: fits ? 1 : 0.55,
                  }}
                  title="Insert into composer"
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, width: '100%' }}>
                    <span style={{ fontWeight: active ? 600 : 500, color: active ? accentColor : 'var(--text)', fontSize: 12 }}>
                      {prompt.title}
                    </span>
                    {prompt.placeholders.length > 0 && (
                      <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                        {prompt.placeholders.length} placeholder{prompt.placeholders.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                    {prompt.description || prompt.preview}
                  </div>
                  {prompt.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                      {prompt.tags.map((tag) => (
                        <span key={tag} style={{
                          fontSize: 9,
                          padding: '1px 6px',
                          borderRadius: 999,
                          border: '1px solid var(--border)',
                          color: 'var(--text-3)',
                          fontFamily: "'IBM Plex Mono', monospace",
                        }}>{tag}</span>
                      ))}
                    </div>
                  )}
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4, paddingRight: 4 }}>
                  <button type="button" className="av-hover-control" onClick={() => void openEdit(prompt)} style={iconButtonStyle} title="Edit prompt">
                    <Pencil size={12} />
                  </button>
                  {confirmDeleteSlug === prompt.slug ? (
                    <button
                      type="button"
                      className="av-hover-control"
                      onClick={() => void confirmDelete(prompt.slug)}
                      style={{ ...iconButtonStyle, color: 'rgba(248,113,113,0.9)', borderColor: 'rgba(248,113,113,0.4)' }}
                      title="Confirm delete"
                    >
                      <Check size={12} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="av-hover-control"
                      onClick={() => setConfirmDeleteSlug(prompt.slug)}
                      onBlur={() => setConfirmDeleteSlug((s) => (s === prompt.slug ? null : s))}
                      style={iconButtonStyle}
                      title="Delete prompt"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {mode === 'editor' && (
        <div style={{ overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label>
            <div style={fieldLabelStyle}>Title</div>
            <input
              value={draft.title}
              onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="e.g. Summarise the diff"
              style={inputStyle}
              autoFocus
            />
          </label>
          <label>
            <div style={fieldLabelStyle}>Description</div>
            <input
              value={draft.description}
              onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="One line shown in the library list"
              style={inputStyle}
            />
          </label>
          <label>
            <div style={fieldLabelStyle}>Tags (comma separated)</div>
            <input
              value={draft.tags}
              onChange={(e) => setDraft((prev) => ({ ...prev, tags: e.target.value }))}
              placeholder="review, testing"
              style={inputStyle}
            />
          </label>
          <div>
            <div style={fieldLabelStyle}>Providers (blank = any)</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {PROVIDER_OPTIONS.map((opt) => {
                const selected = draft.providers.includes(opt.value)
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className="av-hover-control"
                    onClick={() => toggleProvider(opt.value)}
                    style={{
                      fontSize: 10.5,
                      padding: '4px 9px',
                      borderRadius: 999,
                      border: `1px solid ${selected ? accentColor : 'var(--border-2)'}`,
                      background: selected ? accentBg : 'transparent',
                      color: selected ? accentColor : 'var(--text-2)',
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
          <label>
            <div style={fieldLabelStyle}>Prompt body · use {'{{name}}'} for fill-in placeholders</div>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft((prev) => ({ ...prev, body: e.target.value }))}
              placeholder={'Summarise the diff in {{target}}, focusing on {{focus}}…'}
              rows={8}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1.5 }}
            />
          </label>
          {formError && <div style={{ fontSize: 11, color: 'rgba(248,113,113,0.85)' }}>{formError}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="av-hover-control"
              onClick={() => setMode('browse')}
              style={{ ...inputStyle, width: 'auto', cursor: 'pointer', color: 'var(--text-2)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="av-hover-control"
              onClick={() => void saveDraft()}
              disabled={saving}
              style={{
                ...inputStyle,
                width: 'auto',
                cursor: saving ? 'default' : 'pointer',
                background: accentColor,
                borderColor: accentColor,
                color: 'var(--surface)',
                fontWeight: 600,
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : draft.slug ? 'Save changes' : 'Create prompt'}
            </button>
          </div>
        </div>
      )}

      {mode === 'fill' && pendingInsert && (
        <div style={{ overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
            Fill in any placeholders before inserting — leave blank to keep the <code>{'{{name}}'}</code> token for later.
          </div>
          {pendingInsert.placeholders.map((name, index) => (
            <div key={name}>
              <div style={fieldLabelStyle}>{name}</div>
              <input
                value={placeholderValues[name] ?? ''}
                onChange={(e) => setPlaceholderValues((prev) => ({ ...prev, [name]: e.target.value }))}
                style={inputStyle}
                autoFocus={index === 0}
              />
            </div>
          ))}
          <div style={{
            fontSize: 10.5,
            color: 'var(--text-3)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 8px',
            maxHeight: 96,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            fontFamily: "'IBM Plex Mono', monospace",
          }}>
            {applyPlaceholders(pendingInsert.body, placeholderValues)}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="av-hover-control"
              onClick={() => { setPendingInsert(null); setMode('browse') }}
              style={{ ...inputStyle, width: 'auto', cursor: 'pointer', color: 'var(--text-2)' }}
            >
              Back
            </button>
            <button
              type="button"
              className="av-hover-control"
              onClick={finishInsert}
              style={{
                ...inputStyle,
                width: 'auto',
                cursor: 'pointer',
                background: accentColor,
                borderColor: accentColor,
                color: 'var(--surface)',
                fontWeight: 600,
              }}
            >
              Insert into composer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
