/** @jsxImportSource @opentui/react */
// TUI panel: repository setup, the skills (⏎ puts one in the composer) and the playbook. Loaded on first open.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { installWorkflowPack } from '../../../lib/plugins/workflowPacks'
import { MATT_PACK } from '../../../lib/mattSkills/playbooks'
import type { MattSkillsState } from '../../../lib/mattSkills/service'
import { fitText, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { FLOW_LINE, mattPrompt, SETUP_PROMPT, setupSummary, skillGroups, USAGE_LINE } from '../model'

function MattSkillsSurface({ services, theme, width, height, placement, zIndex, registerKeys, close }: TuiPluginViewProps) {
  const service = services['matt-skills']!
  const cwd = services.repository!.cwd
  const [state, setState] = useState<MattSkillsState | null>(null)
  const [cursor, setCursor] = useState(0)
  const [notice, setNotice] = useState('')
  const alive = useRef(true)
  const installing = useRef(false)
  const list = useRef<ScrollBoxRenderable | null>(null)
  const say = (error: unknown) => { if (alive.current) setNotice(error instanceof Error ? error.message : String(error)) }

  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    service.read(cwd, controller.signal).then(next => { if (!controller.signal.aborted) setState(next) }).catch(say)
    return () => { alive.current = false; controller.abort() }
  }, [service, cwd])

  const groups = state ? skillGroups(state.skills) : []
  const rows = groups.flatMap(group => group.skills)
  const at = Math.min(cursor, Math.max(rows.length - 1, 0))
  const selected = rows[at]
  useEffect(() => { if (selected) list.current?.scrollChildIntoView(`matt-skill-${selected.name}`) }, [selected])

  const insert = (text: string) => {
    const composer = services.composer
    if (!composer?.insertText) { say(`Open a chat, then type ${text.trim()}`); return }
    composer.insertText(text, `${text.trim()} is in the composer`)
    if (placement === 'overlay') close()
  }
  const install = useCallback(async () => {
    if (installing.current) return
    installing.current = true
    try {
      const result = await installWorkflowPack(services.playbooks!, cwd, MATT_PACK)
      say([result.installed.length ? `Installed ${result.installed.join(', ')}` : '', ...result.skipped, ...result.errors].filter(Boolean).join(' · '))
    } catch (error) { say(error) } finally { installing.current = false }
  }, [services.playbooks, cwd])

  useEffect(() => {
    registerKeys(key => {
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) close()
      else if (key.name === 'down' || key.name === 'j') { setNotice(''); setCursor(Math.min(at + 1, rows.length - 1)) }
      else if (key.name === 'up' || key.name === 'k') { setNotice(''); setCursor(Math.max(at - 1, 0)) }
      else if (key.name === 'return' && selected) insert(mattPrompt(selected.name))
      else if (key.sequence === 's') insert(SETUP_PROMPT)
      else if (key.sequence === 'i') void install()
      return true
    })
    return () => registerKeys(null)
  })

  const docked = placement !== 'overlay'
  const totalW = docked ? width : Math.min(width - 6, 100)
  const totalH = docked ? height : Math.min(height - 4, 32)
  const inner = Math.max(totalW - 4, 10)
  return (
    <box
      {...(docked
        ? { width, height }
        : { position: 'absolute' as const, top: 2, left: Math.max(Math.floor((width - totalW) / 2), 2), width: totalW, height: totalH, zIndex, border: true, borderStyle: 'single' as const, borderColor: theme.cyan })}
      backgroundColor={theme.surface}
      flexDirection="column"
      overflow="hidden"
    >
      <box paddingX={1} height={1} flexShrink={0} backgroundColor={theme.surface2}>
        <text fg={theme.cyan} wrapMode="none">{fitText(`✎ Matt Pocock skills ${state ? `${state.version} · ${state.skills.length}` : '· loading…'}`, inner)}</text>
      </box>
      <box paddingX={1} flexDirection="column" flexShrink={0}>
        <text fg={theme.dim} wrapMode="none">{fitText(USAGE_LINE, inner)}</text>
        <text fg={theme.dim} wrapMode="none">{fitText(FLOW_LINE, inner)}</text>
        <text fg={state?.setup.configured ? theme.text : theme.amber} wrapMode="none">{fitText(state ? `${setupSummary(state.setup)}${state.setup.configured ? '' : ' Press s.'}` : ' ', inner)}</text>
        <text fg={theme.muted} wrapMode="none">{fitText(state ? state.setup.files.map(file => `${file.exists ? '✓' : '·'} ${file.path.split('/').pop()}`).join('  ') : ' ', inner)}</text>
      </box>
      <scrollbox ref={list} flexGrow={1} minHeight={1} paddingX={1}>
        {groups.map(group => (
          <box key={group.title} flexDirection="column" flexShrink={0}>
            <text fg={theme.amber} wrapMode="none">{fitText(group.title.toUpperCase(), inner)}</text>
            {group.skills.map(skill => (
              <box key={skill.name} id={`matt-skill-${skill.name}`} height={1} flexShrink={0} backgroundColor={skill === selected ? theme.surface3 : undefined} onMouseDown={() => setCursor(rows.indexOf(skill))}>
                <text fg={skill === selected ? theme.cyan : theme.text} wrapMode="none">{fitText(`${skill === selected ? '›' : ' '} ${skill.name}`, inner)}</text>
              </box>
            ))}
          </box>
        ))}
      </scrollbox>
      <box paddingX={1} height={2} flexShrink={0} overflow="hidden"><text fg={notice ? theme.amber : theme.muted} wrapMode="word">{notice || selected?.description || ''}</text></box>
      <box paddingX={1} height={1} flexShrink={0} backgroundColor={theme.surface2}>
        <text fg={theme.dim} wrapMode="none">{fitText('↑↓ skill · ⏎ to composer · s set up repo · i install review playbook · esc close', inner)}</text>
      </box>
    </box>
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'matt-skills',
  views: { 'matt-skills': MattSkillsSurface },
}
