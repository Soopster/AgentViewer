/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import type { AgentProvider } from '../../lib/types'
import {
  applyPlaceholders,
  type PromptRecord,
  type PromptSummary,
  type SavePromptInput,
} from '../../lib/promptLibrary'

type PromptLibraryKeyEvent = { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }
type PromptLibraryMode = 'browse' | 'editor' | 'fill'
type EditorField = 'title' | 'description' | 'tags' | 'providers' | 'body'

type Draft = {
  title: string
  description: string
  tags: string
  providers: Set<AgentProvider>
  body: string
}

type Props = {
  theme: TuiThemePalette
  accentColor: string
  width: number
  height: number
  activeProvider?: AgentProvider
  loadPrompts: () => Promise<PromptSummary[]>
  loadPrompt: (slug: string) => Promise<PromptRecord | null>
  savePrompt: (input: SavePromptInput) => Promise<PromptRecord>
  deletePrompt: (slug: string) => Promise<boolean>
  onInsert: (text: string) => void
  onClose: () => void
  onNotice: (tone: 'info' | 'error', text: string) => void
  onKeyHandlerReady: (handler: (key: PromptLibraryKeyEvent) => void) => void
}

const EDITOR_FIELDS: EditorField[] = ['title', 'description', 'tags', 'providers', 'body']
const EDITOR_FIELD_LABEL: Record<EditorField, string> = {
  title: 'Title',
  description: 'Description',
  tags: 'Tags (comma-separated)',
  providers: 'Providers (1-6 toggle, blank = any)',
  body: 'Body  ({{placeholder}} tokens become fill-in fields)',
}
const PROVIDER_ORDER: AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'lmstudio']
const PROVIDER_LABEL: Record<AgentProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  copilot: 'Copilot',
  pi: 'Pi',
  lmstudio: 'LM Studio',
}

function emptyDraft(): Draft {
  return { title: '', description: '', tags: '', providers: new Set<AgentProvider>(), body: '' }
}

function truncate(value: string, width: number): string {
  if (width <= 0) return ''
  if (value.length <= width) return value
  if (width <= 1) return value.slice(0, width)
  return `${value.slice(0, width - 1)}…`
}

function isPrintable(key: PromptLibraryKeyEvent): boolean {
  return !key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= ' '
}

function isCtrlKey(key: PromptLibraryKeyEvent, char: string): boolean {
  const code = char.charCodeAt(0)
  const ctrlSequence = code >= 97 && code <= 122 ? String.fromCharCode(code - 96) : ''
  return (key.ctrl && key.name === char) || key.sequence === ctrlSequence
}

function withCursor(value: string, active: boolean): string {
  return active ? `${value}▏` : value
}

function flattenForLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function PromptLibraryPopover({
  theme,
  accentColor,
  width,
  height,
  activeProvider,
  loadPrompts,
  loadPrompt,
  savePrompt,
  deletePrompt,
  onInsert,
  onClose,
  onNotice,
  onKeyHandlerReady,
}: Props) {
  const [mode, setMode] = useState<PromptLibraryMode>('browse')
  const [prompts, setPrompts] = useState<PromptSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filterActive, setFilterActive] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [confirmDeleteSlug, setConfirmDeleteSlug] = useState<string | null>(null)
  const listScrollRef = useRef<ScrollBoxRenderable>(null)

  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [editorField, setEditorField] = useState(0)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [saving, setSaving] = useState(false)

  const [fillTarget, setFillTarget] = useState<PromptRecord | null>(null)
  const [fillIndex, setFillIndex] = useState(0)
  const [fillValues, setFillValues] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await loadPrompts()
      setPrompts(list)
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Failed to load prompt library')
    } finally {
      setLoading(false)
    }
  }, [loadPrompts, onNotice])

  useEffect(() => { void refresh() }, [refresh])

  const filtered = useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    if (!q) return prompts
    return prompts.filter((entry) => {
      const haystack = `${entry.title} ${entry.description} ${entry.tags.join(' ')} ${entry.slug}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [prompts, filterQuery])

  useEffect(() => {
    setSelectedIndex((idx) => Math.max(0, Math.min(idx, filtered.length - 1)))
  }, [filtered.length])

  const selected = filtered[selectedIndex] ?? null

  const moveSelection = useCallback((delta: number) => {
    setSelectedIndex((idx) => {
      if (filtered.length === 0) return 0
      return Math.max(0, Math.min(idx + delta, filtered.length - 1))
    })
  }, [filtered.length])

  const startCreate = useCallback(() => {
    setEditingSlug(null)
    setDraft({ ...emptyDraft(), providers: activeProvider ? new Set([activeProvider]) : new Set() })
    setEditorField(0)
    setMode('editor')
  }, [activeProvider])

  const startEdit = useCallback(async (summary: PromptSummary) => {
    try {
      const record = await loadPrompt(summary.slug)
      if (!record) { onNotice('error', `Prompt "${summary.slug}" not found`); return }
      setEditingSlug(record.meta.slug)
      setDraft({
        title: record.meta.title,
        description: record.meta.description,
        tags: record.meta.tags.join(', '),
        providers: new Set(record.meta.providers),
        body: record.body,
      })
      setEditorField(0)
      setMode('editor')
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Failed to load prompt')
    }
  }, [loadPrompt, onNotice])

  const commitEditor = useCallback(async () => {
    if (saving) return
    const title = draft.title.trim()
    if (!title) { onNotice('error', 'Prompt needs a title'); return }
    if (!draft.body.trim()) { onNotice('error', 'Prompt needs a body'); return }
    setSaving(true)
    try {
      const tags = draft.tags.split(',').map((entry) => entry.trim()).filter(Boolean)
      const record = await savePrompt({
        slug: editingSlug ?? undefined,
        title,
        description: draft.description.trim(),
        tags,
        providers: Array.from(draft.providers),
        body: draft.body,
      })
      onNotice('info', `Saved prompt "${record.meta.title}"`)
      await refresh()
      setMode('browse')
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Failed to save prompt')
    } finally {
      setSaving(false)
    }
  }, [draft, editingSlug, onNotice, refresh, savePrompt, saving])

  const performDelete = useCallback(async (slug: string) => {
    setConfirmDeleteSlug(null)
    try {
      const removed = await deletePrompt(slug)
      if (removed) {
        onNotice('info', 'Prompt deleted')
        await refresh()
      } else {
        onNotice('error', 'Prompt not found')
      }
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Failed to delete prompt')
    }
  }, [deletePrompt, onNotice, refresh])

  const beginUse = useCallback(async (summary: PromptSummary) => {
    try {
      const record = await loadPrompt(summary.slug)
      if (!record) { onNotice('error', `Prompt "${summary.slug}" not found`); return }
      if (record.placeholders.length === 0) {
        onInsert(record.body)
        onClose()
        return
      }
      setFillTarget(record)
      setFillIndex(0)
      setFillValues({})
      setMode('fill')
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Failed to load prompt')
    }
  }, [loadPrompt, onClose, onInsert, onNotice])

  const commitFill = useCallback(() => {
    if (!fillTarget) return
    const text = applyPlaceholders(fillTarget.body, fillValues)
    onInsert(text)
    onClose()
  }, [fillTarget, fillValues, onClose, onInsert])

  const handleKey = useCallback((key: PromptLibraryKeyEvent) => {
    if (mode === 'browse') {
      if (confirmDeleteSlug) {
        if (key.name === 'y' || key.name === 'return') { void performDelete(confirmDeleteSlug); return }
        if (key.name === 'n' || key.name === 'escape') { setConfirmDeleteSlug(null); return }
        return
      }
      if (filterActive) {
        if (key.name === 'escape') { setFilterActive(false); setFilterQuery(''); return }
        if (key.name === 'return' || key.name === 'tab') { setFilterActive(false); return }
        if (key.name === 'backspace' || key.name === 'delete') { setFilterQuery((q) => q.slice(0, -1)); return }
        if (key.name === 'up') { moveSelection(-1); return }
        if (key.name === 'down') { moveSelection(1); return }
        if (isPrintable(key)) { setFilterQuery((q) => q + key.sequence); return }
        return
      }
      if (key.name === 'escape' || key.name === 'q') { onClose(); return }
      if (key.name === 'up' || key.name === 'k') { moveSelection(-1); return }
      if (key.name === 'down' || key.name === 'j') { moveSelection(1); return }
      if (key.name === 'g' && !key.shift) { setSelectedIndex(0); return }
      if (key.name === 'g' && key.shift) { setSelectedIndex(Math.max(0, filtered.length - 1)); return }
      if (key.name === 'return' || key.name === 'tab') {
        if (selected) void beginUse(selected)
        return
      }
      if (key.sequence === '/') { setFilterActive(true); return }
      if (key.sequence === 'n' || key.sequence === 'N') { startCreate(); return }
      if ((key.sequence === 'e' || key.sequence === 'E') && selected) { void startEdit(selected); return }
      if ((key.sequence === 'd' || key.sequence === 'D' || key.name === 'x') && selected) {
        setConfirmDeleteSlug(selected.slug)
        return
      }
      if (key.sequence === 'r' || key.sequence === 'R') { void refresh(); return }
      return
    }

    if (mode === 'editor') {
      if (key.name === 'escape') { setMode('browse'); return }
      if (isCtrlKey(key, 's')) { void commitEditor(); return }
      const field = EDITOR_FIELDS[editorField]
      if (key.name === 'tab') {
        if (key.shift) {
          setEditorField((i) => (i - 1 + EDITOR_FIELDS.length) % EDITOR_FIELDS.length)
        } else if (field === 'body') {
          void commitEditor()
        } else {
          setEditorField((i) => (i + 1) % EDITOR_FIELDS.length)
        }
        return
      }
      if (field === 'providers') {
        const idx = '123456'.indexOf(key.sequence)
        if (idx >= 0 && idx < PROVIDER_ORDER.length) {
          const provider = PROVIDER_ORDER[idx]
          setDraft((d) => {
            const next = new Set(d.providers)
            if (next.has(provider)) next.delete(provider)
            else next.add(provider)
            return { ...d, providers: next }
          })
          return
        }
        if (key.name === 'down' || key.name === 'return') { setEditorField((i) => Math.min(i + 1, EDITOR_FIELDS.length - 1)); return }
        if (key.name === 'up') { setEditorField((i) => Math.max(i - 1, 0)); return }
        return
      }
      if (key.name === 'backspace' || key.name === 'delete') {
        setDraft((d) => ({ ...d, [field]: (d[field] as string).slice(0, -1) }))
        return
      }
      if (key.name === 'return') {
        if (field === 'body') {
          setDraft((d) => ({ ...d, body: `${d.body}\n` }))
        } else {
          setEditorField((i) => Math.min(i + 1, EDITOR_FIELDS.length - 1))
        }
        return
      }
      if (isPrintable(key)) {
        setDraft((d) => ({ ...d, [field]: (d[field] as string) + key.sequence }))
        return
      }
      return
    }

    // mode === 'fill'
    if (!fillTarget) { setMode('browse'); return }
    const placeholders = fillTarget.placeholders
    const total = placeholders.length
    if (key.name === 'escape') { setMode('browse'); setFillTarget(null); return }
    if (isCtrlKey(key, 's') || (key.ctrl && key.name === 'return')) { commitFill(); return }
    if (key.name === 'tab' && key.shift) { setFillIndex((i) => (i - 1 + total) % total); return }
    if (key.name === 'tab' || key.name === 'down') {
      if (fillIndex >= total - 1) commitFill()
      else setFillIndex((i) => Math.min(i + 1, total - 1))
      return
    }
    if (key.name === 'up') { setFillIndex((i) => Math.max(i - 1, 0)); return }
    if (key.name === 'return') {
      if (fillIndex >= total - 1) commitFill()
      else setFillIndex((i) => Math.min(i + 1, total - 1))
      return
    }
    if (key.name === 'backspace' || key.name === 'delete') {
      const name = placeholders[fillIndex]
      setFillValues((v) => ({ ...v, [name]: (v[name] ?? '').slice(0, -1) }))
      return
    }
    if (isPrintable(key)) {
      const name = placeholders[fillIndex]
      setFillValues((v) => ({ ...v, [name]: (v[name] ?? '') + key.sequence }))
      return
    }
  }, [
    beginUse, commitEditor, commitFill, confirmDeleteSlug, editorField, fillIndex, fillTarget,
    filtered.length, filterActive, mode, moveSelection, onClose, performDelete, refresh,
    selected, startCreate, startEdit,
  ])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  useEffect(() => {
    if (mode !== 'browse') return
    const id = `prompt-row-${selectedIndex}`
    const timer = setTimeout(() => { listScrollRef.current?.scrollChildIntoView(id) }, 0)
    return () => clearTimeout(timer)
  }, [mode, selectedIndex])

  const popW = Math.min(width - 4, 108)
  const popH = Math.min(height - 4, 40)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const headerH = 3
  const footerH = 2
  const bodyH = Math.max(popH - headerH - footerH - 2, 8)
  const innerW = Math.max(popW - 4, 16)

  let headerHint = ''
  if (mode === 'browse') {
    headerHint = filterActive
      ? 'type to filter · ↑↓ navigate · enter/esc apply'
      : confirmDeleteSlug
      ? `delete "${confirmDeleteSlug}"? y/enter confirm · n/esc cancel`
      : '↑↓ navigate · enter use · e edit · n new · d delete · / filter · esc close'
  } else if (mode === 'editor') {
    headerHint = saving
      ? 'saving…'
      : '⇥ next field · ⇧⇥ prev · ⌃S save · esc cancel · 1-5 toggle providers'
  } else {
    headerHint = '⇥/↓ next · ⇧⇥/↑ prev · enter fill & continue · ⌃enter insert now · esc cancel'
  }

  const renderBrowseBody = () => {
    if (loading && prompts.length === 0) {
      return (
        <box paddingX={1} paddingTop={1}>
          <text fg={theme.dim}>Loading prompt library…</text>
        </box>
      )
    }
    if (prompts.length === 0) {
      return (
        <box paddingX={1} paddingTop={1} flexDirection="column" gap={1}>
          <text fg={theme.dim}>No saved prompts yet.</text>
          <text fg={theme.dim}>Press n to create your first reusable prompt.</text>
        </box>
      )
    }
    if (filtered.length === 0) {
      return (
        <box paddingX={1} paddingTop={1}>
          <text fg={theme.dim}>{`No prompts match "${filterQuery}"`}</text>
        </box>
      )
    }
    return (
      <scrollbox
        ref={listScrollRef}
        width={popW - 2}
        height={bodyH}
        backgroundColor={theme.surface}
        scrollY
        scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
      >
        {filtered.map((entry, index) => {
          const active = index === selectedIndex
          const providerLabel = entry.providers.length > 0
            ? entry.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(' · ')
            : 'any provider'
          const tagsLabel = entry.tags.length > 0 ? entry.tags.map((t) => `#${t}`).join(' ') : ''
          const placeholderLabel = entry.placeholders.length > 0
            ? `${entry.placeholders.length} field${entry.placeholders.length === 1 ? '' : 's'} to fill`
            : null
          const metaLine = [providerLabel, tagsLabel, placeholderLabel].filter(Boolean).join('  ·  ')
          return (
            <box
              key={entry.slug}
              id={`prompt-row-${index}`}
              flexDirection="column"
              paddingX={1}
              backgroundColor={active ? theme.surface2 : undefined}
            >
              <box flexDirection="row" height={1} width={innerW}>
                <text fg={active ? accentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
                <text fg={active ? accentColor : theme.text} wrapMode="none">{truncate(entry.title, Math.max(innerW - 2, 8))}</text>
              </box>
              <box flexDirection="row" height={1} width={innerW}>
                <text fg={theme.dim} wrapMode="none">{'  '}</text>
                <text fg={theme.dim} wrapMode="none">{truncate(metaLine || 'no tags', Math.max(innerW - 2, 8))}</text>
              </box>
              <box flexDirection="row" height={1} width={innerW}>
                <text fg={theme.muted} wrapMode="none">{'  '}</text>
                <text fg={theme.muted} wrapMode="none">{truncate(entry.preview || entry.description, Math.max(innerW - 2, 8))}</text>
              </box>
            </box>
          )
        })}
      </scrollbox>
    )
  }

  const renderEditorBody = () => {
    const fieldWidth = Math.max(innerW - 2, 12)
    return (
      <box flexDirection="column" paddingX={1} paddingTop={1} gap={1} height={bodyH} width={popW - 2}>
        {EDITOR_FIELDS.map((field, index) => {
          const active = index === editorField
          const labelColor = active ? accentColor : theme.dim
          return (
            <box key={field} flexDirection="column">
              <text fg={labelColor} wrapMode="none">{`${active ? '▸ ' : '  '}${EDITOR_FIELD_LABEL[field]}`}</text>
              {field === 'providers' ? (
                <box flexDirection="row" paddingLeft={2} gap={1}>
                  {PROVIDER_ORDER.map((provider, providerIndex) => {
                    const enabled = draft.providers.has(provider)
                    return (
                      <text
                        key={provider}
                        fg={enabled ? accentColor : theme.dim}
                        wrapMode="none"
                      >
                        {`${enabled ? '◉' : '○'} ${providerIndex + 1}:${PROVIDER_LABEL[provider]}`}
                      </text>
                    )
                  })}
                </box>
              ) : field === 'body' ? (
                <box
                  paddingLeft={2}
                  paddingRight={1}
                  flexDirection="column"
                  border={['left']}
                  borderStyle="single"
                  borderColor={active ? accentColor : theme.border}
                >
                  <text fg={theme.text} wrapMode="word">
                    {withCursor(draft.body, active) || (active ? '▏' : ' ')}
                  </text>
                </box>
              ) : (
                <box paddingLeft={2}>
                  <text fg={theme.text} wrapMode="none">
                    {truncate(withCursor(draft[field] as string, active) || (active ? '▏' : ' '), fieldWidth - 2)}
                  </text>
                </box>
              )}
            </box>
          )
        })}
      </box>
    )
  }

  const renderFillBody = () => {
    if (!fillTarget) return null
    const placeholders = fillTarget.placeholders
    const preview = applyPlaceholders(fillTarget.body, fillValues)
    return (
      <box flexDirection="column" paddingX={1} paddingTop={1} gap={1} height={bodyH} width={popW - 2}>
        <text fg={theme.cyan} wrapMode="none">{`Fill in “${fillTarget.meta.title}”`}</text>
        <box flexDirection="column">
          {placeholders.map((name, index) => {
            const active = index === fillIndex
            const value = fillValues[name] ?? ''
            return (
              <box key={name} flexDirection="row" height={1}>
                <text fg={active ? accentColor : theme.dim} wrapMode="none">{`${active ? '▸ ' : '  '}{{${name}}}: `}</text>
                <text fg={theme.text} wrapMode="none">{withCursor(value, active) || (active ? '▏' : '')}</text>
              </box>
            )
          })}
        </box>
        <text fg={theme.dim} wrapMode="none">{'Preview'}</text>
        <scrollbox
          width={popW - 4}
          height={Math.max(bodyH - placeholders.length - 5, 4)}
          backgroundColor={theme.surface2}
          scrollY
          scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface2 } }}
        >
          <box paddingX={1} paddingY={1}>
            <text fg={theme.text} wrapMode="word">{flattenForLine(preview).length > 0 ? preview : ' '}</text>
          </box>
        </scrollbox>
      </box>
    )
  }

  const titleText = mode === 'browse'
    ? ` Prompt library (${filtered.length}${filtered.length !== prompts.length ? `/${prompts.length}` : ''}) `
    : mode === 'editor'
    ? ` ${editingSlug ? 'Edit prompt' : 'New prompt'} `
    : ' Insert prompt '

  return (
    <box
      position="absolute"
      top={popTop}
      left={popLeft}
      width={popW}
      height={popH}
      border
      borderStyle="single"
      borderColor={theme.border2}
      backgroundColor={theme.surface}
      zIndex={50}
      flexDirection="column"
      title={titleText}
      titleColor={theme.cyan}
      titleAlignment="left"
    >
      <box height={headerH} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="column">
        <box flexDirection="row" alignItems="center">
          <text fg={accentColor} wrapMode="none">
            {mode === 'browse' ? 'Saved prompts — usable across providers' : mode === 'editor' ? 'Markdown file under .agent-viewer-data/prompts/' : 'Tokens like {{name}} become fields below'}
          </text>
        </box>
        {filterActive ? (
          <text fg={theme.text} wrapMode="none">{`/ ${filterQuery}▏`}</text>
        ) : (
          <text fg={theme.dim} wrapMode="none">{truncate(headerHint, Math.max(popW - 4, 8))}</text>
        )}
      </box>

      {mode === 'browse' ? renderBrowseBody() : mode === 'editor' ? renderEditorBody() : renderFillBody()}

      <box height={footerH} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        <text fg={theme.dim} wrapMode="none">
          {truncate(headerHint, Math.max(popW - 4, 8))}
        </text>
      </box>
    </box>
  )
}
