/** @jsxImportSource @opentui/react */
import { useEffect, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { createPluginResourceScope, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import type { TuiTranscriptCard } from '../../../tui/format'

const PAGE_SIZE = 40
function SubagentTranscript({ services, theme, width, height, zIndex, registerKeys, close }: TuiPluginViewProps) {
  const source = services['subagent-transcript']!
  const [cards, setCards] = useState<TuiTranscriptCard[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const scroll = useRef<ScrollBoxRenderable | null>(null)
  useEffect(() => {
    const scope = createPluginResourceScope('subagents')
    setLoading(true); setError(null); setPage(0); setCards([])
    void source.load(scope.signal).then(next => { if (!scope.signal.aborted) setCards(next) }).catch(reason => {
      if (!scope.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (!scope.signal.aborted) setLoading(false) })
    return scope.dispose
  }, [source])
  useEffect(() => {
    registerKeys(key => {
      if (key.name === 'escape' || key.sequence === 'q') { close(); return true }
      if (key.sequence === 'n' || key.name === 'right') setPage(value => Math.min(Math.max(0, Math.ceil(cards.length / PAGE_SIZE) - 1), value + 1))
      else if (key.sequence === 'p' || key.name === 'left') setPage(value => Math.max(0, value - 1))
      else if (key.sequence === 'e') setExpanded(value => !value)
      else if (key.sequence === 'j' || key.name === 'down') scroll.current?.scrollBy(1)
      else if (key.sequence === 'k' || key.name === 'up') scroll.current?.scrollBy(-1)
      else if (key.name === 'pagedown') scroll.current?.scrollBy(Math.max(1, height - 8))
      else if (key.name === 'pageup') scroll.current?.scrollBy(-Math.max(1, height - 8))
      return true
    })
    return () => registerKeys(null)
  }, [registerKeys, close, cards.length, height])
  useEffect(() => { scroll.current?.scrollTo(0) }, [page, expanded])
  const slice = cards.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  return <box id="subagent-transcript" position="absolute" top={1} left={1} width={Math.max(12, width - 2)} height={Math.max(6, height - 2)} zIndex={zIndex} backgroundColor={theme.surface} border borderColor={theme.border} title={` ↪ ${source.label} `} flexDirection="column" paddingX={1}>
    <text fg={theme.dim}>Read only · {source.agentId} · {cards.length} messages · {page + 1}/{Math.max(1, Math.ceil(cards.length / PAGE_SIZE))}</text>
    <scrollbox ref={scroll} flexGrow={1} height={Math.max(1, height - 8)}>
      {loading ? <text fg={theme.cyan}>Loading subagent transcript…</text> : error ? <text fg={theme.red}>{error}</text> : cards.length === 0 ? <text fg={theme.dim}>No captured transcript is available for this subagent.</text> : slice.map(card => <box key={card.key} flexDirection="column" paddingBottom={1}>
        <text fg={card.role === 'user' ? theme.cyan : theme.amber}>{card.label}</text>
        {(expanded ? card.expandedLines : card.lines).map((line, index) => <text key={index} fg={theme.text}>{line.text}</text>)}
      </box>)}
    </scrollbox>
    <text fg={theme.dim}>j/k scroll · n/p next/previous page · e expand/collapse tools · esc close</text>
  </box>
}
export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'subagents', views: { subagents: SubagentTranscript } }
