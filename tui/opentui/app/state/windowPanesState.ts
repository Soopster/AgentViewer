/** @jsxImportSource @opentui/react */
import { useRef, useState } from 'react'
import { type WindowSplitTree } from '../../windowSplitTree'
import { type WindowArrangement } from '../../windowLayout'
import { useWorkspaceState, useAppState, useWorkspaceRef } from '../../workspaceContext'
import { type ProtocolRunSnapshot } from '../../../../lib/agentProtocol'
import { SPLIT_SHARE_EVEN, type SplitPaneOrientation } from '../../splitPaneState'

export function useWindowPanesState() {
  const [railVisible, setRailVisible] = useAppState('railVisible', true)
  const [tabsEnabled, setTabsEnabled] = useState(true)
  const [tabOrientation, setTabOrientation] = useState<'horizontal' | 'vertical'>('horizontal')
  // Number of read-only split panes mounted beside the reader (0 = off), and
  // which of the other open tabs they start from.
  const [splitPaneCount, setSplitPaneCount] = useWorkspaceState('splitPaneCount', 0)
  // Panes are PINNED to explicit session keys, never derived positionally from
  // "the tabs that aren't active". A positional derivation reshuffles every
  // pane the moment the active tab changes (the candidate list reindexes), which
  // reads as panes randomly swapping while you navigate. The reconcile effect
  // below is the only thing that rewrites these keys.
  const [splitPinnedKeys, setSplitPinnedKeys] = useWorkspaceState<string[]>('splitPinnedKeys', [])
  // Which axis the split divides. Columns is the historical layout; rows is
  // what makes the split view reachable at all on a narrow terminal, where two
  // 46-column frames can never sit beside each other.
  const [splitOrientation, setSplitOrientation] = useWorkspaceState<SplitPaneOrientation>('splitOrientation', 'columns')
  // Reader's share of that axis. SPLIT_SHARE_EVEN keeps the even split every
  // layout had before the resize keys; anything else is a deliberate ⌃B < / >.
  const [splitReaderShare, setSplitReaderShare] = useWorkspaceState<number>('splitReaderShare', SPLIT_SHARE_EVEN)
  // Window arrangement of the reader and its panes (windowLayout.ts), and which
  // end of the split the reader sits at. Kept in tui.json beside the orientation.
  const [splitArrangement, setSplitArrangement] = useWorkspaceState<WindowArrangement>('splitArrangement', 'split')
  const [splitReaderLast, setSplitReaderLast] = useWorkspaceState('splitReaderLast', false)
  const [windowSplitTree, setWindowSplitTree] = useWorkspaceState<WindowSplitTree | null>('windowSplitTree', null)
  const [shelvedWindowKeys, setShelvedWindowKeys] = useWorkspaceState<Array<{ key: string; placement: 'window' | 'tab' | 'floating' | 'popover'; anchor?: string }>>('shelvedWindowKeys', [])
  const [treeDividerDrag, setTreeDividerDrag] = useState<string | null>(null)
  const treeDividerCheckpointedRef = useRef(false)
  const treeDividerActivePathRef = useRef<string | null>(null)
  const [coordinatorWorkspace, setCoordinatorWorkspace] = useWorkspaceState<ProtocolRunSnapshot | null>('coordinatorWorkspace', null, false)
  const [coordinatorWorkspaceRunId, setCoordinatorWorkspaceRunId] = useWorkspaceState<string | null>('coordinatorWorkspaceRunId', null)
  const watchedRosterRef = useWorkspaceRef<{ runId: string; keys: Set<string> } | null>('watchedRoster', null, true)

  return {
    railVisible, setRailVisible, tabsEnabled, setTabsEnabled, tabOrientation, setTabOrientation,
    splitPaneCount, setSplitPaneCount, splitPinnedKeys, setSplitPinnedKeys, splitOrientation,
    setSplitOrientation, splitReaderShare, setSplitReaderShare, splitArrangement,
    setSplitArrangement, splitReaderLast, setSplitReaderLast, windowSplitTree, setWindowSplitTree,
    shelvedWindowKeys, setShelvedWindowKeys,
    treeDividerDrag, setTreeDividerDrag, treeDividerCheckpointedRef, treeDividerActivePathRef,
    coordinatorWorkspace, setCoordinatorWorkspace, coordinatorWorkspaceRunId,
    setCoordinatorWorkspaceRunId, watchedRosterRef,
  }
}
