import type { AgentProvider } from './types'

export type ComposerSteerPayload = {
  action: 'steer'
  message: string
  provider?: AgentProvider
  turnRequestId?: string
  steerRequestId: string
}

export type ComposerSteerResult = {
  delivered?: unknown
  messageUuid?: unknown
}

let fallbackSteerRequestCounter = 0

export function createSteerRequestId(): string {
  const randomUuid = globalThis.crypto?.randomUUID
  if (typeof randomUuid === 'function') return randomUuid.call(globalThis.crypto)
  fallbackSteerRequestCounter += 1
  return `steer-${Date.now()}-${Math.random().toString(36).slice(2)}-${fallbackSteerRequestCounter}`
}

/**
 * Retry an ambiguous steering transport failure with one stable request id.
 * The server deduplicates that id, so a response lost after provider delivery
 * cannot turn into a duplicate follow-up. A definite `delivered: false`
 * response is returned immediately and remains the caller's queue fallback.
 */
export async function deliverComposerSteer(
  send: (payload: ComposerSteerPayload) => Promise<ComposerSteerResult>,
  input: Omit<ComposerSteerPayload, 'action' | 'steerRequestId'>,
  retryCount = 1,
): Promise<ComposerSteerResult> {
  const payload: ComposerSteerPayload = {
    action: 'steer',
    ...input,
    steerRequestId: createSteerRequestId(),
  }
  let lastError: unknown
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await send(payload)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
