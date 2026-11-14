'use client'
// The web View Studio: the same view records, fields and sections as the
// TUI's (tui/viewSpec.ts), so a view composed here is the same view in the
// terminal and back. The transcript behind the panel takes the draft live. A
// field the web cannot draw is still editable — it is part of the view — and
// is marked as applying in the terminal only.
import { useMemo, useState, type CSSProperties } from 'react'
import {
  BUILTIN_VIEW_SPECS, CUSTOM_VIEW_NAME_MAX, VIEW_SPEC_BASES, VIEW_SPEC_FIELDS, VIEW_SPEC_SECTIONS, WEB_VIEW_FIELDS,
  builtinDraftId, customViewSpec, newCustomViewId, viewSpecValueLabel,
  type CustomView, type ViewSpec, type ViewSpecField, type ViewSpecSection,
} from '@/tui/viewSpec'
import type { TuiTranscriptView } from '@/tui/theme'
import type { WebViewLibrary, WebViewRef } from './useWebViews'

const VIEW_LABELS: Record<TuiTranscriptView, string> = {
  conversation: 'Conversation', full: 'Full', continue: 'Continue', stream: 'Stream', agents: 'Agents', chat: 'Chat',
  transcript: 'Transcript', scrollback: 'Scrollback', codex: 'Codex', 'claude-code': 'Claude', copilot: 'Copilot',
  opencode: 'OpenCode', engineering: 'Engineering',
}

type Props = {
  library: WebViewLibrary
  /** Apply a spec to the web's display settings (the live preview, and choosing a view). */
  apply: (spec: ViewSpec) => void
  onClose: () => void
}

const sectionFields = (section: ViewSpecSection) => VIEW_SPEC_FIELDS.filter((field) => field.section === section)

function setField(draft: CustomView, field: ViewSpecField, value: ViewSpec[keyof ViewSpec]): CustomView {
  const overrides: Record<string, unknown> = { ...draft.overrides }
  if (value === BUILTIN_VIEW_SPECS[draft.base][field.key]) delete overrides[field.key]
  else overrides[field.key] = value
  return { ...draft, overrides }
}

const button = (tone: 'primary' | 'plain' | 'danger' = 'plain'): CSSProperties => ({
  padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  border: `1px solid ${tone === 'primary' ? 'var(--cyan)' : tone === 'danger' ? 'var(--red)' : 'var(--border)'}`,
  background: tone === 'primary' ? 'rgba(34,211,238,0.12)' : 'transparent',
  color: tone === 'primary' ? 'var(--cyan)' : tone === 'danger' ? 'var(--red)' : 'var(--text-2)',
})

export function WebViewStudio({ library, apply, onClose }: Props) {
  const [draft, setDraft] = useState<CustomView | null>(null)
  const [section, setSection] = useState<ViewSpecSection>('Layout')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [webOnly, setWebOnly] = useState(false)
  const active = library.active

  const rows = useMemo(() => [
    ...VIEW_SPEC_BASES.map((view) => ({ ref: { kind: 'builtin', view } as WebViewRef, label: VIEW_LABELS[view], edited: Boolean(library.builtins[view]) })),
    ...library.views.map((view) => ({ ref: { kind: 'custom', id: view.id } as WebViewRef, label: `★ ${view.name}`, edited: false })),
  ], [library.builtins, library.views])

  const isActive = (ref: WebViewRef) => active !== null && (ref.kind === 'builtin'
    ? active.kind === 'builtin' && active.view === ref.view
    : active.kind === 'custom' && active.id === ref.id)

  const choose = (ref: WebViewRef) => {
    const spec = library.specFor(ref)
    if (!spec) return
    library.choose(ref)
    apply(spec)
  }
  const edit = (ref: WebViewRef, clone: boolean) => {
    setConfirmDelete(false)
    if (ref.kind === 'builtin') {
      const overrides = { ...library.builtins[ref.view] }
      setDraft(clone
        ? { id: newCustomViewId(library.views), name: `${VIEW_LABELS[ref.view]} copy`, base: ref.view, overrides }
        : { id: builtinDraftId(ref.view), name: VIEW_LABELS[ref.view], base: ref.view, overrides, builtin: true })
    } else {
      const view = library.views.find((candidate) => candidate.id === ref.id)
      if (!view) return
      setDraft(clone
        ? { id: newCustomViewId(library.views), name: `${view.name} copy`.slice(0, CUSTOM_VIEW_NAME_MAX), base: view.base, overrides: { ...view.overrides } }
        : { ...view, overrides: { ...view.overrides } })
    }
  }
  const change = (next: CustomView) => { setDraft(next); apply(customViewSpec(next)) }
  const restoreActive = () => { const spec = active ? library.specFor(active) : null; if (spec) apply(spec) }
  const cancel = () => { setDraft(null); restoreActive() }
  const save = async () => {
    if (!draft) return
    if (draft.builtin) {
      const builtins = { ...library.builtins }
      if (Object.keys(draft.overrides).length) builtins[draft.base] = draft.overrides
      else delete builtins[draft.base]
      if (await library.save({ builtins })) { library.choose({ kind: 'builtin', view: draft.base }); setDraft(null) }
      return
    }
    const { builtin: _builtin, ...view } = draft
    const saved = { ...view, name: view.name.trim() || 'My view' }
    const views = library.views.some((candidate) => candidate.id === saved.id)
      ? library.views.map((candidate) => candidate.id === saved.id ? saved : candidate)
      : [...library.views, saved]
    if (await library.save({ views })) { library.choose({ kind: 'custom', id: saved.id }); setDraft(null) }
  }
  const remove = async () => {
    if (!draft) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    if (draft.builtin) {
      const builtins = { ...library.builtins }
      delete builtins[draft.base]
      if (await library.save({ builtins })) { setDraft(null); apply(BUILTIN_VIEW_SPECS[draft.base]) }
    } else if (await library.save({ views: library.views.filter((view) => view.id !== draft.id) })) {
      if (active?.kind === 'custom' && active.id === draft.id) { library.choose({ kind: 'builtin', view: draft.base }); apply(BUILTIN_VIEW_SPECS[draft.base]) }
      setDraft(null)
    }
    setConfirmDelete(false)
  }

  const spec = draft ? customViewSpec(draft) : null
  const base = draft ? BUILTIN_VIEW_SPECS[draft.base] : null
  const fields = sectionFields(section).filter((field) => !webOnly || WEB_VIEW_FIELDS.has(field.key))
  const changes = spec && base ? VIEW_SPEC_FIELDS.filter((field) => spec[field.key] !== base[field.key]) : []
  // A built-in can be reset only once it has edits; a custom view can be deleted once saved.
  const existing = draft && (draft.builtin ? Boolean(library.builtins[draft.base]) : library.views.some((view) => view.id === draft.id))

  return (
    <aside data-testid="web-view-studio" style={{
      position: 'fixed', top: 56, right: 16, bottom: 16, width: 400, zIndex: 80, display: 'flex', flexDirection: 'column',
      background: 'var(--surface-2)', border: '1px solid var(--cyan)', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.45)', overflow: 'hidden',
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <strong style={{ color: 'var(--cyan)', fontSize: 13, letterSpacing: 0.4 }}>VIEW STUDIO</strong>
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>shared with the terminal</span>
        <button type="button" onClick={draft ? cancel : onClose} aria-label="Close" style={{ ...button(), marginLeft: 'auto', padding: '2px 8px' }}>×</button>
      </header>
      {library.error ? <div style={{ padding: '6px 14px', color: 'var(--red)', fontSize: 12 }}>{library.error}</div> : null}

      {!draft ? (
        <div style={{ overflowY: 'auto', padding: '8px 0' }}>
          {rows.map((row) => (
            <div key={row.ref.kind === 'builtin' ? row.ref.view : row.ref.id} className="av-hover-control"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', background: isActive(row.ref) ? 'rgba(139,92,246,0.1)' : 'transparent' }}>
              <button type="button" onClick={() => choose(row.ref)} style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer', fontSize: 12, color: isActive(row.ref) ? 'var(--violet)' : 'var(--text-1)' }}>
                {row.label}{row.edited ? ' •' : ''}{isActive(row.ref) ? ' ✓' : ''}
              </button>
              {row.ref.kind === 'builtin' && row.ref.view === 'engineering' ? null : (
                <button type="button" onClick={() => edit(row.ref, false)} style={button()} title="Customise this view">edit</button>
              )}
              <button type="button" onClick={() => edit(row.ref, true)} style={button()} title="Start a new view from this one">clone</button>
            </div>
          ))}
          {!library.loaded && !library.error ? <div style={{ padding: '6px 14px', color: 'var(--text-3)', fontSize: 12 }}>Loading views…</div> : null}
        </div>
      ) : (
        <>
          <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '48px 1fr', gap: 6, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Name</span>
            {draft.builtin
              ? <span style={{ fontSize: 12, color: 'var(--text-1)' }}>{draft.name} <span style={{ color: 'var(--text-3)' }}>· built-in view</span></span>
              : <input aria-label="View name" value={draft.name} maxLength={CUSTOM_VIEW_NAME_MAX} onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  style={{ fontSize: 12, padding: '4px 6px', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-1)' }} />}
            {draft.builtin ? null : (
              <>
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Base</span>
                <select aria-label="Base view" value={draft.base} onChange={(event) => change({ ...draft, base: event.target.value as TuiTranscriptView })}
                  style={{ fontSize: 12, padding: '3px 4px', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-1)' }}>
                  {VIEW_SPEC_BASES.map((view) => <option key={view} value={view}>{VIEW_LABELS[view]}</option>)}
                </select>
              </>
            )}
          </div>
          <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
            {VIEW_SPEC_SECTIONS.map((name) => (
              <button key={name} type="button" onClick={() => setSection(name)}
                style={{ ...button(name === section ? 'primary' : 'plain'), padding: '3px 8px' }}>{name}</button>
            ))}
            <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
              <input type="checkbox" checked={webOnly} onChange={(event) => setWebOnly(event.target.checked)} /> web only
            </label>
          </nav>
          <div style={{ overflowY: 'auto', flex: 1, padding: '6px 0' }}>
            {fields.map((field) => {
              const changed = spec![field.key] !== base![field.key]
              const here = WEB_VIEW_FIELDS.has(field.key)
              return (
                <label key={field.key} title={field.help} style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 8, alignItems: 'center', padding: '4px 14px' }}>
                  <span style={{ fontSize: 12, color: here ? 'var(--text-1)' : 'var(--text-2)' }}>
                    {field.label}{changed ? <span style={{ color: 'var(--amber)' }}> •</span> : null}
                    <span style={{ marginLeft: 6, fontSize: 10, color: here ? 'var(--cyan)' : 'var(--text-3)' }}>{here ? 'web + terminal' : 'terminal'}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)' }}>{field.help}</span>
                  </span>
                  <select aria-label={field.label} value={JSON.stringify(spec![field.key])}
                    onChange={(event) => change(setField(draft, field, JSON.parse(event.target.value)))}
                    style={{ fontSize: 12, padding: '3px 4px', background: 'var(--surface-1)', border: `1px solid ${changed ? 'var(--amber)' : 'var(--border)'}`, borderRadius: 4, color: 'var(--text-1)' }}>
                    {field.options.map((option) => <option key={JSON.stringify(option.value)} value={JSON.stringify(option.value)}>{option.label}</option>)}
                    {field.options.some((option) => option.value === spec![field.key]) ? null
                      : <option value={JSON.stringify(spec![field.key])}>{viewSpecValueLabel(spec!, field.key)}</option>}
                  </select>
                </label>
              )
            })}
          </div>
          <div style={{ padding: '6px 14px', fontSize: 11, color: 'var(--text-3)', borderTop: '1px solid var(--border)' }}>
            {changes.length ? <>vs {draft.builtin ? 'defaults' : VIEW_LABELS[draft.base]}: <span style={{ color: 'var(--cyan)' }}>{changes.map((field) => `${field.label} ${viewSpecValueLabel(spec!, field.key)}`).join(' · ')}</span></>
              : draft.builtin ? `${draft.name} as it ships.` : `Same as ${VIEW_LABELS[draft.base]}.`}
          </div>
          <footer style={{ display: 'flex', gap: 6, padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
            <button type="button" onClick={() => void save()} style={button('primary')}>Save</button>
            <button type="button" onClick={() => change({ ...draft, overrides: {} })} style={button()}>Reset all</button>
            {existing ? (
              <button type="button" onClick={() => void remove()} style={button('danger')}>
                {confirmDelete ? (draft.builtin ? 'Reset to defaults?' : 'Delete?') : draft.builtin ? 'Defaults' : 'Delete'}
              </button>
            ) : null}
            <button type="button" onClick={cancel} style={{ ...button(), marginLeft: 'auto' }}>Cancel</button>
          </footer>
        </>
      )}
    </aside>
  )
}
