import type { Session } from '../../lib/types'
import { isNativeComposerCommandText } from '../../lib/composerCommands'
import { windowSessionKey } from './windowTargets'

export type BroadcastDelivery = { mode: 'started' | 'steered' }
export type BroadcastResult = { key: string; session: Session; status: 'sent' | 'failed' | 'unknown'; detail: string }

export class BroadcastDeliveryError extends Error {
  constructor(message: string, readonly uncertain = false) { super(message) }
}

export function validateBroadcast(text: string, sessions: readonly Session[]): string | null {
  if (!text.trim()) return 'Write a prompt to broadcast'
  if (text.length > 20_000) return 'Broadcast prompts can have up to 20,000 characters'
  if (isNativeComposerCommandText(text.trim())) return 'Broadcast accepts prompt text; send slash commands and shell commands to a single session'
  if (!sessions.length) return 'Select at least one session window'
  if (sessions.some((session) => session.isPending)) return 'Start new sessions before broadcasting to them'
  if (new Set(sessions.map(windowSessionKey)).size !== sessions.length) return 'Each session can be selected only once'
  return null
}

/** Each captured destination is submitted once. Rejections never retry peers. */
export async function deliverWindowBroadcast(
  sessions: readonly Session[], text: string,
  send: (session: Session, text: string, requestId: string) => Promise<BroadcastDelivery>,
  onResult?: (result: BroadcastResult) => void,
): Promise<BroadcastResult[]> {
  const error = validateBroadcast(text, sessions)
  if (error) throw new Error(error)
  const prompt = text.trim()
  const snapshots = sessions.map((session) => ({ ...session }))
  const batch = globalThis.crypto.randomUUID()
  return Promise.all(snapshots.map(async (session, index) => {
    let result: BroadcastResult
    try {
      const delivery = await send(session, prompt, `${batch}:${index}`)
      result = { key: windowSessionKey(session), session, status: 'sent', detail: delivery.mode === 'steered' ? 'Delivered to running turn' : 'Turn started' }
    } catch (error) {
      const uncertain = !(error instanceof BroadcastDeliveryError) || error.uncertain
      result = { key: windowSessionKey(session), session, status: uncertain ? 'unknown' : 'failed', detail: error instanceof Error ? error.message : 'Delivery could not be confirmed' }
    }
    onResult?.(result)
    return result
  }))
}
