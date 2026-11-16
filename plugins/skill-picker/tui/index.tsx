/** @jsxImportSource @opentui/react */
// TUI entry for the Skill picker: loaded on first open, never at boot.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { SkillsSnapshot } from '../../../lib/plugins/skillsManager'
import { composerSkillsFromSnapshot } from '../../../lib/skillPicker/list'
import { planSkillInsert } from '../../../lib/skillPicker/insert'
import type { ComposerSkill } from '../../../lib/skillPicker/types'
import { frecencyKey, readFrecencyScores, recordFrecencyUse } from '../../../lib/tuiFrecency'
import { fitText, type TuiPluginView, type TuiPluginViewProps, type TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import { installTarget, pickerRows, skillPreviewLines, selectedSkillPreview } from '../model'
import { addSkillChip } from '../chips'
import { subscribeSkillQuery, takeSkillQuery } from '../seed'

type Mode = { kind: 'browse' } | { kind: 'choose'; skill: ComposerSkill } | { kind: 'install'; skill: ComposerSkill; summary: string; previewId?: string; targetId?: string; blocked: boolean }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function pickerDimensions(width: number, height: number, placement: TuiPluginViewProps['placement']) {
  const docked = placement !== 'overlay'
  const totalW = docked ? width : Math.min(width - 6, 124)
  const totalH = docked ? height : Math.min(height - 4, 34)
  const leftW = Math.floor((totalW - 4) * 0.46)
  return { docked, totalW, totalH, leftW, rightW: totalW - 4 - leftW - 1, listRows: Math.max(totalH - 7, 3) }
}

function SkillPreview({ skill, lines, provider, theme, width, rows }: {
  skill: ComposerSkill | undefined; lines: string[]; provider: string; theme: TuiThemePalette; width: number; rows: number
}) {
  if (!skill) return null
  return (
    <>
      <text fg={theme.text}>{fitText(skill.name, width)}</text>
      <text fg={theme.dim}>{fitText(`${skill.source} · loaded by ${skill.loadedBy.join(', ') || '—'}${skill.nativeForProvider ? '' : ` · not ${provider}`}`, width)}</text>
      <text fg={theme.muted}>{fitText(skill.description, width)}</text>
      <text fg={theme.dim}>{fitText(skill.files.length ? `${skill.files.length} file(s): ${skill.files.slice(0, 3).join(', ')}` : '', width)}</text>
      {lines.slice(0, Math.max(rows - 4, 1)).map((line, i) => <text key={i} fg={theme.dim}>{fitText(line, width)}</text>)}
    </>
  )
}

function SkillPickerFooter({ mode, provider, theme, width }: { mode: Mode; provider: string; theme: TuiThemePalette; width: number }) {
  const footer = mode.kind === 'choose' ? `${provider} does not load "${mode.skill.name}" · a attach SKILL.md · i install for ${provider} · esc back`
    : mode.kind === 'install' ? `${mode.summary}${mode.blocked ? '' : ' · y install'} · esc back`
    : 'type to search · ↑/↓ or ⌃N/⌃P move · enter add · esc clear/close'
  return (
    <box paddingX={1} backgroundColor={theme.surface2}>
      <text fg={mode.kind === 'browse' ? theme.dim : theme.amber}>{fitText(footer, width - 4)}</text>
    </box>
  )
}

function SkillPickerSurface({ services, theme, width, height, placement, zIndex, registerKeys, close }: TuiPluginViewProps) {
  const manager = services['skills-manager']!
  const composer = services.composer
  const cwd = services.repository!.cwd
  const provider = services.session?.session?.provider ?? 'claude'
  const [snapshot, setSnapshot] = useState<SkillsSnapshot | null>(null)
  const [query, setQuery] = useState(() => takeSkillQuery() ?? '')
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<Mode>({ kind: 'browse' })
  const [previews, setPreviews] = useState<Record<string, string[]>>({})
  const requested = useRef(new Set<string>())
  const draft = useMemo(() => composer?.readDraft?.() ?? '', [composer])

  // `/skill <words>` while the picker is already open searches for those words.
  useEffect(() => subscribeSkillQuery(() => { const next = takeSkillQuery(); if (next) { setQuery(next); setIndex(0) } }), [])
  const sessionId = services.session?.session?.sessionId
  const [liveCommands, setLiveCommands] = useState(() => composer?.liveCommands?.() ?? [])
  useEffect(() => { setLiveCommands(composer?.liveCommands?.() ?? []) }, [composer, snapshot])

  const load = useCallback((signal?: AbortSignal) => {
    manager.scan(cwd, signal)
      .then(value => { if (!signal?.aborted) setSnapshot(value) })
      .catch((err: unknown) => { if (!signal?.aborted) { services.notices?.show('error', err instanceof Error ? err.message : 'Could not read skills'); setSnapshot({ roots: [], skills: [], diagnostics: [], receipts: [] }) } })
  }, [manager, cwd, services.notices])
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort() }, [load])

  const skills = useMemo(() => snapshot ? composerSkillsFromSnapshot(snapshot, liveCommands, provider) : [], [snapshot, liveCommands, provider])
  const rows = useMemo(() => {
    const scores = readFrecencyScores()
    return pickerRows(skills, query, draft, skill => scores.get(frecencyKey(cwd, `skill:${skill.name}`)) ?? 0)
  }, [skills, query, draft, cwd])
  const selectable = useMemo(() => rows.flatMap((row, at) => row.kind === 'skill' ? [at] : []), [rows])
  const cursor = clamp(index, 0, Math.max(selectable.length - 1, 0))
  const selectedRow = rows[selectable[cursor] ?? -1]
  const selected = selectedRow?.kind === 'skill' ? selectedRow.skill : undefined

  // Preview the highlighted skill's SKILL.md, once each.
  useEffect(() => {
    if (!selected?.skillId || requested.current.has(selected.key)) return
    requested.current.add(selected.key)
    const controller = new AbortController()
    manager.file(cwd, selected.skillId, 'SKILL.md', controller.signal)
      .then(file => setPreviews(current => ({ ...current, [selected.key]: file.binary ? ['(binary file)'] : skillPreviewLines(file.text) })))
      .catch(() => setPreviews(current => ({ ...current, [selected.key]: ['(could not read SKILL.md)'] })))
    return () => controller.abort()
  }, [selected, manager, cwd])

  const use = useCallback((skill: ComposerSkill, text: string, notice: string) => {
    recordFrecencyUse(frecencyKey(cwd, `skill:${skill.name}`))
    composer?.insertText?.(text, notice)
    if (sessionId) addSkillChip(sessionId, skill.name, text)
    close()
  }, [composer, cwd, close, sessionId])

  const choose = useCallback(() => {
    if (!selected) return
    const plan = planSkillInsert(selected, provider)
    if (plan.kind === 'native') { use(selected, plan.text, `Added ${plan.text.trim()}`); return }
    setMode({ kind: 'choose', skill: selected })
  }, [selected, provider, use])

  const previewInstall = useCallback(async (skill: ComposerSkill) => {
    const target = snapshot ? installTarget(snapshot, provider) : null
    if (!skill.skillId || !target) { setMode({ kind: 'install', skill, summary: `No writable ${provider} skills folder to install into`, blocked: true }); return }
    try {
      const preview = await manager.preview(cwd, { sourceId: skill.skillId, targetIds: [target.id] })
      const result = preview.targets[0]
      const blocked = !result || result.status !== 'add'
      const summary = !result ? 'Nothing to install'
        : result.status === 'add' ? `Install ${result.files.length} file(s) into ${target.label} (${result.path})`
        : result.status === 'same' ? `Already installed in ${target.label}`
        : result.reason ?? `Cannot install: ${result.status}`
      setMode({ kind: 'install', skill, summary, previewId: preview.id, targetId: target.id, blocked })
    } catch (err) {
      setMode({ kind: 'install', skill, summary: err instanceof Error ? err.message : 'Preview failed', blocked: true })
    }
  }, [snapshot, provider, manager, cwd])

  const applyInstall = useCallback(async (state: Extract<Mode, { kind: 'install' }>) => {
    if (state.blocked || !state.previewId || !state.targetId || !state.skill.skillId) return
    try {
      const receipt = await manager.apply(cwd, { sourceId: state.skill.skillId, targetIds: [state.targetId], previewId: state.previewId, replaceIds: [], requestId: crypto.randomUUID() })
      if (receipt.status === 'applied') { services.notices?.show('info', `Installed ${state.skill.name} for ${provider}`); load() } else services.notices?.show('error', receipt.error ?? `Install ${receipt.status}`)
    } catch (err) {
      services.notices?.show('error', err instanceof Error ? err.message : 'Install failed')
    }
    setMode({ kind: 'browse' })
  }, [manager, cwd, provider, services.notices, load])

  useEffect(() => {
    registerKeys((key) => {
      if (mode.kind === 'choose') {
        if (key.name === 'escape') { setMode({ kind: 'browse' }); return true }
        if (key.sequence === 'a') {
          const plan = planSkillInsert(mode.skill, provider)
          if (plan.kind === 'unavailable' && plan.attach?.path) use(mode.skill, `@${plan.attach.path} `, `Attached ${mode.skill.name}`)
          else services.notices?.show('error', 'This skill has no file to attach')
          return true
        }
        if (key.sequence === 'i') { void previewInstall(mode.skill); return true }
        return true
      }
      if (mode.kind === 'install') {
        if (key.name === 'escape') { setMode({ kind: 'choose', skill: mode.skill }); return true }
        if (key.sequence === 'y') { void applyInstall(mode); return true }
        return true
      }
      if (key.name === 'escape') { if (query) { setQuery(''); setIndex(0) } else close(); return true }
      if (key.ctrl && key.name === 'c') { close(); return true }
      if (key.name === 'down' || (key.ctrl && (key.name === 'n' || key.name === 'j'))) { setIndex(i => Math.min(i + 1, Math.max(selectable.length - 1, 0))); return true }
      if (key.name === 'up' || (key.ctrl && (key.name === 'p' || key.name === 'k'))) { setIndex(i => Math.max(i - 1, 0)); return true }
      if (key.name === 'return') { choose(); return true }
      if (key.name === 'backspace') { setQuery(q => q.slice(0, -1)); setIndex(0); return true }
      if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1 && key.sequence >= ' ') { setQuery(q => q + key.sequence); setIndex(0); return true }
      return true
    })
    return () => registerKeys(null)
  }, [registerKeys, mode, query, selectable.length, choose, close, provider, services.notices, use, previewInstall, applyInstall])

  const { docked, totalW, totalH, leftW, rightW, listRows } = pickerDimensions(width, height, placement)
  const selectedAt = selectable[cursor] ?? 0
  const top = clamp(selectedAt - Math.floor(listRows / 2), 0, Math.max(rows.length - listRows, 0))
  const visible = rows.slice(top, top + listRows)
  const preview = selectedSkillPreview(selected, previews)
  return (
    <box
      {...(docked
        ? { width, height }
        : { position: 'absolute' as const, top: 2, left: Math.max(Math.floor((width - totalW) / 2), 2), width: totalW, height: totalH, zIndex, border: true, borderStyle: 'single' as const, borderColor: theme.cyan })}
      backgroundColor={theme.surface}
      flexDirection="column"
    >
      <box paddingX={1} backgroundColor={theme.surface2}>
        <text fg={theme.cyan}>{fitText(`✦ SKILLS · ${provider} · ${snapshot ? `${skills.length} found` : 'loading…'}`, totalW - 4)}</text>
      </box>
      <box paddingX={1}>
        <text fg={theme.text}>{fitText(`› ${query}▏`, totalW - 4)}</text>
      </box>
      <box flexDirection="row" paddingX={1} flexGrow={1}>
        <box width={leftW} flexDirection="column">
          {snapshot && rows.length === 0 ? <text fg={theme.dim}>{fitText(query ? 'No skill matches that.' : 'No skills installed.', leftW)}</text> : null}
          {visible.map((row, i) => {
            if (row.kind === 'header') return <text key={`h${row.label}${top + i}`} fg={theme.amber}>{fitText(row.label, leftW)}</text>
            const on = row === selectedRow
            const tag = row.skill.nativeForProvider ? '●' : '○'
            return (
              <box key={row.skill.key} backgroundColor={on ? theme.surface3 : theme.surface} flexDirection="row">
                <text fg={row.skill.nativeForProvider ? theme.green : theme.dim} wrapMode="none">{`${on ? '›' : ' '}${tag} `}</text>
                <text fg={on ? theme.text : theme.muted} wrapMode="none">{fitText(row.skill.name, leftW - 4)}</text>
              </box>
            )
          })}
        </box>
        <box width={1}><text fg={theme.dim}>│</text></box>
        <box width={rightW} flexDirection="column">
          <SkillPreview skill={selected} lines={preview} provider={provider} theme={theme} width={rightW} rows={listRows} />
        </box>
      </box>
      <SkillPickerFooter mode={mode} provider={provider} theme={theme} width={totalW} />
    </box>
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'skill-picker',
  views: { 'skill-picker': SkillPickerSurface },
}
