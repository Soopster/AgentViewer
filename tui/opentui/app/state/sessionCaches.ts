/** @jsxImportSource @opentui/react */
import { useRef, useState } from 'react'
import { TranscriptDetailCache } from '../../transcriptDetailCache'
import { type ContextUsage } from '../../../../lib/types'

export function useSessionCaches() {
  const [ownedDetailCache] = useState(() => new TranscriptDetailCache())
  const sessionDetailCacheRef = useRef(ownedDetailCache)
  const sessionContextUsageCacheRef = useRef(new Map<string, ContextUsage | null>())
  const sessionMetadataFetchedAtRef = useRef(new Map<string, number>())
  const sessionMetadataInFlightRef = useRef(new Set<string>())

  return {
    sessionDetailCacheRef, sessionContextUsageCacheRef, sessionMetadataFetchedAtRef,
    sessionMetadataInFlightRef,
  }
}
