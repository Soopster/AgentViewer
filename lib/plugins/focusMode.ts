/** Browser-safe Focus Mode contract: a timed block that holds what is not urgent, and the digest after. */
import type { PluginSessionRef } from './bookmarks'
import type { DeliveryChannel } from './deliveryGate'

export type FocusHeldItem = {
  readonly id: string
  readonly at: number
  readonly channel: DeliveryChannel
  readonly title: string
  readonly detail?: string
  readonly target?: PluginSessionRef
  readonly source?: string
}
export type FocusBlock = { readonly startedAt: number; readonly endsAt: number }
export type FocusState = {
  readonly active: FocusBlock | null
  readonly held: readonly FocusHeldItem[]
  /** The block that ended last, with what it held: the digest. */
  readonly last: (FocusBlock & { readonly endedAt: number; readonly held: readonly FocusHeldItem[] }) | null
}
export type FocusService = {
  read(signal?: AbortSignal): Promise<FocusState>
  start(minutes: number): Promise<FocusState>
  /** Ends the block now (or settles one that has run out); what it held becomes `last`. */
  end(): Promise<FocusState>
  hold(items: readonly FocusHeldItem[]): Promise<void>
  /** Clears the digest once it has been read. */
  clearDigest(): Promise<FocusState>
}

export const FOCUS_MIN_MINUTES = 1
export const FOCUS_MAX_MINUTES = 8 * 60
export const FOCUS_DEFAULT_MINUTES = 45
export const FOCUS_HELD_LIMIT = 200

/** `45`, `45m`, `1h`, `1h30m`, `90 min` → minutes; null when it is not a duration. */
export function parseFocusDuration(text: string): number | null {
  const value = text.trim().toLowerCase()
  if (!value) return FOCUS_DEFAULT_MINUTES
  const match = /^(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*(?:m|min|mins|minutes?)?)?$/.exec(value)
  if (!match || (!match[1] && !match[2])) return null
  const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
  if (minutes < FOCUS_MIN_MINUTES || minutes > FOCUS_MAX_MINUTES) return null
  return minutes
}

/** Is a block running at `now`. A block past its end is over even before anyone settles it. */
export const focusActive = (state: Pick<FocusState, 'active'> | null, now = Date.now()) => !!state?.active && now < state.active.endsAt

export function formatFocusRemaining(block: FocusBlock, now = Date.now()): string {
  const minutes = Math.max(0, Math.ceil((block.endsAt - now) / 60_000))
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ''}` : `${minutes}m`
}

export function focusDigestTitle(held: number): string {
  return held ? `Focus block over · ${held} held while you worked` : 'Focus block over · nothing was held'
}
