import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AdaptiveUiService, AdaptiveUiSnapshot } from '../../lib/plugins/adaptiveUi'
import { renderCardRule, type CardRule, type CardRuleStatus, type RenderedCard } from '../../lib/plugins/cardTemplates'
import type { ShapeRecord } from '../../lib/adaptiveUi/shapes'
import type { Suggestion } from '../../lib/adaptiveUi/suggest'

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

/** A rule rendered against each of its stored samples (what a person reviews before enabling it). */
export function previewRule(rule: CardRule): RenderedCard[] {
  return (rule.samples ?? []).map(sample => renderCardRule(rule, { tool: { name: rule.match.tool.includes('*') ? rule.match.tool.replace(/\*/g, 'x') : rule.match.tool, input: sample.input }, ...(sample.result ? { result: { text: sample.result.text, isError: sample.result.isError === true } } : {}) }))
}
