/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'

export type ComposerPreferredTargetEffectContext = {
  composerPreferredTargetKey: string | null
  selectedSessionKey: string | null
  composerActive: boolean
  composerPreparingTargetKey: string | null
  newSessionModalOpen: boolean
  worktreeModalOpen: boolean
  setComposerPreferredTargetKey: React.Dispatch<React.SetStateAction<string | null>>
}

export function runComposerPreferredTargetEffect(ctx: ComposerPreferredTargetEffectContext) {
  const {
    composerPreferredTargetKey, selectedSessionKey, composerActive, composerPreparingTargetKey,
    newSessionModalOpen, worktreeModalOpen, setComposerPreferredTargetKey,
  } = ctx
  if (
    composerPreferredTargetKey !== null
    && (
      selectedSessionKey !== composerPreferredTargetKey
      || (
        !composerActive
        && composerPreparingTargetKey !== composerPreferredTargetKey
        && !newSessionModalOpen
        && !worktreeModalOpen
      )
    )
  ) {
    setComposerPreferredTargetKey(null)
  }
}
