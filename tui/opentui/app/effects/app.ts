/** @jsxImportSource @opentui/react */
import type { WorkspaceContextValue } from '../../workspaceContext'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { type WindowGroupKey, type WindowArrangement } from '../../windowLayout'
import { readTuiSurfacePanelPlacement, readTuiWindowArrangement } from '../../../../lib/tui/service'

export type SurfacePlacementEffectContext = {
  workspaceContext: WorkspaceContextValue
  setSurfacePanelPlacement: React.Dispatch<React.SetStateAction<'right' | 'bottom'>>
  setSplitArrangement: React.Dispatch<React.SetStateAction<WindowArrangement>>
  setSplitReaderLast: React.Dispatch<React.SetStateAction<boolean>>
  setSplitSecondaryShare: React.Dispatch<React.SetStateAction<number>>
  setSplitBottomShare: React.Dispatch<React.SetStateAction<number>>
  setSplitWeights: React.Dispatch<React.SetStateAction<Partial<Record<WindowGroupKey, number[]>>>>
}

export function runSurfacePlacementEffect(ctx: SurfacePlacementEffectContext) {
  const {
    workspaceContext, setSurfacePanelPlacement, setSplitArrangement, setSplitReaderLast,
    setSplitSecondaryShare, setSplitBottomShare, setSplitWeights,
  } = ctx
  let cancelled = false
  void readTuiSurfacePanelPlacement().then((placement) => { if (!cancelled && !workspaceContext.runtime.restoredKeys.has('surfacePanelPlacement')) setSurfacePanelPlacement(placement) }).catch(() => {})
  void readTuiWindowArrangement().then((stored) => {
    if (cancelled) return
    if (workspaceContext.runtime.restoredKeys.has('splitArrangement') || workspaceContext.runtime.values.get('legacyInitialWorkspace') !== true) return
    setSplitArrangement(stored.arrangement)
    setSplitReaderLast(stored.readerLast)
    setSplitSecondaryShare(stored.secondaryShare)
    setSplitBottomShare(stored.bottomShare)
    setSplitWeights(stored.weights ?? {})
  }).catch(() => {})
  return () => { cancelled = true }
}
