import type { ScrollBoxRenderable, Renderable } from '@opentui/core'
import type { TuiSessionReaderState } from '../../lib/tuiState'
import { useWorkspaceRef } from './workspaceContext'

export type TranscriptWindowPosition = {
  state: TuiSessionReaderState
  windowStart: number
  scrollTop: number
  anchorKey: string | null
  anchorOffset: number
  searchQuery?: string
  searchMatchIndex?: number
  scrollbackExpanded?: boolean
  scrollbackToggledKeys?: string[]
  presentationExpandedKeys?: string[]
}

/** One workspace-owned record per transcript, independent of its renderer or placement. */
export function useTranscriptWindowPositions() {
  // Retain the persisted key so existing workspace reading positions upgrade in place.
  return useWorkspaceRef('readerPositions', new Map<string, TranscriptWindowPosition>(), true)
}

export function transcriptViewportPosition(sb: ScrollBoxRenderable) {
  const scrollTop = sb.scrollTop
  const nodes: Renderable[] = [...sb.content.getChildren()].reverse()
  while (nodes.length) {
    const node = nodes.pop()!
    if (node.id?.startsWith('card:')) {
      const offset = node.y - sb.content.y - scrollTop
      if (node.height > 0 && offset + node.height > 0) {
        return { scrollTop, anchorKey: node.id.slice(5), anchorOffset: offset }
      }
    } else {
      const children = node.getChildren()
      for (let index = children.length - 1; index >= 0; index--) nodes.push(children[index]!)
    }
  }
  return { scrollTop, anchorKey: null, anchorOffset: 0 }
}
