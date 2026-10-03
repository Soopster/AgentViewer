/// <reference lib="webworker" />

import { exportSessionToHtml } from '@/lib/export'
import type { Session, SessionMessage } from '@/lib/types'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = (event: MessageEvent<{ session: Session; messages: SessionMessage[] }>) => {
  try {
    const { session, messages } = event.data
    const html = exportSessionToHtml(session, messages)
    self.postMessage({ html })
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Failed to export session',
    })
  }
}

export {}
