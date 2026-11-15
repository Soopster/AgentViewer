/** @jsxImportSource @opentui/react */
import { useEffect, useRef, useState } from 'react'
import type { BoxRenderable, ScrollBoxRenderable } from '@opentui/core'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { cardBlockLines } from '../../../lib/plugins/cardBlocks'
import { popoverRootProps, PopoverDetachButton, fitText, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { previewRule, useAdaptiveView, type AdaptiveItem } from '../useAdaptiveView'

const STATUS_GLYPH = { active: '●', draft: '◐', disabled: '○' } as const
const HINT = 'j/k move · a enable · d disable · x delete (twice) · g design with an agent · h design here · i dismiss · p preview · r refresh · esc'

function AdaptiveUi(props: TuiPluginViewProps) {
  const { services, theme, width, height, placement, focused, detach, registerKeys, useState: scoped } = props
  const state = useAdaptiveView(services['adaptive-ui']!, services.composer?.insertPrompt)
  const [cursor, setCursor] = scoped('cursor', 0)
  const [preview, setPreview] = useState(true)
  const scroll = useRef<ScrollBoxRenderable>(null), row = useRef<BoxRenderable>(null)
  const overlay = placement === 'overlay'
  const w = overlay ? Math.max(1, Math.min(width - 4, 120)) : width, h = overlay ? Math.max(1, height - 4) : height
  const inner = Math.max(1, w - 2)
  const items = state.items
  const at = Math.min(cursor, Math.max(0, items.length - 1))
  const selected: AdaptiveItem | undefined = items[at]
  useEffect(() => { if (row.current) scroll.current?.scrollChildIntoView(row.current) }, [at, items.length])
  const act = (key: string) => {
    if (!selected) return key === 'r' ? (void state.refresh(), true) : false
    if (key === 'r') { void state.refresh(); return true }
    if (key === 'p') { setPreview(value => !value); return true }
    if (selected.kind === 'rule') {
      if (key === 'a' || key === 'return') { if (selected.rule.status !== 'active') void state.setStatus(selected.rule.id, 'active'); return true }
      if (key === 'd') { if (selected.rule.status === 'active') void state.setStatus(selected.rule.id, 'disabled'); return true }
      if (key === 'x') { void state.remove(selected.rule.id); return true }
    }
    if (selected.kind === 'shape') {
      if (key === 'h') { void state.designHere(selected.shape.key); return true }
      if (key === 'g' || key === 'return') { void state.design(selected.shape.key).then(ok => { if (ok && overlay) props.close() }); return true }
      if (key === 'i') { void state.dismiss(selected.shape.key); return true }
    }
    return false
  }
  useEffect(() => {
    registerKeys(key => {
      if (!focused) return false
      if (key.ctrl) return false
      if (key.name === 'escape') { if (state.armed) { state.disarm(); return true } if (overlay) { props.close(); return true } return false }
      if (key.name === 'down' || key.name === 'j') { state.disarm(); setCursor(Math.min(items.length - 1, at + 1)); return true }
      if (key.name === 'up' || key.name === 'k') { state.disarm(); setCursor(Math.max(0, at - 1)); return true }
      return act(key.name === 'return' ? 'return' : key.name.length === 1 ? key.name : key.sequence)
    })
    return () => registerKeys(null)
  })
  const lines = selected?.kind === 'rule' && preview ? previewRule(selected.rule).flatMap(card => [`▸ ${card.title}`, ...cardBlockLines(card.blocks).map(text => `  ${text}`)]) : []
  return <box {...popoverRootProps(!overlay, { top: 2, left: Math.max(0, Math.floor((width - w) / 2)), width: w, height: h }, props.zIndex ?? 50)} border={overlay} borderColor={theme.border2} backgroundColor={theme.surface} flexDirection="column" overflow="hidden" title={overlay ? ' Adaptive UI ' : undefined}>
    {overlay && detach ? <PopoverDetachButton theme={theme} onPress={detach} /> : null}
    <box height={1} flexShrink={0} paddingX={1}><text fg={theme.dim} wrapMode="none">{fitText(`${state.snapshot?.rules.length ?? 0} cards · ${items.filter(item => item.kind === 'shape').length} drawn generically · ${state.snapshot?.dir ?? ''}`, inner - 2)}</text></box>
    <scrollbox ref={scroll} flexGrow={1} minHeight={1} paddingX={1}>
      {items.map((item, index) => {
        const active = index === at
        const label = item.kind === 'rule' ? `${STATUS_GLYPH[item.rule.status]} ${item.rule.id}  ${item.rule.match.tool}` : item.kind === 'shape' ? `+ ${item.shape.tool}  ${item.shape.count} calls, no card` : `! ${item.file}  refused`
        const tone = item.kind === 'rule' ? item.rule.status === 'active' ? theme.green : item.rule.status === 'draft' ? theme.amber : theme.dim : item.kind === 'shape' ? theme.text : theme.red
        return <box key={item.key} ref={active ? row : undefined} flexDirection="column" backgroundColor={active ? theme.surface2 : undefined} onMouseDown={() => { if (focused) setCursor(index) }}>
          <text fg={active ? theme.cyan : tone} wrapMode="none" selectable={false}>{fitText(`${active ? '›' : ' '} ${label}`, inner - 2)}</text>
          {active && item.kind === 'invalid' ? item.problems.map((problem, i) => <text key={i} fg={theme.red} wrapMode="word">{`    ${problem}`}</text>) : null}
          {active && item.kind === 'shape' ? <text fg={theme.dim} wrapMode="word">{`    keys: ${item.shape.inputKeys.join(', ') || 'none'} · ${item.shape.samples.length} samples · g hands a design request to the composer · h drafts it here`}</text> : null}
          {active && item.kind === 'rule' ? lines.length ? lines.map((text, i) => <text key={i} fg={theme.text} wrapMode="word">{`    ${text}`}</text>) : <text fg={theme.dim} wrapMode="word">{`    ${item.rule.samples?.length ? 'preview hidden (p)' : 'no samples saved: drawn on real calls once enabled'}`}</text> : null}
        </box>
      })}
      {!items.length ? <box padding={1}><text fg={theme.dim} wrapMode="word">{state.snapshot ? 'No cards yet. Tools with no dedicated card appear here after their first finished call.' : 'Loading…'}</text></box> : null}
    </scrollbox>
    <box height={1} flexShrink={0} paddingX={1}><text fg={state.busy ? theme.amber : theme.dim} wrapMode="none">{fitText(state.notice || (state.busy ? 'Working…' : HINT), inner - 2)}</text></box>
  </box>
}
export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'adaptive-ui', views: { 'adaptive-ui': AdaptiveUi } }
