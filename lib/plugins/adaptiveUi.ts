/** Browser-safe Adaptive UI contract. Rules and shapes live where the transcript read path runs; this is how a view reaches them. */
import type { CardRule, CardRuleStatus } from './cardTemplates'
import type { ShapeRecord } from '../adaptiveUi/shapes'
export type AdaptiveUiSnapshot = {
  readonly dir: string
  readonly rules: readonly CardRule[]
  /** Rule id to the mod that ships it; those rules are read-only here. */
  readonly origins: Readonly<Record<string, string>>
  readonly invalid: readonly { readonly file: string; readonly problems: readonly string[] }[]
  readonly shapes: readonly ShapeRecord[]
  /** Calls by tool since the process started, for suggestions. */
  readonly usage: readonly { readonly tool: string; readonly completed: number; readonly failed: number }[]
  /** What happened to rules and who did it, newest first. */
  /** What past transcripts say: sessions read, a one-line summary per tool, and what each rule reads that history never had. */
  readonly knowledge: { readonly scanned: number; readonly updatedAt: number; readonly tools: Readonly<Record<string, string>>; readonly ruleWarnings: Readonly<Record<string, readonly string[]>> }
  readonly history: readonly import('../adaptiveUi/history').CardHistoryEntry[]
  readonly suggestions: readonly import('../adaptiveUi/suggest').Suggestion[]
  readonly settings: { readonly autoDraft: boolean; readonly autoDraftAfter: number; readonly autoDraftDaily: number }
}
export type AdaptiveUiService = {
  scan(signal?: AbortSignal): Promise<AdaptiveUiSnapshot>
  setStatus(id: string, status: CardRuleStatus): Promise<void>
  remove(id: string): Promise<void>
  dismissShape(key: string, dismissed: boolean): Promise<void>
  /** Add a suggested view as a new, unselected custom view (or acknowledge a card suggestion). */
  applySuggestion(id: string): Promise<string>
  dismissSuggestion(id: string): Promise<void>
  /** Opt in or out of drafting a card, unprompted, for a tool drawn generically often. Drafts only; never activates. */
  setAutoDraft(enabled: boolean): Promise<void>
  /** Read past sessions (a bounded batch) to learn how tools are called and what they return. Returns what it did. */
  learnFromHistory(): Promise<string>
  /** Change one of your own rules from a plain-language instruction through a tool-less model; it comes back a draft. Counted against the daily limit. */
  refineHere(id: string, instruction: string, ask?: import('./modelService').ModelAsk): Promise<string>
  /** The request to hand an agent to change a rule by patch. */
  refinePrompt(id: string): Promise<string>
  /** Ask a tool-less model to design a card in place; it lands as a draft. Returns the rule id. Counted against a daily limit. */
  designHere(key: string, ask?: import('./modelService').ModelAsk): Promise<string>
  /** The request to hand an agent (the composer's text) to design a card for a shape. */
  designPrompt(key: string): Promise<string>
}
