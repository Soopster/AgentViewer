import type { ScrollBoxRenderable, Renderable } from '@opentui/core'
import type { TuiSessionReaderState } from '../../lib/tuiState'
import { useWorkspaceRef } from './workspaceContext'

export type TranscriptWindowPosition = {
  state: TuiSessionReaderState
  windowStart: number
  scrollTop: number
  anchorKey: string | null
  anchorOffset: number
  blockAnchorKey?: string
  blockAnchorOffset?: number
  searchQuery?: string
  searchMatchIndex?: number
  scrollbackExpanded?: boolean
  scrollbackToggledKeys?: string[]
  presentationExpandedKeys?: string[]
  /** Lightweight windows: how many persisted cards are loaded from the tail. */
  loadedCount?: number
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
        const findBlock = (parent: Renderable): Renderable | undefined => {
          for (const child of parent.getChildren() as Renderable[]) {
            if (child.height <= 0 || child.y - sb.content.y + child.height <= scrollTop) continue
            if (child.id.startsWith('virtual-row:')) return child
            const block = findBlock(child)
            if (block) return block
          }
          return undefined
        }
        const block = findBlock(node)
        return { scrollTop, anchorKey: node.id.slice(5), anchorOffset: offset,
          blockAnchorKey: block?.id, blockAnchorOffset: block ? block.y - sb.content.y - scrollTop : undefined }

      }
    } else {
      const children = node.getChildren()
      for (let index = children.length - 1; index >= 0; index--) nodes.push(children[index]!)
    }
  }
  return { scrollTop, anchorKey: null, anchorOffset: 0 }
}
