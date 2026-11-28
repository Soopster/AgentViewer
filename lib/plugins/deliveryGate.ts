// One place every interruption passes before it reaches the person: toasts and
// island rows (the notification center), application notices and desktop
// notifications, teammate alerts. A gate (Focus Mode) may hold what is not
// urgent; with no gate everything is delivered, exactly as before. Browser-safe
// and process-local: each renderer has its own.
import type { PluginSessionRef } from './bookmarks'

export type DeliveryChannel = 'toast' | 'notice' | 'desktop'
export type DeliveryItem = {
  readonly channel: DeliveryChannel
  /** Asks something of the person (an approval, a question, a failure): never held. */
  readonly urgent: boolean
  readonly title: string
  readonly detail?: string
  readonly target?: PluginSessionRef
  readonly source?: string
}
/** True when the gate takes the item: the caller then delivers nothing. */
export type DeliveryGate = (item: DeliveryItem) => boolean

let gate: DeliveryGate | null = null

export function setDeliveryGate(next: DeliveryGate): () => void {
  gate = next
  return () => { if (gate === next) gate = null }
}

/** Ask before delivering. An urgent item is never offered to the gate at all. */
export function holdDelivery(item: DeliveryItem): boolean {
  if (item.urgent || !gate) return false
  try { return gate(item) } catch { return false }
}
