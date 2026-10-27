/** @jsxImportSource @opentui/react */
import type { ReactNode } from 'react'
import React from 'react'

type ComposerDockProps = {
  composerWindowOpen: boolean
  composerHidden: boolean
  presentationHidesComposer: boolean
  renderComposerStashPanel: (panelWidth: number, rowWidth: number) => React.ReactNode
  composerAreaWidth: number
}

export function ComposerDock(props: ComposerDockProps) {
  const {
    composerWindowOpen, composerHidden, presentationHidesComposer, renderComposerStashPanel,
    composerAreaWidth,
  } = props
  return (
    !composerWindowOpen && !composerHidden && !presentationHidesComposer ? renderComposerStashPanel(composerAreaWidth, Math.max(composerAreaWidth - 4, 20)) : null
  )
}
