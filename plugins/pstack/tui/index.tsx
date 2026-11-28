/** @jsxImportSource @opentui/react */
// TUI panel: model roles, playbook install and the skill list. Loaded on first open.
import { useCallback, useEffect, useRef, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { installWorkflowPack } from '../../../lib/plugins/workflowPacks'
import { PSTACK_PACK } from '../../../lib/pstack/playbooks'
import type { PstackState } from '../../../lib/pstack/service'
import { fitText, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { fileProblems, roleRows, roleValue, ROLE_FORMAT, USAGE_LINES } from '../model'

function PstackSurface({ services, theme, width, height, placement, zIndex, registerKeys, close }: TuiPluginViewProps) {
  const service = services.pstack!
  const cwd = services.repository!.cwd
  const [state, setState] = useState<PstackState | null>(null)
  const [cursor, setCursor] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const alive = useRef(true)
  const installing = useRef(false)
  const say = (error: unknown) => { if (alive.current) setNotice(error instanceof Error ? error.message : String(error)) }

  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    service.read(cwd, controller.signal).then(next => { if (!controller.signal.aborted) setState(next) }).catch(say)
    return () => { alive.current = false; controller.abort() }
  }, [service, cwd])

  const rows = state ? roleRows(state) : []
  const at = Math.min(cursor, Math.max(rows.length - 1, 0))
  const save = useCallback(async (role: string, line: string) => {
    try {
      const next = await service.saveRole(cwd, role, line)
      if (alive.current) { setState(next); setEditing(null); setNotice('') }
    } catch (error) { say(error) }
  }, [service, cwd])
  const install = useCallback(async () => {
    if (installing.current) return
    installing.current = true
    try {
      const result = await installWorkflowPack(services.playbooks!, cwd, PSTACK_PACK)
      say([result.installed.length ? `Installed ${result.installed.join(', ')}` : '', ...result.skipped, ...result.errors].filter(Boolean).join(' · '))
    } catch (error) { say(error) } finally { installing.current = false }
  }, [services.playbooks, cwd])

  useEffect(() => {
    registerKeys(key => {
      const cancel = key.name === 'escape' || (key.ctrl && key.name === 'c')
      const printable = !key.ctrl && !key.meta && key.sequence && key.sequence.length === 1 && key.sequence >= ' '
      if (editing !== null) {
        if (cancel) setEditing(null)
        else if (key.name === 'return') void save(rows[at]!.id, editing)
        else if (key.name === 'backspace') setEditing(editing.slice(0, -1))
        else if (printable) setEditing(editing + key.sequence)
        return true
      }
      if (cancel) close()
      else if (key.name === 'down' || key.name === 'j') setCursor(Math.min(at + 1, rows.length - 1))
      else if (key.name === 'up' || key.name === 'k') setCursor(Math.max(at - 1, 0))
      else if ((key.name === 'return' || key.sequence === 'e') && rows[at]) { setNotice(''); setEditing(rows[at]!.line) }
      else if (key.sequence === 'i') void install()
      return true
    })
    return () => registerKeys(null)
  })

  const docked = placement !== 'overlay'
  const totalW = docked ? width : Math.min(width - 6, 100)
  const totalH = docked ? height : Math.min(height - 4, 30)
  const inner = Math.max(totalW - 4, 10)
  const selected = rows[at]
  const detail = notice || selected?.problem || (state ? fileProblems(state)[0]?.message : '') || selected?.hint || ''
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
        <text fg={theme.cyan} wrapMode="none">{fitText(`≡ pstack ${state ? `${state.version} · ${state.skills.length} skills` : '· loading…'}`, inner)}</text>
      </box>
      <scrollbox flexGrow={1} minHeight={1} paddingX={1}>
        {USAGE_LINES.map(line => <text key={line} fg={theme.dim} wrapMode="none">{fitText(line, inner)}</text>)}
        <text fg={theme.amber}> </text>
        <text fg={theme.amber} wrapMode="none">{fitText('MODEL ROLES', inner)}</text>
        {rows.map((row, index) => (
          <box key={row.id} height={1} flexShrink={0} backgroundColor={index === at ? theme.surface3 : undefined} onMouseDown={() => { setCursor(index); setEditing(null) }}>
            <text fg={row.problem ? theme.red : index === at ? theme.cyan : theme.text} wrapMode="none">{fitText(`${index === at ? '›' : ' '} ${row.problem ? '✗ ' : ''}${row.id.padEnd(23)} ${index === at && editing !== null ? `${editing}▏` : roleValue(row)}`, inner)}</text>
          </box>
        ))}
        <text> </text>
        <text fg={theme.amber} wrapMode="none">{fitText('SKILLS', inner)}</text>
        <text fg={theme.text} wrapMode="word">{state?.skills.filter(name => !name.startsWith('principle-')).join(' · ') ?? ''}</text>
        <text fg={theme.dim} wrapMode="word">{state ? `+ ${state.skills.filter(name => name.startsWith('principle-')).length} principle-* skills` : ''}</text>
      </scrollbox>
      <box paddingX={1} height={1} flexShrink={0}><text fg={notice || selected?.problem ? theme.amber : theme.muted} wrapMode="none">{fitText(detail, inner)}</text></box>
      <box paddingX={1} height={1} flexShrink={0} backgroundColor={theme.surface2}>
        <text fg={theme.dim} wrapMode="none">{fitText(editing !== null ? `${ROLE_FORMAT}${selected?.panel ? ', …' : ''} · empty clears · ⏎ save · esc cancel` : '↑↓ role · ⏎ edit · i install playbooks · esc close', inner)}</text>
      </box>
    </box>
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'pstack',
  views: { pstack: PstackSurface },
}
