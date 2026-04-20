import { readTuiSessionMetadata, type TuiSessionMetadata } from '../../lib/tui/service'
import type { ContextUsage } from '../../lib/types'
import type { Session } from '../../lib/types'

type MetadataRequest = { id: number; session: Session }
type MetadataResponse =
  | { id: number; ok: true; metadata: { currentModel: string | null; contextUsage: ContextUsage | null } }
  | { id: number; ok: false; error: string }

declare const self: {
  onmessage: ((event: MessageEvent<MetadataRequest>) => void) | null
  postMessage: (message: MetadataResponse) => void
}

self.onmessage = async (event) => {
  const { id, session } = event.data
  try {
    const metadata = await readTuiSessionMetadata(session)
    self.postMessage({
      id,
      ok: true,
      metadata: {
        currentModel: metadata.currentModel,
        contextUsage: metadata.contextUsage,
      },
    })
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
