export type VelocityScrollKey = {
  eventType?: string
  repeated?: boolean
}

export type ScrollVelocityState = {
  direction: -1 | 0 | 1
  streak: number
  lastAt: number
}

const VELOCITY_RESET_MS = 180

export function createScrollVelocityState(): ScrollVelocityState {
  return { direction: 0, streak: 0, lastAt: 0 }
}

export function velocityScrollStep(
  state: ScrollVelocityState,
  direction: -1 | 1,
  key: VelocityScrollKey,
  maxStep: number,
  now = Date.now(),
): number {
  const continuing = state.direction === direction && now - state.lastAt <= VELOCITY_RESET_MS
  state.direction = direction
  state.streak = continuing ? state.streak + 1 : 0
  state.lastAt = now

  const repeating = key.repeated === true || key.eventType === 'repeat'
  if (!repeating && state.streak < 4) return 1

  const accelerated = state.streak < 5 ? 1
    : state.streak < 10 ? 2
      : state.streak < 16 ? 4
        : 8
  return Math.max(1, Math.min(accelerated, maxStep))
}
