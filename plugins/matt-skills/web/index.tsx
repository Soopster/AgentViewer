'use client'

// Web panel: repository setup, the skills (each can go to the composer) and the playbook.
import { useEffect, useRef, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { installWorkflowPack } from '@/lib/plugins/workflowPacks'
import { MATT_PACK } from '@/lib/mattSkills/playbooks'
import type { MattSkillsState } from '@/lib/mattSkills/service'
import { FLOW_LINE, mattPrompt, SETUP_PROMPT, setupSummary, skillGroups, USAGE_LINE } from '../model'

function MattSkillsView({ services, close }: WebPluginViewProps) {
  const service = services['matt-skills']!
  const cwd = services.repository!.cwd
  const insertText = services.composer?.insertText
  const [state, setState] = useState<MattSkillsState | null>(null)
  const [notice, setNotice] = useState('')
  const [installing, setInstalling] = useState(false)
  const lock = useRef(false)
  const message = (error: unknown) => error instanceof Error ? error.message : String(error)

  useEffect(() => {
    const controller = new AbortController()
    service.read(cwd, controller.signal).then(next => { if (!controller.signal.aborted) setState(next) }).catch((error: unknown) => { if (!controller.signal.aborted) setNotice(message(error)) })
    return () => controller.abort()
  }, [service, cwd])

  const install = async () => {
    if (lock.current) return
    lock.current = true
    setInstalling(true)
    try {
      const result = await installWorkflowPack(services.playbooks!, cwd, MATT_PACK)
      setNotice([result.installed.length ? `Installed ${result.installed.join(', ')}` : '', ...result.skipped, ...result.errors].filter(Boolean).join(' · '))
    } catch (error) { setNotice(message(error)) } finally { lock.current = false; setInstalling(false) }
  }
  const insert = (text: string) => { insertText?.(text); close() }

  return (
    <div role="dialog" aria-label="Matt Pocock skills" className="flex flex-col gap-3 overflow-auto p-4 text-sm">
      <div className="flex items-center justify-between">
        <strong>✎ Matt Pocock skills {state ? `${state.version} · ${state.skills.length}` : '· loading…'}</strong>
        <button type="button" onClick={close}>Close</button>
      </div>
      <p className="text-muted-foreground">{USAGE_LINE}<br />{FLOW_LINE}</p>
      {notice ? <p role="status" className="text-amber-600">{notice}</p> : null}
      {state ? (
        <section>
          <p className={state.setup.configured ? '' : 'text-amber-600'}>{setupSummary(state.setup)}</p>
          <ul className="text-muted-foreground">{state.setup.files.map(file => <li key={file.path}>{file.exists ? '✓' : '·'} {file.path}</li>)}</ul>
          {insertText ? <button type="button" onClick={() => insert(SETUP_PROMPT)}>{state.setup.configured ? 'Run setup again' : 'Set up this repository'}</button> : <p className="text-muted-foreground">Type {SETUP_PROMPT}in a chat to set it up.</p>}
        </section>
      ) : null}
      {state ? skillGroups(state.skills).map(group => (
        <section key={group.title}>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">{group.title}</h3>
          <ul>{group.skills.map(skill => (
            <li key={skill.name} className="flex gap-2 py-0.5">
              {insertText ? <button type="button" className="w-56 shrink-0 text-left underline" onClick={() => insert(mattPrompt(skill.name))}>{skill.name}</button> : <span className="w-56 shrink-0">{skill.name}</span>}
              <span className="text-muted-foreground">{skill.description}</span>
            </li>
          ))}</ul>
        </section>
      )) : null}
      <section>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Coordinator playbook</h3>
        <p className="text-muted-foreground">{MATT_PACK.playbooks.map(item => item.name).join(', ')}. Existing files are kept. Installing starts no agents.</p>
        <button type="button" disabled={installing} onClick={() => { void install() }}>Install in this repository</button>
      </section>
      <p className="text-muted-foreground">Also listed in the Skill picker and Skills Manager. Skills by Matt Pocock, MIT.</p>
    </div>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'matt-skills',
  views: { 'matt-skills': MattSkillsView },
}
