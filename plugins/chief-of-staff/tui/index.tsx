/** @jsxImportSource @opentui/react */
// TUI panel for the Chief of Staff: loaded on first open, never at boot.
import { useCallback, useEffect, useRef, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { ChiefOfStaffState } from '../../../lib/chiefOfStaff/service'
import { fitText, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { subscribeChiefOfStaffRequest, takeChiefOfStaffRequest } from '../seed'
import type { CosRule } from '../../../lib/chiefOfStaff/rules'
import { formatRuleLine, panelSections, parseRuleLine } from '../model'

const REFRESH_MS = 6000

function ChiefOfStaffSurface({ services, theme, width, height, placement, zIndex, registerKeys, close }: TuiPluginViewProps) {
  const service = services['chief-of-staff']!
  const cwd = services.repository!.cwd
  const provider = services.session?.session?.provider ?? 'claude'
  const [state, setState] = useState<ChiefOfStaffState | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  // Tab moves between the request line and the rules list; an edit line replaces the request line while it is open.
  const [focus, setFocus] = useState<'request' | 'rules'>('request')
  const [ruleIndex, setRuleIndex] = useState(0)
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null)
  const [armed, setArmed] = useState<number | null>(null)

  const reload = useCallback((signal?: AbortSignal) => {
    service.read(cwd, signal)
      .then(next => { if (!signal?.aborted) setState(next) })
      .catch((error: unknown) => { if (!signal?.aborted) services.notices?.show('error', error instanceof Error ? error.message : 'Could not read the Chief of Staff') })
  }, [service, cwd, services.notices])
  useEffect(() => {
    const controller = new AbortController()
    reload(controller.signal)
    const timer = setInterval(() => reload(controller.signal), REFRESH_MS)
    return () => { controller.abort(); clearInterval(timer) }
  }, [reload])

  const send = useCallback(async (request: string) => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    try {
      const started = await service.start({ cwd, provider, request: request || undefined })
      services.notices?.show('info', request ? 'Handed to the Chief of Staff' : started.created ? 'Chief of Staff started' : 'Chief of Staff is already running')
      setDraft('')
      reload()
    } catch (error) {
      services.notices?.show('error', error instanceof Error ? error.message : 'Could not start the Chief of Staff')
    } finally { sending.current = false; setBusy(false) }
  }, [service, cwd, provider, services.notices, reload])

  const ruleList = state?.ruleList ?? []
  const saveRules = useCallback(async (next: CosRule[]) => {
    try { setState(await service.saveRules(cwd, next)); return true } catch (error) {
      services.notices?.show('error', error instanceof Error ? error.message : 'Could not save the rules')
      return false
    }
  }, [service, cwd, services.notices])
  const commitEdit = useCallback(async (edit: { index: number; text: string }) => {
    const parsed = parseRuleLine(edit.text)
    if ('error' in parsed) { services.notices?.show('error', parsed.error); return }
    const next = ruleList.map(rule => ({ ...rule }))
    if (edit.index < 0) next.push(parsed.rule); else next[edit.index] = parsed.rule
    if (await saveRules(next)) { setEditing(null); setRuleIndex(edit.index < 0 ? next.length - 1 : edit.index) }
  }, [ruleList, saveRules, services.notices])

  // `/cos <request>` arrives here: as the panel opens, or while it is already open.
  useEffect(() => {
    const first = takeChiefOfStaffRequest()
    if (first) void send(first)
    return subscribeChiefOfStaffRequest(request => { void send(request) })
  }, [send])

  const session = state?.session
  useEffect(() => {
    registerKeys((key) => {
      const printable = !key.ctrl && !key.meta && key.sequence && key.sequence.length === 1 && key.sequence >= ' '
      if (editing) {
        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) { setEditing(null); return true }
        if (key.name === 'return') { void commitEdit(editing); return true }
        if (key.name === 'backspace') { setEditing({ ...editing, text: editing.text.slice(0, -1) }); return true }
        if (printable) setEditing({ ...editing, text: editing.text + key.sequence })
        return true
      }
      if (key.name === 'tab') { setFocus(value => value === 'request' ? 'rules' : 'request'); setArmed(null); return true }
      if (focus === 'rules') {
        const at = Math.min(ruleIndex, Math.max(ruleList.length - 1, 0))
        // Any key but the second x disarms a pending delete.
        const wasArmed = armed === at
        if (key.sequence !== 'x') setArmed(null)
        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) { setFocus('request'); return true }
        if (key.name === 'down' || key.name === 'j') { setRuleIndex(Math.min(at + 1, Math.max(ruleList.length - 1, 0))); return true }
        if (key.name === 'up' || key.name === 'k') { setRuleIndex(Math.max(at - 1, 0)); return true }
        if (key.sequence === 'a') { setEditing({ index: -1, text: '' }); return true }
        if ((key.name === 'return' || key.sequence === 'e') && ruleList[at]) { setEditing({ index: at, text: formatRuleLine(ruleList[at]) }); return true }
        if (key.sequence === 'x' && ruleList[at]) {
          if (!wasArmed) { setArmed(at); return true }
          setArmed(null)
          void saveRules(ruleList.filter((_, index) => index !== at))
          return true
        }
        return true
      }
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) { if (draft) setDraft(''); else close(); return true }
      if (key.name === 'return') {
        // An empty line opens the chat that exists; text hands it a request (starting it first if needed).
        if (!draft.trim() && session) { services['session-navigation']?.open({ sessionId: session.sessionId, provider: session.provider as never }); close(); return true }
        void send(draft.trim())
        return true
      }
      if (key.name === 'backspace') { setDraft(value => value.slice(0, -1)); return true }
      if (printable) setDraft(value => value + key.sequence)
      return true
    })
    return () => registerKeys(null)
  }, [registerKeys, draft, session, send, close, services, editing, focus, ruleIndex, ruleList, armed, commitEdit, saveRules])

  const docked = placement !== 'overlay'
  const totalW = docked ? width : Math.min(width - 6, 100)
  const totalH = docked ? height : Math.min(height - 4, 30)
  const sections = state ? panelSections(state) : []
  const lines = sections.flatMap(section => [{ text: section.title, tone: 'head' as const, rule: undefined as number | undefined }, ...section.lines.map(line => ({ text: line.text, tone: line.tone as string, rule: line.rule }))])
  const room = Math.max(totalH - 6, 3)
  // Keep the selected rule in view when the list is longer than the room.
  const selectedLine = focus === 'rules' ? lines.findIndex(line => line.rule === Math.min(ruleIndex, Math.max(ruleList.length - 1, 0))) : -1
  const start = selectedLine >= room ? selectedLine - room + 1 : 0
  const tone = (kind: string) => kind === 'head' ? theme.amber : kind === 'bad' ? theme.red : kind === 'dim' ? theme.dim : theme.text
  return (
    <box
      {...(docked
        ? { width, height }
        : { position: 'absolute' as const, top: 2, left: Math.max(Math.floor((width - totalW) / 2), 2), width: totalW, height: totalH, zIndex, border: true, borderStyle: 'single' as const, borderColor: theme.cyan })}
      backgroundColor={theme.surface}
      flexDirection="column"
    >
      <box paddingX={1} backgroundColor={theme.surface2}>
        <text fg={theme.cyan}>{fitText(`☗ CHIEF OF STAFF · ${state ? (session ? 'running' : 'not started') : 'loading…'}`, totalW - 4)}</text>
      </box>
      <box paddingX={1}>
        <text fg={editing ? theme.amber : theme.text}>{fitText(editing ? `${editing.index < 0 ? 'new rule' : `rule ${editing.index + 1}`} › ${editing.text}▏` : `${focus === 'request' ? '›' : ' '} ${draft}${focus === 'request' ? '▏' : ''}`, totalW - 4)}</text>
      </box>
      <box paddingX={1} flexDirection="column" flexGrow={1}>
        {lines.slice(start, start + room).map((line, index) => {
          const on = focus === 'rules' && line.rule !== undefined && line.rule === Math.min(ruleIndex, Math.max(ruleList.length - 1, 0))
          return <text key={start + index} fg={on ? theme.cyan : tone(line.tone)} wrapMode="none">{fitText(`${line.rule !== undefined ? (on ? (armed === line.rule ? '✗ ' : '› ') : '  ') : ''}${line.text}`, totalW - 4)}</text>
        })}
        {lines.length > start + room ? <text fg={theme.dim}>{fitText(`+${lines.length - start - room} more`, totalW - 4)}</text> : null}
      </box>
      <box paddingX={1} backgroundColor={theme.surface2}>
        <text fg={theme.dim}>{fitText(busy ? 'working…' : editing ? 'match | provider[:instance] | model | effort | role | no-worktree · ⏎ save · esc cancel' : focus === 'rules' ? (armed !== null ? 'x again deletes · any key keeps' : '↑↓ select · a add · e edit · x delete · tab back · esc back') : '⏎ send request (empty: open chat) · tab rules · esc close', totalW - 4)}</text>
      </box>
    </box>
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'chief-of-staff',
  views: { 'chief-of-staff': ChiefOfStaffSurface },
}
