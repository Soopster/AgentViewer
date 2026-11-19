// What the app could change about itself, derived from how it is used. Pure: signals in, suggestions out.
// A suggestion is either a request to design a card or a custom view (a diff over a built-in) to add as
// a new, unselected view; nothing here applies itself.
import type { ShapeRecord } from './shapes'

export type InteractionCounts = { expand: number; fold: number; toggle: number }
export type UsageCount = { tool: string; completed: number; failed: number }
export type ViewSuggestionSpec = { readonly id: string; readonly name: string; readonly base: 'stream'; readonly overrides: Readonly<Record<string, string | boolean>> }
export type Suggestion =
  | { readonly id: string; readonly kind: 'design-card'; readonly title: string; readonly detail: string; readonly tool: string; readonly shapeKey: string; readonly weight: number }
  | { readonly id: string; readonly kind: 'view'; readonly title: string; readonly detail: string; readonly view: ViewSuggestionSpec; readonly weight: number }

export const SUGGEST_LIMITS = Object.freeze({ cardCalls: 5, cardOpens: 3, minCalls: 40, groupMaxOpenRatio: 0.1, expandMinCalls: 20, expandMinRatio: 0.5 })

export type SuggestInput = {
  readonly shapes: readonly ShapeRecord[]
  readonly usage: readonly UsageCount[]
  readonly interactions: Readonly<Record<string, InteractionCounts>>
  /** Tools that already have a card rule, by their exact match string. */
  readonly ruledTools: ReadonlySet<string>
  readonly dismissed: ReadonlySet<string>
  readonly existingViewIds: ReadonlySet<string>
}

export function suggest(input: SuggestInput): Suggestion[] {
  const L = SUGGEST_LIMITS
  const out: Suggestion[] = []
  for (const shape of input.shapes) {
    if (shape.dismissed || input.ruledTools.has(shape.tool)) continue
    const opens = input.interactions[shape.tool]?.expand ?? 0
    if (shape.count < L.cardCalls && opens < L.cardOpens) continue
    const id = `card:${shape.tool}`
    if (input.dismissed.has(id)) continue
    out.push({ id, kind: 'design-card', tool: shape.tool, shapeKey: shape.key, title: `Design a card for ${shape.tool}`, detail: `${shape.count} calls drawn generically${opens ? `, opened ${opens} times` : ''}.`, weight: shape.count + opens * 3 })
  }
  const completed = input.usage.reduce((sum, entry) => sum + entry.completed, 0)
  const opens = Object.values(input.interactions).reduce((sum, entry) => sum + entry.expand, 0)
  if (completed >= L.minCalls && opens / completed <= L.groupMaxOpenRatio && !input.dismissed.has('view:grouped') && !input.existingViewIds.has('adaptive-grouped')) {
    out.push({ id: 'view:grouped', kind: 'view', title: 'A view that groups tool calls', detail: `${completed} tool calls, opened ${opens} times: runs of calls rarely need their own row.`, view: { id: 'adaptive-grouped', name: 'Adaptive · grouped tools', base: 'stream', overrides: { toolGrouping: 'stream' } }, weight: completed - opens * 10 })
  }
  if (completed >= L.expandMinCalls && opens / completed >= L.expandMinRatio && !input.dismissed.has('view:expanded') && !input.existingViewIds.has('adaptive-expanded')) {
    out.push({ id: 'view:expanded', kind: 'view', title: 'A view that opens cards by default', detail: `You opened ${opens} cards across ${completed} tool calls.`, view: { id: 'adaptive-expanded', name: 'Adaptive · cards open', base: 'stream', overrides: { foldDefault: 'expand-all' } }, weight: opens })
  }
  return out.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))
}
