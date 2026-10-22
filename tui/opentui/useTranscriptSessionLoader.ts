import { useWorkspaceRef } from './workspaceContext'
import { readTuiSessionDetailAsync } from './sessionDetailWorkerClient'
import { TranscriptSessionLoader } from './transcriptSessionLoader'

export function useTranscriptSessionLoader() {
  return useWorkspaceRef('transcriptSessionLoader', new TranscriptSessionLoader(readTuiSessionDetailAsync)).current
}
