'use client'

// Web entry for the Skill picker: its own chunk, loaded on first open.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import type { SkillsSnapshot } from '@/lib/plugins/skillsManager'
import { composerSkillsFromSnapshot } from '@/lib/skillPicker/list'
import { planSkillInsert } from '@/lib/skillPicker/insert'
import type { ComposerSkill } from '@/lib/skillPicker/types'
import { addSkillChip } from '../chips'
import { subscribeSkillQuery, takeSkillQuery } from '../seed'
import { SKILL_USAGE_KEY, installTarget, pickerRows, skillPreviewLines, usageScore } from '../model'

type Usage = Record<string, { n: number; last: number }>
type Mode = { kind: 'browse' } | { kind: 'choose'; skill: ComposerSkill } | { kind: 'install'; skill: ComposerSkill; summary: string; previewId?: string; targetId?: string; blocked: boolean }

function readUsage(): Usage {
  try { return JSON.parse(localStorage.getItem(SKILL_USAGE_KEY) ?? '{}') as Usage } catch { return {} }
}
function recordUse(cwd: string, name: string) {
  try {
    const usage = readUsage()
    const key = `${cwd}\n${name}`
    usage[key] = { n: (usage[key]?.n ?? 0) + 1, last: Date.now() }
    localStorage.setItem(SKILL_USAGE_KEY, JSON.stringify(usage))
  } catch { /* usage ranking is a convenience; private windows may refuse storage */ }
}

function SkillPickerView({ services, close }: WebPluginViewProps) {
  const manager = services['skills-manager']!
  const composer = services.composer
  const cwd = services.repository!.cwd
  const provider = services.session?.session?.provider ?? 'claude'
  const [snapshot, setSnapshot] = useState<SkillsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState(() => takeSkillQuery() ?? '')
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<Mode>({ kind: 'browse' })
  const [previews, setPreviews] = useState<Record<string, string[]>>({})
  const requested = useRef(new Set<string>())

  // `/skill <words>` while the picker is already open searches for those words.
  useEffect(() => subscribeSkillQuery(() => { const next = takeSkillQuery(); if (next) { setQuery(next); setIndex(0) } }), [])
  const sessionId = services.session?.session?.sessionId
  const draft = useMemo(() => composer?.readDraft?.() ?? '', [composer])
  const liveCommands = useMemo(() => composer?.liveCommands?.() ?? [], [composer])

  const load = useCallback((signal?: AbortSignal) => {
    manager.scan(cwd, signal)
      .then(value => { if (!signal?.aborted) setSnapshot(value) })
      .catch((err: unknown) => { if (!signal?.aborted) { setError(err instanceof Error ? err.message : 'Could not read skills'); setSnapshot({ roots: [], skills: [], diagnostics: [], receipts: [] }) } })
  }, [manager, cwd])
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort() }, [load])

  const skills = useMemo(() => snapshot ? composerSkillsFromSnapshot(snapshot, liveCommands, provider) : [], [snapshot, liveCommands, provider])
  const rows = useMemo(() => {
    const usage = readUsage()
    return pickerRows(skills, query, draft, skill => usageScore(usage[`${cwd}\n${skill.name}`]))
  }, [skills, query, draft, cwd])
  const selectable = rows.flatMap(row => row.kind === 'skill' ? [row.skill] : [])
  const cursor = Math.min(index, Math.max(selectable.length - 1, 0))
  const selected = selectable[cursor]

  useEffect(() => {
    if (!selected?.skillId || requested.current.has(selected.key)) return
    requested.current.add(selected.key)
    manager.file(cwd, selected.skillId, 'SKILL.md')
      .then(file => setPreviews(current => ({ ...current, [selected.key]: file.binary ? ['(binary file)'] : skillPreviewLines(file.text) })))
      .catch(() => setPreviews(current => ({ ...current, [selected.key]: ['(could not read SKILL.md)'] })))
  }, [selected, manager, cwd])

  const finish = (skill: ComposerSkill, run: () => void) => { recordUse(cwd, skill.name); run(); close() }
  const choose = (skill: ComposerSkill) => {
    const plan = planSkillInsert(skill, provider)
    if (plan.kind === 'native') finish(skill, () => { composer?.insertText?.(plan.text); if (sessionId) addSkillChip(sessionId, skill.name, plan.text) })
    else setMode({ kind: 'choose', skill })
  }
  const attach = (skill: ComposerSkill) => {
    const plan = planSkillInsert(skill, provider)
    if (plan.kind === 'unavailable' && plan.attach && composer?.attachContext) finish(skill, () => composer.attachContext!(plan.attach!))
    else setError('This skill cannot be attached here')
  }
  const previewInstall = async (skill: ComposerSkill) => {
    const target = snapshot ? installTarget(snapshot, provider) : null
    if (!skill.skillId || !target) { setMode({ kind: 'install', skill, summary: `No writable ${provider} skills folder to install into`, blocked: true }); return }
    try {
      const preview = await manager.preview(cwd, { sourceId: skill.skillId, targetIds: [target.id] })
      const result = preview.targets[0]
      const blocked = !result || result.status !== 'add'
      const summary = !result ? 'Nothing to install'
        : result.status === 'add' ? `Install ${result.files.length} file(s) into ${target.label}`
        : result.status === 'same' ? `Already installed in ${target.label}`
        : result.reason ?? `Cannot install: ${result.status}`
      setMode({ kind: 'install', skill, summary, previewId: preview.id, targetId: target.id, blocked })
    } catch (err) { setMode({ kind: 'install', skill, summary: err instanceof Error ? err.message : 'Preview failed', blocked: true }) }
  }
  const applyInstall = async (state: Extract<Mode, { kind: 'install' }>) => {
    if (state.blocked || !state.previewId || !state.targetId || !state.skill.skillId) return
    try {
      const receipt = await manager.apply(cwd, { sourceId: state.skill.skillId, targetIds: [state.targetId], previewId: state.previewId, replaceIds: [], requestId: crypto.randomUUID() })
      if (receipt.status !== 'applied') setError(receipt.error ?? `Install ${receipt.status}`); else load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Install failed') }
    setMode({ kind: 'browse' })
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); if (mode.kind !== 'browse') setMode({ kind: 'browse' }); else if (query) setQuery(''); else close() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(Math.min(cursor + 1, selectable.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(Math.max(cursor - 1, 0)) }
    else if (event.key === 'Enter' && selected && mode.kind === 'browse') { event.preventDefault(); choose(selected) }
  }

  const preview = selected ? (previews[selected.key] ?? (selected.skillId ? ['loading…'] : [selected.description])) : []
  return (
    <div className="flex h-full flex-col gap-2 p-3 text-sm" onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">✦ Skills <span className="font-normal text-muted-foreground">· {provider} · {snapshot ? `${skills.length} found` : 'loading…'}</span></h2>
        <button type="button" onClick={close} className="text-muted-foreground hover:text-foreground">Close</button>
      </div>
      <input autoFocus value={query} onChange={event => { setQuery(event.target.value); setIndex(0) }} placeholder="Search skills" aria-label="Search skills" className="rounded border border-border bg-background px-2 py-1" />
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-3">
        <ul className="min-h-0 overflow-auto" role="listbox" aria-label="Skills">
          {snapshot && rows.length === 0 ? <li className="text-muted-foreground">{query ? 'No skill matches that.' : 'No skills installed.'}</li> : null}
          {rows.map(row => row.kind === 'header'
            ? <li key={`h-${row.label}`} className="mt-2 text-xs font-medium text-muted-foreground">{row.label}</li>
            : (
              <li key={row.skill.key} role="option" aria-selected={row.skill === selected}>
                <button type="button" onClick={() => { setIndex(selectable.indexOf(row.skill)); choose(row.skill) }} onMouseEnter={() => setIndex(selectable.indexOf(row.skill))}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${row.skill === selected ? 'bg-muted' : ''}`}>
                  <span title={row.skill.nativeForProvider ? `${provider} loads this` : `${provider} does not load this`} className={row.skill.nativeForProvider ? 'text-green-600' : 'text-muted-foreground'}>{row.skill.nativeForProvider ? '●' : '○'}</span>
                  <span className="truncate">{row.skill.name}</span>
                </button>
              </li>
            ))}
        </ul>
        <div className="min-h-0 overflow-auto rounded border border-border p-2">
          {selected ? (
            <>
              <div className="font-medium">{selected.name}</div>
              <div className="text-xs text-muted-foreground">{selected.source} · loaded by {selected.loadedBy.join(', ') || '—'}{selected.nativeForProvider ? '' : ` · not ${provider}`}</div>
              <p className="mt-1">{selected.description}</p>
              {selected.files.length ? <p className="text-xs text-muted-foreground">{selected.files.length} file(s): {selected.files.slice(0, 4).join(', ')}</p> : null}
              <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{preview.slice(0, 40).join('\n')}</pre>
            </>
          ) : null}
        </div>
      </div>
      {mode.kind === 'choose' ? (
        <div className="flex items-center gap-3 rounded border border-border p-2">
          <span>{provider} does not load “{mode.skill.name}”.</span>
          <button type="button" onClick={() => attach(mode.skill)}>Attach SKILL.md</button>
          <button type="button" onClick={() => void previewInstall(mode.skill)}>Install for {provider}</button>
          <button type="button" onClick={() => setMode({ kind: 'browse' })}>Cancel</button>
        </div>
      ) : null}
      {mode.kind === 'install' ? (
        <div className="flex items-center gap-3 rounded border border-border p-2">
          <span>{mode.summary}</span>
          {mode.blocked ? null : <button type="button" onClick={() => void applyInstall(mode)}>Install</button>}
          <button type="button" onClick={() => setMode({ kind: 'choose', skill: mode.skill })}>Back</button>
        </div>
      ) : null}
    </div>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'skill-picker',
  views: { 'skill-picker': SkillPickerView },
}
