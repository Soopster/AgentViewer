/** Browser-safe Adaptive UI contract. Rules and shapes live where the transcript read path runs; this is how a view reaches them. */
import type { CardRule, CardRuleStatus } from './cardTemplates'
import type { ShapeRecord } from '../adaptiveUi/shapes'
export type AdaptiveUiSnapshot = {
  readonly dir: string
  readonly rules: readonly CardRule[]
  readonly invalid: readonly { readonly file: string; readonly problems: readonly string[] }[]
  readonly shapes: readonly ShapeRecord[]
  /** Calls by tool since the process started, for suggestions. */
  readonly usage: readonly { readonly tool: string; readonly completed: number; readonly failed: number }[]
  readonly settings: { readonly autoDraft: boolean; readonly autoDraftAfter: number }
}
export type AdaptiveUiService = {
  scan(signal?: AbortSignal): Promise<AdaptiveUiSnapshot>
  setStatus(id: string, status: CardRuleStatus): Promise<void>
  remove(id: string): Promise<void>
  dismissShape(key: string, dismissed: boolean): Promise<void>
  /** The request to hand an agent (the composer's text) to design a card for a shape. */
  designPrompt(key: string): Promise<string>
}
