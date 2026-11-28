'use client'
import { useState } from 'react'
import type { PluginToolCard, ToolUseBlock } from '@/lib/types'
import { hasNativeToolCard } from '@/lib/plugins/nativeTools'
import { shapeKey } from '@/lib/adaptiveUi/shapes'
import { PluginCardBlocks } from './PluginCardBlocks'

async function adaptive(body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch('/api/adaptive-ui', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || 'Adaptive UI request failed')
  return value.result
}

const button = { fontSize: 11, color: 'var(--text-2)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '1px 8px', cursor: 'pointer' } as const

/**
 * A draft card for this very call, beside the built-in one and labelled as a draft: the place to judge a
 * design on real data. Keeping it makes the rule active; discarding deletes it. Neither touches the call.
 */
export function PluginDraftCard({ card }: { card: PluginToolCard }) {
  const [state, setState] = useState<'idle' | 'busy' | 'kept' | 'discarded' | string>('idle')
  const act = async (body: Record<string, unknown>, done: string) => {
    setState('busy')
    try { await adaptive(body); setState(done) } catch (error) { setState(error instanceof Error ? error.message : String(error)) }
  }
  if (state === 'discarded') return <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>Draft card discarded.</div>
  return (
    <div data-plugin-draft-card={card.ref} style={{ border: '1px dashed var(--border-2)', borderRadius: 8, padding: '6px 10px', fontSize: 12.5, marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--amber, #d29922)' }}>Draft card · preview</span>
        <span style={{ fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0 }}>{card.title}</span>
        {state === 'kept' ? <span style={{ fontSize: 11, color: 'var(--green, #3fb950)' }}>Kept: it draws instead of the generic card from now on</span> : <>
          <button type="button" style={button} disabled={state === 'busy' || !card.ref} onClick={() => void act({ action: 'set-status', id: card.ref, status: 'active' }, 'kept')}>Keep</button>
          <button type="button" style={button} disabled={state === 'busy' || !card.ref} onClick={() => void act({ action: 'remove', id: card.ref }, 'discarded')}>Discard</button>
        </>}
      </div>
      {card.blocks?.length ? <PluginCardBlocks blocks={card.blocks} /> : card.lines.map((text, index) => <div key={index} style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{text}</div>)}
      {state !== 'idle' && state !== 'busy' && state !== 'kept' ? <div role="status" style={{ color: 'var(--red, #f85149)', fontSize: 11 }}>{state}</div> : null}
    </div>
  )
}

/** Where the gallery cannot be missed: on a call that is drawn generically. Drafts a card for the tool in place. */
export function DesignCardButton({ toolUse, hasResult }: { toolUse: ToolUseBlock; hasResult: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | string>('idle')
  if (hasNativeToolCard(toolUse.name) || toolUse.pluginCard || toolUse.pluginCardDraft || !hasResult) return null
  const key = shapeKey(toolUse.name, Object.keys(toolUse.input ?? {}).filter(name => /^[A-Za-z0-9_-]{1,64}$/.test(name)).sort().slice(0, 24))
  const run = async () => {
    setState('busy')
    try { const id = await adaptive({ action: 'design-here', key }); setState(`Drafted ${id}: it shows here as a preview on the next refresh`) }
    catch (error) { setState(error instanceof Error ? error.message : String(error)) }
  }
  return (
    <div style={{ marginTop: 2, fontSize: 11, color: 'var(--text-2)' }}>
      {state === 'idle' || state === 'busy' ? <button type="button" style={button} disabled={state === 'busy'} onClick={() => void run()} title="Ask a model with no tools to draft a card for this tool from its recent calls">{state === 'busy' ? 'Designing…' : '✦ Design a card for this tool'}</button> : <span role="status">{state}</span>}
    </div>
  )
}
