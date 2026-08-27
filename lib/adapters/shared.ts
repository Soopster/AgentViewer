// Helpers every adapter needs, and the composer's permission-mode vocabularies.
//
// The permission options live here rather than in each adapter because they
// are the *contract with the UI*, not provider internals: the composer renders
// whatever list it is handed, so keeping the four vocabularies side by side is
// what makes it obvious that `native` means "this provider owns its own
// approval policy and gives us no knob", not "we haven't wired it up yet".

import type { SessionComposerOptions, SessionMessage } from '../types'

/** Stable chronological sort: messages without a parseable timestamp keep
 *  their existing relative order rather than being shuffled to one end. */
export function sortMessagesChronologically(messages: SessionMessage[]): SessionMessage[] {
  return messages.toSorted((a, b) => {
    const aTimestamp = a.timestamp ? Date.parse(a.timestamp) : Number.NaN
    const bTimestamp = b.timestamp ? Date.parse(b.timestamp) : Number.NaN
    if (!Number.isNaN(aTimestamp) && !Number.isNaN(bTimestamp) && aTimestamp !== bTimestamp) {
      return aTimestamp - bTimestamp
    }
    return 0
  })
}

/** Tag messages with an origin only where one isn't already set, so a nested
 *  read (a subagent transcript) can't relabel messages that already carry a
 *  more specific origin from the mapper. */
export function withOriginKind(messages: SessionMessage[], originKind: string): SessionMessage[] {
  return messages.map((message) => ({
    ...message,
    origin: message.origin ?? { kind: originKind },
  }))
}

export const CLAUDE_PERMISSION_MODE_OPTIONS = [
  { value: 'default', label: 'DEFAULT', description: 'Use the session permission policy.' },
  { value: 'acceptEdits', label: 'ACCEPT EDITS', description: 'Approve file edits while prompting for other tools.' },
  { value: 'plan', label: 'PLAN', description: 'Plan without making changes.' },
  { value: 'bypassPermissions', label: 'BYPASS', description: 'Run tools without permission prompts.' },
] satisfies NonNullable<SessionComposerOptions['permissionModes']>

export const CODEX_PERMISSION_MODE_OPTIONS = [
  { value: 'auto', label: 'CONFIG', description: 'Use the app-server configured approval policy.' },
  { value: 'untrusted', label: 'UNTRUSTED', description: 'Only trusted operations run without approval.' },
  { value: 'on-request', label: 'ON REQUEST', description: 'Ask when the agent requests elevated execution.' },
  { value: 'never', label: 'NEVER', description: 'Never request approval.' },
] satisfies NonNullable<SessionComposerOptions['permissionModes']>

export const COPILOT_PERMISSION_MODE_OPTIONS = [
  { value: 'off', label: 'PROMPT', description: 'Use the normal permission approval flow.' },
  { value: 'auto', label: 'AUTO', description: 'Attach Copilot safety recommendations to requests.' },
  { value: 'on', label: 'ALLOW ALL', description: 'Automatically approve tool, path, and URL requests.' },
] satisfies NonNullable<SessionComposerOptions['permissionModes']>

export const PROVIDER_MANAGED_PERMISSION_OPTIONS = [
  { value: 'native', label: 'NATIVE', description: 'Permissions are managed by the provider.' },
] satisfies NonNullable<SessionComposerOptions['permissionModes']>

/** Bounded-concurrency map. Provider reads fan out per session or per subagent;
 *  an unbounded Promise.all over a few hundred of those opens a few hundred
 *  file handles or RPC calls at once. */
export async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}
