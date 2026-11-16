import type { ComposerTurnContext } from '../../lib/plugins/composer'

export type FeatureTip = { readonly id: string; readonly text: string }
export type DisplayedFeatureTip = FeatureTip & { readonly turnId: string }
export const TIP_DELAY_MS = 8_000
export const TIP_DURATION_MS = 20_000
export const TIP_COOLDOWN_MS = 300_000
export type TipClock = {
  now: () => number
  random: () => number
  schedule: (callback: () => void, delay: number) => () => void
}
const defaultClock: TipClock = {
  now: Date.now, random: Math.random,
  schedule(callback, delay) { const timer = setTimeout(callback, delay); return () => clearTimeout(timer) },
}

/** One renderer-local scheduler, independent of provider polling and React renders. */
export function createTipScheduler(clock: TipClock = defaultClock) {
  const seen = new Set<string>()
  const shown = new Set<string>()
  const remember = (id: string) => {
    seen.add(id)
    if (seen.size > 512) seen.delete(seen.values().next().value!)
  }
  const listeners = new Set<() => void>()
  let activeId: string | null = null
  let tip: DisplayedFeatureTip | null = null
  let eligible: readonly FeatureTip[] = []
  let lastShown = -Infinity
  let cancelTimer: (() => void) | undefined
  const publish = (next: DisplayedFeatureTip | null) => {
    if (tip === next) return
    tip = next
    for (const listener of listeners) listener()
  }
  const cancel = () => { cancelTimer?.(); cancelTimer = undefined; publish(null) }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => tip,
    cancel() { cancel(); activeId = null },
    update(turn: ComposerTurnContext | undefined, visible: boolean, tips: readonly FeatureTip[]) {
      eligible = tips
      if (!turn?.running || !visible || turn.needsAttention) {
        // A hidden or blocked turn must not replay when the composer returns.
        if (turn) remember(turn.id)
        cancel(); activeId = null; return
      }
      if (activeId === turn.id) {
        if (!eligible.length || (tip && !eligible.some(entry => entry.id === tip!.id))) cancel()
        return
      }
      cancel(); activeId = turn.id
      if (seen.has(turn.id)) return
      remember(turn.id)
      const elapsed = clock.now() - turn.startedAt
      if (elapsed < 0 || elapsed > TIP_DELAY_MS || clock.now() - lastShown < TIP_COOLDOWN_MS || !eligible.length || clock.random() >= .25) return
      cancelTimer = clock.schedule(() => {
        cancelTimer = undefined
        if (!eligible.length || clock.now() - lastShown < TIP_COOLDOWN_MS) return
        let pool = eligible.filter(entry => !shown.has(entry.id))
        if (!pool.length) { shown.clear(); pool = [...eligible] }
        const selected = pool[Math.min(pool.length - 1, Math.floor(clock.random() * pool.length))]!
        shown.add(selected.id); lastShown = clock.now(); publish({ ...selected, turnId: turn.id })
        cancelTimer = clock.schedule(() => { cancelTimer = undefined; publish(null) }, TIP_DURATION_MS)
      }, TIP_DELAY_MS - elapsed)
    },
  }
}
