/** @jsxImportSource @opentui/react */
// Palette commands of one group, registered into the host command registry (../hostCommands.ts).
import { registerHostCommand } from '../hostCommands'
import type { ExecuteCommandPaletteContext } from '../commandPalette'
import { formatSessionTitle } from '../../../../format'
import { TASK_PANEL_RESIZE_STEP } from '../../layoutConstants'
import { sessionKey } from '../../sessionList'

registerHostCommand(['pr-watch'], (ctx, _id, locals) => {
  ctx.togglePrWatch(locals.focusedSession)
})

registerHostCommand(['pr-next-step'], (ctx, _id, locals) => {
  ctx.runPrNextStep(locals.focusedSession)
})

registerHostCommand(['new', 'new-scratch'], (ctx, id, locals) => {
    const { openNewSessionModal, openNewScratchSession } = ctx
    switch (id) {
      case 'new':
        openNewSessionModal()
        break
      case 'new-scratch':
        openNewScratchSession()
        break
    }
})

registerHostCommand(['provider'], (ctx, id, locals) => {
    const { openProviderMenu } = ctx
    switch (id) {
      case 'provider':
        openProviderMenu()
        break
    }
})

registerHostCommand(['attention'], (ctx, id, locals) => {
    const { setAttentionOpen } = ctx
    switch (id) {
      case 'attention':
        setAttentionOpen(true)
        break
    }
})

registerHostCommand(['next-attention'], (ctx, id, locals) => {
    const { jumpToNextAttention } = ctx
    switch (id) {
      case 'next-attention':
        jumpToNextAttention()
        break
    }
})

registerHostCommand(['session-search'], (ctx, id, locals) => {
    const { setFocusedPane, setSessionSearchMode } = ctx
    switch (id) {
      case 'session-search':
        setFocusedPane('sessions')
        setSessionSearchMode(true)
        break
    }
})

registerHostCommand(['fleet'], (ctx, id, locals) => {
    const { fleetStripEnabled, setFleetStripEnabled, showToggleOutcome } = ctx
    switch (id) {
      case 'fleet':
        {
        const next = !fleetStripEnabled
        setFleetStripEnabled(next)
        showToggleOutcome('Fleet strip', next)
        break
      }
    }
})

registerHostCommand(['fleet-prev'], (ctx, id, locals) => {
    const { fleetPageCount, setFleetPage } = ctx
    switch (id) {
      case 'fleet-prev':
        if (fleetPageCount > 1) setFleetPage((current) => (current - 1 + fleetPageCount) % fleetPageCount)
        break
    }
})

registerHostCommand(['fleet-next'], (ctx, id, locals) => {
    const { fleetPageCount, setFleetPage } = ctx
    switch (id) {
      case 'fleet-next':
        if (fleetPageCount > 1) setFleetPage((current) => (current + 1) % fleetPageCount)
        break
    }
})

registerHostCommand(['tasks'], (ctx, id, locals) => {
    const { setTaskPanelOpen, setTaskPanelTab } = ctx
    switch (id) {
      case 'tasks':
        setTaskPanelOpen(true)
        setTaskPanelTab('tasks')
        break
    }
})

registerHostCommand(['tasks-expand'], (ctx, id, locals) => {
    const { setTaskPanelExpanded } = ctx
    switch (id) {
      case 'tasks-expand':
        setTaskPanelExpanded((current) => !current)
        break
    }
})

registerHostCommand(['tasks-narrow'], (ctx, id, locals) => {
    const { resizeTaskPanel } = ctx
    switch (id) {
      case 'tasks-narrow':
        resizeTaskPanel(-TASK_PANEL_RESIZE_STEP)
        break
    }
})

registerHostCommand(['tasks-wide'], (ctx, id, locals) => {
    const { resizeTaskPanel } = ctx
    switch (id) {
      case 'tasks-wide':
        resizeTaskPanel(TASK_PANEL_RESIZE_STEP)
        break
    }
})

registerHostCommand(['plugins'], (ctx, id, locals) => {
    const { setPluginManagerOpen } = ctx
    switch (id) {
      case 'plugins':
        setPluginManagerOpen(true)
        break
    }
})

registerHostCommand(['rename'], (ctx, id, locals) => {
    const { setRenameDraft, setRenameSessionKey } = ctx
    const { focusedSession } = locals
    switch (id) {
      case 'rename':
        if (focusedSession) {
          setRenameSessionKey(sessionKey(focusedSession))
          setRenameDraft(formatSessionTitle(focusedSession))
        }
        break
    }
})

registerHostCommand(['sort'], (ctx, id, locals) => {
    const { showToggleOutcome, sidebarSort, toggleSidebarSort } = ctx
    switch (id) {
      case 'sort':
        toggleSidebarSort()
        showToggleOutcome('Sidebar sort:', sidebarSort === 'project' ? 'time' : 'project')
        break
    }
})

registerHostCommand(['scratch'], (ctx, id, locals) => {
    const { toggleHideScratch } = ctx
    switch (id) {
      case 'scratch':
        toggleHideScratch()
        break
    }
})

registerHostCommand(['lift-spaces'], (ctx) => {
    ctx.toggleLiftAcrossSpaces()
})

registerHostCommand(['settle'], (ctx, id, locals) => {
    const { toggleSelectedSessionSettled } = ctx
    switch (id) {
      case 'settle':
        toggleSelectedSessionSettled()
        break
    }
})

registerHostCommand(['settled'], (ctx, id, locals) => {
    const { toggleShowSettled } = ctx
    switch (id) {
      case 'settled':
        toggleShowSettled()
        break
    }
})

registerHostCommand(['sidebar-view'], (ctx, id, locals) => {
    const { setSidebarView, showToggleOutcome } = ctx
    switch (id) {
      case 'sidebar-view':
        setSidebarView((current) => {
          const next = current === 'sessions' ? 'coordinator' : 'sessions'
          showToggleOutcome('Sidebar view:', next)
          return next
        })
        break
    }
})

registerHostCommand(['shortcut-guide'], (ctx, id, locals) => {
    const { showNotice } = ctx
    switch (id) {
      case 'shortcut-guide':
        showNotice('info', 'Press ? at any time outside the composer to open this shortcut guide')
        break
    }
})

registerHostCommand(['refresh'], (ctx, id, locals) => {
    const { provider, refreshSelectedSessionDetail, refreshSessions, selectedSessionTarget } = ctx
    switch (id) {
      case 'refresh':
        void refreshSessions(provider)
        if (selectedSessionTarget) void refreshSelectedSessionDetail(selectedSessionTarget, false)
        break
    }
})

registerHostCommand(['quit'], (ctx, id, locals) => {
    const { requestExit } = ctx
    switch (id) {
      case 'quit':
        requestExit()
        break
    }
})
