/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import React from 'react'
import { fitText } from '../../textLayout'

export function WorktreeModalOverlay({ worktreeModalOpen, width, height, theme, worktreeDraft, setWorktreeDraft, submitWorktreeTask, worktreeBusy }: {
  worktreeModalOpen: boolean
  width: number
  height: number
  theme: TuiThemePalette
  worktreeDraft: string
  setWorktreeDraft: React.Dispatch<React.SetStateAction<string>>
  submitWorktreeTask: () => Promise<void>
  worktreeBusy: boolean
}) {
  return (
    worktreeModalOpen ? (() => {
        const overlayWidth = Math.min(Math.max(width - 6, 40), 64)
        const overlayHeight = 9
        return (
          <box
            position="absolute"
            top={Math.max(1, Math.floor((height - overlayHeight) / 2))}
            left={Math.max(1, Math.floor((width - overlayWidth) / 2))}
            width={overlayWidth}
            height={overlayHeight}
            border
            borderStyle="single"
            borderColor={theme.amber}
            backgroundColor={theme.surface}
            zIndex={70}
            flexDirection="column"
            title=" New worktree task "
            titleColor={theme.amber}
            titleAlignment="left"
          >
            <box paddingX={1} paddingTop={1}>
              <text fg={theme.dim} wrapMode="none">
                {fitText('Name the task — it gets its own branch + checkout.', overlayWidth - 4)}
              </text>
            </box>
            <box paddingX={1} marginTop={1} backgroundColor={theme.surface3}>
              <input
                focused
                value={worktreeDraft}
                maxLength={60}
                onInput={(value: string) => setWorktreeDraft(value)}
                onSubmit={() => { void submitWorktreeTask() }}
              />
            </box>
            <box paddingX={1} marginTop={1}>
              <text fg={worktreeBusy ? theme.amber : theme.dim} wrapMode="none">
                {fitText(worktreeBusy ? 'Creating worktree…' : '⏎ create · Esc cancel', overlayWidth - 4)}
              </text>
            </box>
          </box>
        )
      })() : null
  )
}
