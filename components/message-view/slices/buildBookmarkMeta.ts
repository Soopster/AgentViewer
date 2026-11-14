import type { RefObject } from 'react'
import type { Session } from '../../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import { useCallback } from 'react'
import { type SessionInfo, type SessionModelInfo } from '@/lib/types'
import { readJsonResponse } from '@/lib/httpResponse'
import { messageToCopyText } from '@/lib/threadedMessageText'
import { type TimelineRow, type CopilotContextTier } from '../types'
import { withProviderQuery } from '../threadedCompare'
import { normalizeSelectValue } from '../composerUi'
import { runToggleBookmark } from '../actions/sessionActions'

export type UseBuildBookmarkMetaGroupContext = {
  timelineRowsRef: RefObject<TimelineRow[]>
  sessionInfo: SessionInfo | null
  session: Session | null
  bookmarkIdsRef: RefObject<Set<string>>
  setBookmarkIds: Dispatch<SetStateAction<Set<string>>>
  setModelsLoading: Dispatch<SetStateAction<boolean>>
  setAvailableModels: Dispatch<SetStateAction<SessionModelInfo[]>>
  setSelectedCopilotContextTier: Dispatch<SetStateAction<CopilotContextTier | null>>
  setSelectedModel: Dispatch<SetStateAction<string>>
}

export function useBuildBookmarkMetaGroup(ctx: UseBuildBookmarkMetaGroupContext) {
  const {
    timelineRowsRef, sessionInfo, session, bookmarkIdsRef, setBookmarkIds, setModelsLoading,
    setAvailableModels, setSelectedCopilotContextTier, setSelectedModel,
  } = ctx

  // Build the metadata stored alongside a bookmark so the global browser can
  // render a useful row (title, snippet, role) without re-reading the session.
  const buildBookmarkMeta = useCallback((uuid: string) => {
    const row = timelineRowsRef.current.find((candidate) => candidate.message.uuid === uuid)
    const preview = row ? messageToCopyText(row.message).replace(/\s+/g, ' ').trim().slice(0, 200) : ''
    const sessionTitle = sessionInfo?.customTitle || sessionInfo?.summary || session?.customTitle || session?.summary || session?.firstPrompt
    return {
      role: row?.message.role,
      label: row?.message.role === 'user' ? 'user' : 'assistant',
      preview: preview || undefined,
      sessionTitle: sessionTitle || undefined,
      messageTimestamp: row?.message.timestamp,
    }
  }, [session?.customTitle, session?.summary, session?.firstPrompt, sessionInfo?.customTitle, sessionInfo?.summary])

  const toggleBookmark = useCallback((uuid: string) => runToggleBookmark({
    session, bookmarkIdsRef, setBookmarkIds, buildBookmarkMeta,
  }, uuid), [session, buildBookmarkMeta])

  // Fetches the live model list + current model from the active provider.
  // Used both on session change and after each turn — `/model X` slashes
  // change the SDK's current model and the dropdown should follow.
  const modelSessionId = session?.sessionId
  const modelSessionProvider = session?.provider
  const modelSessionProviderInstanceId = session?.providerInstanceId
  const refreshSessionModels = useCallback(({ preserveSelection }: { preserveSelection: boolean }) => {
    if (!modelSessionId) return
    setModelsLoading(true)
    fetch(withProviderQuery(`/api/sessions/${modelSessionId}/models`, modelSessionProvider, modelSessionProviderInstanceId))
      .then(readJsonResponse)
      .then(data => {
        if (data.error) return
        const nextModels = Array.isArray(data.models) ? data.models.filter((model: SessionModelInfo) => normalizeSelectValue(model.value)) : []
        setAvailableModels(nextModels)
        const live = normalizeSelectValue(data.currentModel)
        // Only a reported tier is a known tier; anything else leaves whatever
        // the user (or an earlier warm read) already established.
        if (data.currentContextTier === 'long_context' || data.currentContextTier === 'default') {
          setSelectedCopilotContextTier(data.currentContextTier)
        }
        setSelectedModel((prev) => {
          if (preserveSelection && prev && nextModels.some((m: SessionModelInfo) => normalizeSelectValue(m.value) === normalizeSelectValue(prev))) {
            // Keep user's pick if it is still valid; otherwise fall back.
            if (live && live !== normalizeSelectValue(prev)) return live
            return prev
          }
          return live ?? normalizeSelectValue(nextModels[0]?.value) ?? ''
        })
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false))
  }, [modelSessionId, modelSessionProvider, modelSessionProviderInstanceId, setAvailableModels, setModelsLoading, setSelectedModel, setSelectedCopilotContextTier])

  return {
    toggleBookmark, refreshSessionModels,
  }
}
