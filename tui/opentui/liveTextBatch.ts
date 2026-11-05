import type { ThreadedMessage } from '../../lib/threading'
import { liveMessageSessionKey, upsertThreadedMessage } from './liveTranscriptState'

type Publish = (update: (previous: ThreadedMessage[]) => ThreadedMessage[]) => void

/** Coalesce cumulative text snapshots, retaining the first-seen order of blocks.
 * Structural events must flush first so text cannot move across a tool/result.
 * Each send owns its queue and must cancel it in finally.
 */
export function createLiveTextBatch(publish: Publish, intervalMs: number) {
  const pending = new Map<string, ThreadedMessage>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    pending.clear()
  }
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (!pending.size) return
    const messages = [...pending.values()]
    pending.clear()
    publish(previous => messages.reduce(upsertThreadedMessage, previous))
  }
  return {
    push(message: ThreadedMessage) {
      pending.set(JSON.stringify([liveMessageSessionKey(message), message.uuid]), message)
      if (timer === undefined) timer = setTimeout(flush, intervalMs)
    },
    flush,
    cancel,
  }
}
