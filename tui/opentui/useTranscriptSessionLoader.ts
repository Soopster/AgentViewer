import { useMemo } from 'react'
import { useWorkspaceContext } from './workspaceContext'
import { readTuiSessionDetailAsync, retainTranscriptSession } from './sessionDetailWorkerClient'
import { TranscriptSessionLoader } from './transcriptSessionLoader'
import { mainTranscriptBudget } from './sessionCacheBudget'

export function useTranscriptSessionLoader() {
  const runtime = useWorkspaceContext()?.runtime
  return useMemo(() => runtime
    ? runtime.get('ref:transcriptSessionLoader', () => new TranscriptSessionLoader(readTuiSessionDetailAsync, 8, 64 * 1024 * 1024, 2500, retainTranscriptSession, mainTranscriptBudget), false)
    : new TranscriptSessionLoader(readTuiSessionDetailAsync, 8, 64 * 1024 * 1024, 2500, retainTranscriptSession, mainTranscriptBudget), [runtime])
}
