import { readTuiSessionMetadata, type TuiSessionMetadata } from '../../lib/tui/service'
import type { Session } from '../../lib/types'

type MetadataRequest = { id: number; session: Session }
type MetadataResponse =
  | { id: number; ok: true; metadata: TuiSessionMetadata }
  | { id: number; ok: false; error: string }

declare const self: {
  onmessage: ((event: MessageEvent<MetadataRequest>) => void) | null
  postMessage: (message: MetadataResponse) => void
}

self.onmessage = async (event) => {
  const { id, session } = event.data
  try {
    const metadata = await readTuiSessionMetadata(session)
    self.postMessage({ id, ok: true, metadata })
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
