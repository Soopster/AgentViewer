import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AdaptiveUiService, AdaptiveUiSnapshot } from '../../lib/plugins/adaptiveUi'
import { renderCardRule, type CardRule, type CardRuleStatus, type RenderedCard } from '../../lib/plugins/cardTemplates'
import type { ShapeRecord } from '../../lib/adaptiveUi/shapes'
import type { Suggestion } from '../../lib/adaptiveUi/suggest'
import { ruleCoverage, sampleCalls } from '../../lib/adaptiveUi/coverage'

export type AdaptiveItem = { kind: 'suggestion'; key: string; suggestion: Suggestion } | { kind: 'rule'; key: string; rule: CardRule } | { kind: 'shape'; key: string; shape: ShapeRecord } | { kind: 'invalid'; key: string; file: string; problems: readonly string[] }
const REFRESH_MS = 5_000

/** Shared state of the Adaptive UI view: what exists, what needs designing, and the actions on both. Renderers keep only presentation and input. */
export function useAdaptiveView(service: AdaptiveUiService, insertText: ((text: string) => void) | undefined) {
  const [snapshot, setSnapshot] = useState<AdaptiveUiSnapshot | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try { const next = await service.scan(signal); if (alive.current && !signal?.aborted) setSnapshot(next) }
    catch (error) { if (alive.current && !signal?.aborted) setNotice(error instanceof Error ? error.message : String(error)) }
  }, [service])
  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    const timer = setInterval(() => void refresh(controller.signal), REFRESH_MS)
    return () => { controller.abort(); clearInterval(timer) }
  }, [refresh])
  const act = useCallback(async (work: () => Promise<void>, done: string) => {
    setBusy(true)
    try { await work(); if (alive.current) setNotice(done); await refresh() }
    catch (error) { if (alive.current) setNotice(error instanceof Error ? error.message : String(error)) }
    finally { if (alive.current) setBusy(false) }
  }, [refresh])
  const items = useMemo<AdaptiveItem[]>(() => {
    if (!snapshot) return []
    const order: Record<CardRuleStatus, number> = { draft: 0, active: 1, disabled: 2 }
    return [
      ...snapshot.suggestions.map(suggestion => ({ kind: 'suggestion' as const, key: `suggestion:${suggestion.id}`, suggestion })),
      ...[...snapshot.rules].sort((a, b) => order[a.status] - order[b.status] || a.id.localeCompare(b.id)).map(rule => ({ kind: 'rule' as const, key: `rule:${rule.id}`, rule })),
      ...snapshot.shapes.filter(shape => !shape.dismissed && !snapshot.rules.some(rule => rule.match.tool === shape.tool)).map(shape => ({ kind: 'shape' as const, key: `shape:${shape.key}`, shape })),
      ...snapshot.invalid.map(entry => ({ kind: 'invalid' as const, key: `invalid:${entry.file}`, file: entry.file, problems: entry.problems })),
    ]
  }, [snapshot])
  return {
    snapshot, items, origins: snapshot?.origins ?? {}, notice, busy, armed, insertAvailable: !!insertText,
    refresh: () => refresh(),
    setStatus: (id: string, status: CardRuleStatus) => act(() => service.setStatus(id, status), `${id} is now ${status}`),
    /** Two presses: the first arms, the second deletes. */
    remove: (id: string) => { if (armed !== id) { setArmed(id); setNotice(`Press delete again to remove ${id}`); return Promise.resolve() } setArmed(null); return act(() => service.remove(id), `${id} deleted`) },
    disarm: () => setArmed(null),
    dismiss: (key: string) => act(() => service.dismissShape(key, true), 'Dismissed'),
    /** A view suggestion adds an unselected view; a card suggestion drafts the card in place. */
    applySuggestion: async (suggestion: Suggestion) => {
      if (suggestion.kind === 'design-card') { setBusy(true); setNotice('Designing a card…'); try { const id = await service.designHere(suggestion.shapeKey); if (alive.current) setNotice(`Drafted ${id}: review it, then enable it`); await refresh() } catch (error) { if (alive.current) setNotice(error instanceof Error ? error.message : String(error)) } finally { if (alive.current) setBusy(false) } return }
      await act(async () => { setNotice(await service.applySuggestion(suggestion.id)) }, '')
    },
    dismissSuggestion: (id: string) => act(() => service.dismissSuggestion(id), 'Dismissed'),
    /** Change a rule from a plain-language instruction, in place; it comes back a draft. */
    refineHere: async (id: string, instruction: string) => {
      setBusy(true); setNotice('Changing the card…')
      try { const message = await service.refineHere(id, instruction); if (alive.current) setNotice(message); await refresh() }
      catch (error) { if (alive.current) setNotice(error instanceof Error ? error.message : String(error)) }
      finally { if (alive.current) setBusy(false) }
    },
    /** Hand an agent the request to change a rule by patch. */
    refineWithAgent: async (id: string) => {
      try {
        const prompt = await service.refinePrompt(id)
        if (!insertText) { setNotice('Open a session composer to hand this to an agent'); return false }
        insertText(prompt); setNotice('Say what to change, then send it to an agent'); return true
      } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return false }
    },
    /** In place, through a tool-less model; the result is a draft to review. */
    designHere: async (key: string) => {
      setBusy(true); setNotice('Designing a card…')
      try { const id = await service.designHere(key); if (alive.current) setNotice(`Drafted ${id}: review it below, then enable it`); await refresh() }
      catch (error) { if (alive.current) setNotice(error instanceof Error ? error.message : String(error)) }
      finally { if (alive.current) setBusy(false) }
    },
    design: async (key: string) => {
      try {
        const prompt = await service.designPrompt(key)
        if (!insertText) { setNotice('Open a session composer to hand this to an agent'); return false }
        insertText(prompt); setNotice('Design request is in the composer: send it to an agent'); return true
      } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return false }
    },
  }
}
export type AdaptiveViewState = ReturnType<typeof useAdaptiveView>

/** The history entries about one rule, newest first. */
export const historyFor = (state: AdaptiveViewState, id: string) => (state.snapshot?.history ?? []).filter(entry => entry.id === id).slice(0, 5)

/** What a rule reads that its samples do not have: shown beside its preview. */
export function coverageWarnings(rule: CardRule): string[] { return ruleCoverage(rule, sampleCalls(rule)).warnings.slice(0, 4) }

/** A rule rendered against each of its stored samples (what a person reviews before enabling it). */
export function previewRule(rule: CardRule): RenderedCard[] {
  return (rule.samples ?? []).map(sample => renderCardRule(rule, { tool: { name: rule.match.tool.includes('*') ? rule.match.tool.replace(/\*/g, 'x') : rule.match.tool, input: sample.input }, ...(sample.result ? { result: { text: sample.result.text, isError: sample.result.isError === true } } : {}) }))
}

// ── What both renderers show about an item, from one place ─────────────────────────────────────────────

export type AdaptiveFilter = 'all' | 'suggested' | 'cards' | 'generic' | 'refused'
export const ADAPTIVE_FILTERS: readonly { readonly id: AdaptiveFilter; readonly label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'suggested', label: 'Suggested' }, { id: 'cards', label: 'Cards' }, { id: 'generic', label: 'Generic' }, { id: 'refused', label: 'Refused' },
]
const FILTER_OF: Record<AdaptiveItem['kind'], AdaptiveFilter> = { suggestion: 'suggested', rule: 'cards', shape: 'generic', invalid: 'refused' }
export const filterAdaptiveItems = (items: readonly AdaptiveItem[], filter: AdaptiveFilter): AdaptiveItem[] => items.filter(item => filter === 'all' || FILTER_OF[item.kind] === filter)
export const countAdaptive = (items: readonly AdaptiveItem[], filter: AdaptiveFilter): number => filterAdaptiveItems(items, filter).length

export type AdaptiveSection = 'Suggested' | 'Cards' | 'Drawn generically' | 'Refused files'
export type AdaptiveRowTone = 'accent' | 'good' | 'warn' | 'muted' | 'bad'
export type AdaptiveRow = { readonly title: string; readonly sub: string; readonly glyph: string; readonly tone: AdaptiveRowTone; readonly section: AdaptiveSection }
/** One item as a list row: a name, and a muted line that says what state it is in. Status is a word and a glyph, never colour alone. */
export function describeAdaptiveItem(item: AdaptiveItem, origins: Readonly<Record<string, string>>): AdaptiveRow {
  if (item.kind === 'suggestion') return { title: item.suggestion.title, sub: item.suggestion.detail, glyph: '★', tone: 'accent', section: 'Suggested' }
  if (item.kind === 'invalid') return { title: item.file, sub: `refused · ${item.problems.length} problem${item.problems.length === 1 ? '' : 's'}`, glyph: '!', tone: 'bad', section: 'Refused files' }
  if (item.kind === 'shape') return { title: item.shape.tool, sub: `no card · ${item.shape.count} call${item.shape.count === 1 ? '' : 's'}${item.shape.inputKeys.length ? ` · ${item.shape.inputKeys.slice(0, 3).join(', ')}${item.shape.inputKeys.length > 3 ? '…' : ''}` : ' · no input'}${item.shape.samples.length ? '' : ' · no samples yet'}`, glyph: '+', tone: 'muted', section: 'Drawn generically' }
  const { rule } = item
  const status = rule.status === 'active' ? 'active' : rule.status === 'draft' ? 'draft: review it' : 'disabled'
  return { title: rule.id, sub: `${status} · ${rule.match.tool}${origins[rule.id] ? ` · mod ${origins[rule.id]}` : rule.provenance?.by ? ` · by ${rule.provenance.by}` : ''}`, glyph: rule.status === 'active' ? '●' : rule.status === 'draft' ? '◐' : '○', tone: rule.status === 'active' ? 'good' : rule.status === 'draft' ? 'warn' : 'muted', section: 'Cards' }
}
