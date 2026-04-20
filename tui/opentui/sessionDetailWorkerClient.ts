import type { TuiSessionDetail } from '../../lib/tui/service'
import { readTuiSessionDetailSource } from '../../lib/tui/service'
import type { Session } from '../../lib/types'
import { buildThreadedMessagesAsync } from './threadingWorkerClient'

export async function readTuiSessionDetailAsync(session: Session): Promise<TuiSessionDetail> {
  const { info, rawMessages } = await readTuiSessionDetailSource(session)
  const threadedMessages = await buildThreadedMessagesAsync(session, rawMessages)
  return {
    info,
    rawMessages,
    threadedMessages,
    contextUsage: null,
  }
}
