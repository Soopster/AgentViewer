/** @jsxImportSource @opentui/react */
// Palette commands of one group, registered into the host command registry (../hostCommands.ts).
import { registerHostCommand } from '../hostCommands'
import type { ExecuteCommandPaletteContext } from '../commandPalette'

registerHostCommand(['worktree-new'], (ctx, id, locals) => {
    const { setWorktreeDraft, setWorktreeModalOpen } = ctx
    switch (id) {
      case 'worktree-new':
        setWorktreeDraft('')
        setWorktreeModalOpen(true)
        break
    }
})

registerHostCommand(['worktree-merge'], (ctx, id, locals) => {
    const { selectedWorktreeTask, setWorktreeConfirm, showNotice } = ctx
    switch (id) {
      case 'worktree-merge':
        if (selectedWorktreeTask) setWorktreeConfirm('merge')
        else showNotice('info', 'Selected session is not a worktree task', 3500)
        break
    }
})

registerHostCommand(['worktree-discard'], (ctx, id, locals) => {
    const { selectedWorktreeTask, setWorktreeConfirm, showNotice } = ctx
    switch (id) {
      case 'worktree-discard':
        if (selectedWorktreeTask) setWorktreeConfirm('discard')
        else showNotice('info', 'Selected session is not a worktree task', 3500)
        break
    }
})

registerHostCommand(['coord-cleanup'], (ctx, id, locals) => {
    const { cleanupCompletedCoordinatedRunWorktrees } = ctx
    switch (id) {
      case 'coord-cleanup':
        void cleanupCompletedCoordinatedRunWorktrees()
        break
    }
})

registerHostCommand(['coord-stop'], (ctx, id, locals) => {
    const { stopActiveCoordinatedRun } = ctx
    switch (id) {
      case 'coord-stop':
        void stopActiveCoordinatedRun()
        break
    }
})
