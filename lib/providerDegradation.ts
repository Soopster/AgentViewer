import { getProviderCapabilities } from './provider'
import type { AgentProvider } from './types'

/**
 * What a feature does for a provider that cannot do it natively. A capability
 * flag answers "can it"; this answers "and if not, then what", so a surface
 * receives a typed plan instead of an error from whichever provider branch it
 * happened to hit.
 */
export type DegradableFeature = 'steer' | 'fork' | 'rewind'

export type FeaturePlan =
  | { mode: 'native' }
  | { mode: 'fallback'; strategy: FallbackStrategy; note: string }
  | { mode: 'unsupported'; reason: string }

export type FallbackStrategy =
  /** Cancel the running turn, then send the message as a fresh turn that carries it. */
  | 'interrupt_restart'
  /** Continue in a new session seeded with a brief of this conversation (`lib/handoffBrief.ts`). */
  | 'context_handoff'
  /** Fork at the message before the prompt and continue there. */
  | 'fork_before_prompt'

export function planFeature(provider: AgentProvider, feature: DegradableFeature): FeaturePlan {
  const capabilities = getProviderCapabilities(provider)
  if (feature === 'steer') {
    return capabilities.activeSteering
      ? { mode: 'native' }
      : { mode: 'fallback', strategy: 'interrupt_restart', note: 'This runtime cannot take input mid-turn; sending interrupts the turn and restarts it with your message.' }
  }
  if (feature === 'fork') {
    return capabilities.messageFork
      ? { mode: 'native' }
      : { mode: 'fallback', strategy: 'context_handoff', note: 'This runtime cannot fork; the copy starts fresh from a summary of this conversation.' }
  }
  // rewind: in place when the runtime can, else continue from a fork taken
  // before the prompt, else from a fresh session seeded with a brief.
  if (capabilities.inPlaceRewind) return { mode: 'native' }
  return capabilities.messageFork
    ? { mode: 'fallback', strategy: 'fork_before_prompt', note: 'Rewinds by continuing in a fork taken before that prompt.' }
    : { mode: 'fallback', strategy: 'context_handoff', note: 'Rewinds by starting a fresh session from a summary up to that prompt.' }
}
