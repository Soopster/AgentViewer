type PiLifecycleAssistant = {
  role: 'assistant'
  stopReason?: string
  errorMessage?: string
}

type PiLifecycleEvent = {
  type: string
  messages?: Array<{ role: string } | PiLifecycleAssistant>
}

export type PiTurnLifecycle = {
  terminalError?: string
  settled: boolean
}

/**
 * Pi may emit multiple agent_end events for one prompt when retries,
 * compaction, or extension-queued messages continue the run. Only
 * agent_settled is the terminal lifecycle boundary.
 */
export function reducePiTurnLifecycle(
  terminalError: string | undefined,
  event: PiLifecycleEvent,
): PiTurnLifecycle {
  if (event.type === 'agent_settled') return { terminalError, settled: true }
  if (event.type !== 'agent_end') return { terminalError, settled: false }

  const assistant = event.messages?.findLast(
    (message): message is PiLifecycleAssistant => message.role === 'assistant',
  )
  return {
    terminalError: assistant?.stopReason === 'error'
      ? assistant.errorMessage || 'Pi turn failed'
      : undefined,
    settled: false,
  }
}
