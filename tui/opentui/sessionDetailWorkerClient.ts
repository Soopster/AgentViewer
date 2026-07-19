import type { TuiSessionDetail } from '../../lib/tui/service'
import type { Session } from '../../lib/types'
import type { TuiDensity } from '../theme'
import { readAndBuildTranscriptAsync } from './threadingWorkerClient'

export async function readTuiSessionDetailAsync(
  session: Session,
  density: TuiDensity,
  showToolCalls: boolean,
): Promise<TuiSessionDetail> {
  // Read + normalize + thread + format all happen in the worker; only the
  // finished payload crosses back to the main thread.
  const { info, rawMessages, threadedMessages } = await readAndBuildTranscriptAsync(
    session,
    density,
    showToolCalls,
  )
  return {
    info,
    rawMessages,
    threadedMessages,
    contextUsage: null,
  }
}

export { formatTranscriptCardsAsync, getTranscriptCardsSync, readTuiSessionsAsync } from './threadingWorkerClient'
