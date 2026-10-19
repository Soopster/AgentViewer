import type { Session } from '../../lib/types'
import { beginDetachedTurnDrain } from '../../lib/crossSessionMessaging'
import { listTuiRunningSessions, runTuiSessionAction, streamTuiSessionTurn } from '../../lib/tui/service'
import { BroadcastDeliveryError, type BroadcastDelivery } from './windowBroadcast'

/** Address sessions directly, including older windows and configured accounts. */
export async function sendWindowBroadcastPrompt(session: Session, text: string, requestId: string, settings: Record<string, unknown> = {}): Promise<BroadcastDelivery> {
  const running = (await listTuiRunningSessions()).some((entry) => entry.sessionId === session.sessionId && entry.provider === (session.provider ?? 'claude'))
  if (running) {
    const result = await runTuiSessionAction(session, {
      action: 'steer', message: text, steerRequestId: requestId, allowInterrupt: false,
    })
    if (result.delivered === true) return { mode: 'steered' }
    throw new BroadcastDeliveryError(result.deliveryUncertain === true ? 'Could not confirm steering; inspect this session before sending again' : 'The session is busy and did not accept input; wait for its turn to finish', result.deliveryUncertain === true)
  }
  const response = await streamTuiSessionTurn(session, {
    ...settings, message: text, provider: session.provider, cwd: session.cwd,
    turnRequestId: requestId, detachOnClientAbort: true,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new BroadcastDeliveryError(body?.error || `Could not start turn (HTTP ${response.status})`)
  }
  const drain = beginDetachedTurnDrain(response)
  void drain.completion.catch(() => {})
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      drain.accepted,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new BroadcastDeliveryError('No delivery receipt yet; inspect this session before sending again', true)), 60_000)
      }),
    ])
    return { mode: 'started' }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
