import type { TuiSessionDetail } from '../../lib/tui/service'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'
import type { TuiDensity } from '../theme'
import { readAndBuildTranscriptAsync } from './threadingWorkerClient'

export async function readTuiSessionDetailAsync(
  session: Session,
  density: TuiDensity,
  showToolCalls: boolean,
): Promise<TuiSessionDetail> {
  // Read + normalize + thread + format all happen in the worker; only the
  // finished payload crosses back to the main thread.
  const { info, rawMessages, threadedMessages, transcriptCards, externalWriter } = await readAndBuildTranscriptAsync(
    session,
    density,
    showToolCalls,
  )
  return {
    info,
    rawMessages,
    threadedMessages,
    transcriptCards,
    transcriptCardsDensity: density,
    transcriptCardsShowToolCalls: showToolCalls,
    contextUsage: null,
    externalWriter,
  }
}

/**
 * Use the worker-built cards carried by a detail only for the exact display
 * variant that produced them. This is the first-open and cache-revisit path;
 * density/tool-visibility changes still go through the worker variant cache.
 */
export function attachedTranscriptCardsForVariant(
  detail: TuiSessionDetail,
  density: TuiDensity,
  showToolCalls: boolean,
): TuiTranscriptCard[] | null {
  return detail.transcriptCardsDensity === density
    && detail.transcriptCardsShowToolCalls === showToolCalls
    ? detail.transcriptCards ?? null
    : null
}

export { formatTranscriptCardsAsync, getTranscriptCardsSync, readTuiSessionsAsync, warmTranscriptAsync } from './threadingWorkerClient'
