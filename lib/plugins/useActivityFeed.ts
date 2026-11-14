import { useEffect, useSyncExternalStore } from 'react'
import type { ActivityInput, PluginActivityFeed } from './activityFeed'

export function useActivityPresentation(feed: PluginActivityFeed) {
  return useSyncExternalStore(feed.subscribePresentation, feed.isPresented, () => false)
}

/** Sources stay mounted for their legacy fallback even when no island is available. */
export function useActivitySource(feed: PluginActivityFeed, source: string, items: readonly ActivityInput[]) {
  const presented = useActivityPresentation(feed)
  useEffect(() => {
    if (!presented) return
    feed.replaceSource(source, items)
  }, [feed, source, items, presented])
  useEffect(() => () => feed.removeSource(source), [feed, source, presented])
  return presented
}

/** Preserve row order while expanded; defer timed expiry until the user closes. */
export function useExpandedActivity(feed: PluginActivityFeed) {
  const snapshot = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getServerSnapshot)
  useEffect(() => feed.hold(), [feed])
  return snapshot
}
