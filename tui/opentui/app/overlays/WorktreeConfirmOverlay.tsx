/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import { type WorktreeTask } from '../../../../lib/tui/service'
import { fitText } from '../../textLayout'

export function WorktreeConfirmOverlay({ worktreeConfirm, selectedWorktreeTask, width, height, theme }: {
  worktreeConfirm: 'merge' | 'discard' | null
  selectedWorktreeTask: WorktreeTask | null
  width: number
  height: number
  theme: TuiThemePalette
}) {
  return (
    worktreeConfirm && selectedWorktreeTask ? (() => {
        const overlayWidth = Math.min(Math.max(width - 6, 40), 66)
        const overlayHeight = 8
        const isMerge = worktreeConfirm === 'merge'
        const body = isMerge
          ? `Squash-merge ${selectedWorktreeTask.branch} into the main checkout (staged, not committed)?`
          : `Delete the worktree and branch ${selectedWorktreeTask.branch}? Uncommitted work is lost.`
        return (
          <box
            position="absolute"
            top={Math.max(1, Math.floor((height - overlayHeight) / 2))}
            left={Math.max(1, Math.floor((width - overlayWidth) / 2))}
            width={overlayWidth}
            height={overlayHeight}
            border
            borderStyle="single"
            borderColor={isMerge ? theme.green : theme.red}
            backgroundColor={theme.surface}
            zIndex={70}
            flexDirection="column"
          >
            <box paddingX={1} paddingTop={1}>
              <text fg={theme.text}>{isMerge ? 'MERGE WORKTREE TASK?' : 'DISCARD WORKTREE TASK?'}</text>
            </box>
            <box paddingX={1} marginTop={1}>
              <text fg={theme.dim} wrapMode="word" width={overlayWidth - 4}>{body}</text>
            </box>
            <box paddingX={1} marginTop={1}>
              <text fg={isMerge ? theme.green : theme.red} wrapMode="none">
                {fitText('Enter/Y confirm  ·  Esc/N cancel', overlayWidth - 4)}
              </text>
            </box>
          </box>
        )
      })() : null
  )
}
