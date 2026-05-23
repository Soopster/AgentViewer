import type { TuiSessionDetail } from '../../lib/tui/service'
import { readTuiSessionDetailSource } from '../../lib/tui/service'
import type { Session } from '../../lib/types'
import type { TuiDensity } from '../theme'
import { buildAndFormatTranscriptAsync } from './threadingWorkerClient'

export async function readTuiSessionDetailAsync(
  session: Session,
  density: TuiDensity,
  showToolCalls: boolean,
): Promise<TuiSessionDetail> {
  const { info, rawMessages } = await readTuiSessionDetailSource(session)
  const { threadedMessages } = await buildAndFormatTranscriptAsync(
    session,
    rawMessages,
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

export { formatTranscriptCardsAsync, getTranscriptCardsSync } from './threadingWorkerClient'
