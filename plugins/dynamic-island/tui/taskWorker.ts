import { taskActivities } from '../taskActivities'
import type { ObservedTranscript } from '../../../lib/plugins/observedTranscripts'

declare const self: { onmessage: ((event: MessageEvent<readonly ObservedTranscript[]>) => void) | null; postMessage: (value: unknown) => void }
self.onmessage = event => {
  try { self.postMessage({ items: taskActivities(event.data) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
