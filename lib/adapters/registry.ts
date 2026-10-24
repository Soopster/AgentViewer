// Compatibility facade. Provider extension registration owns lazy adapters now.
import type { AgentProvider } from '../types'
import type { SessionAdapter } from './types'
export { getSessionAdapter, assertAllAdapterCapabilities } from '../extensions/providers/registry'

/** Raises the way the pre-adapter branch did: naming the provider and the op,
 *  so a missing method reads as "this provider can't do that" rather than as a
 *  generic undefined-is-not-a-function further up the stack. */
export function unsupported(provider: AgentProvider, op: keyof SessionAdapter): never {
  throw new Error(`${String(op)} is not supported for ${provider} sessions`)
}
