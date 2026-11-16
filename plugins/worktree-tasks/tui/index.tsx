/** @jsxImportSource @opentui/react */
// TUI entry for the worktree task dialogs: loaded the first time one opens.
import { useEffect } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { fitText, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'

const NEW_TASK_Z_INDEX = 70

function NewWorktreeTask({ services, theme, width, height, registerKeys }: TuiPluginViewProps) {
  const worktrees = services['worktree-tasks']!
  useEffect(() => {
    registerKeys((key) => {
      if (key.name === 'escape') { worktrees.cancel(); return true }
      if (key.name === 'return') { void worktrees.submit(); return true }
      // Everything else is the name field's.
      return false
    })
    return () => registerKeys(null)
  }, [registerKeys, worktrees])
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
      zIndex={NEW_TASK_Z_INDEX}
      flexDirection="column"
      title=" New worktree task "
      titleColor={theme.amber}
      titleAlignment="left"
    >
      <box paddingX={1} paddingTop={1}>
        <text fg={theme.dim} wrapMode="none">{fitText('Name the task — it gets its own branch + checkout.', overlayWidth - 4)}</text>
      </box>
      <box paddingX={1} marginTop={1} backgroundColor={theme.surface3}>
        <input focused value={worktrees.draft} maxLength={60} onInput={(value: string) => worktrees.setDraft(value)} onSubmit={() => { void worktrees.submit() }} />
      </box>
      <box paddingX={1} marginTop={1}>
        <text fg={worktrees.busy ? theme.amber : theme.dim} wrapMode="none">{fitText(worktrees.busy ? 'Creating worktree…' : '⏎ create · Esc cancel', overlayWidth - 4)}</text>
      </box>
    </box>
  )
}

function ConfirmWorktreeTask({ services, theme, width, height, registerKeys }: TuiPluginViewProps) {
  const worktrees = services['worktree-tasks']!
  useEffect(() => {
    registerKeys((key) => {
      if (key.name === 'return' || key.name === 'y') { worktrees.confirmPending(); return true }
      if (key.name === 'escape' || key.name === 'n') { worktrees.dismissPending(); return true }
      // A confirmation swallows every other key: nothing under it may act while it is asking.
      return true
    })
    return () => registerKeys(null)
  }, [registerKeys, worktrees])
  const pending = worktrees.pending
  if (!pending || !worktrees.task) return null
  const overlayWidth = Math.min(Math.max(width - 6, 40), 66)
  const overlayHeight = 8
  const isMerge = pending === 'merge'
  const body = isMerge
    ? `Squash-merge ${worktrees.task.branch} into the main checkout (staged, not committed)?`
    : `Delete the worktree and branch ${worktrees.task.branch}? Uncommitted work is lost.`
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
      zIndex={NEW_TASK_Z_INDEX}
      flexDirection="column"
    >
      <box paddingX={1} paddingTop={1}><text fg={theme.text}>{isMerge ? 'MERGE WORKTREE TASK?' : 'DISCARD WORKTREE TASK?'}</text></box>
      <box paddingX={1} marginTop={1}><text fg={theme.dim} wrapMode="word" width={overlayWidth - 4}>{body}</text></box>
      <box paddingX={1} marginTop={1}><text fg={isMerge ? theme.green : theme.red} wrapMode="none">{fitText('Enter/Y confirm  ·  Esc/N cancel', overlayWidth - 4)}</text></box>
    </box>
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'worktree-tasks',
  views: { 'worktree-new': NewWorktreeTask, 'worktree-confirm': ConfirmWorktreeTask },
}
