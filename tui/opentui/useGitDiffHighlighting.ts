import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { FileDiffMetadata } from '@pierre/diffs'
import { diffDisplayPath, type DiffFileSpanHighlights } from './pierreDiffView'
import { createGitDiffHighlightClient, diffHighlightTarget } from './gitDiffHighlightWorkerClient'

export function useGitDiffHighlighting(files: FileDiffMetadata[] | undefined, rows: readonly { filePath?: string }[], start: number, end: number, appearance: 'dark' | 'light', enabled: boolean) {
  const [client] = useState(() => createGitDiffHighlightClient())
  const revision = useSyncExternalStore(client.subscribe, client.getRevision, client.getRevision)
  const targets = useMemo(() => {
    if (!enabled || !files) return []
    const paths = new Set(rows.slice(start, end).map(row => row.filePath).filter(Boolean))
    return files.filter(file => paths.has(diffDisplayPath(file))).slice(0, 12)
      .map(file => diffHighlightTarget(file, diffDisplayPath(file), appearance))
  }, [appearance, enabled, end, files, rows, start])
  useEffect(() => { client.setWindow(targets) }, [client, targets])
  useEffect(() => () => client.dispose(), [client])
  return useMemo(() => {
    const result = new Map<string, DiffFileSpanHighlights>()
    for (const target of targets) {
      const value = client.peek(target.key)
      if (value) result.set(target.path, value)
    }
    return result
  }, [client, revision, targets])
}
