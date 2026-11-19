/** @jsxImportSource @opentui/react */
// Palette commands of one group, registered into the host command registry (../hostCommands.ts).
import { registerHostCommand } from '../hostCommands'
import type { ExecuteCommandPaletteContext } from '../commandPalette'
import { writeTuiTabsEnabled } from '../../../../../lib/tui/service'
import { SPLIT_CHORD_MAP } from '../../../chordHelp'

registerHostCommand(['surface-placement'], (ctx, id, locals) => {
    const { toggleSurfacePanelPlacement } = ctx
    switch (id) {
      case 'surface-placement':
        toggleSurfacePanelPlacement()
        break
    }
})

registerHostCommand(['window-layout'], (ctx, id, locals) => {
    const { setWindowPickerOpen } = ctx
    switch (id) {
      case 'window-layout':
        setWindowPickerOpen(true)
        break
    }
})

registerHostCommand(['composer-target'], (ctx, id, locals) => {
    switch (id) {
      case 'composer-target':
        ctx.openComposerTargetMenu()
        break
    }
})

registerHostCommand(['surface-to-tab'], (ctx, id, locals) => {
    switch (id) {
      case 'surface-to-tab':
        ctx.surfaceToTab()
        break
    }
})

registerHostCommand(['window-terminal'], (ctx, id, locals) => {
    const { openSurfaceWindow } = ctx
    switch (id) {
      case 'window-terminal':
        openSurfaceWindow('terminal')
        break
    }
})

registerHostCommand(['window-diff'], (ctx, id, locals) => {
    const { gitRepoCwd, openSurfaceWindow, showNotice } = ctx
    switch (id) {
      case 'window-diff':
        if (gitRepoCwd) openSurfaceWindow('diff')
        else showNotice('info', 'The diff needs a git repository')
        break
    }
})

registerHostCommand(['window-files'], (ctx, id, locals) => {
    const { gitRepoCwd, openSurfaceWindow, showNotice } = ctx
    switch (id) {
      case 'window-files':
        if (gitRepoCwd) openSurfaceWindow('files')
        else showNotice('info', 'Files need a git repository')
        break
    }
})

registerHostCommand(['window-terminal-new'], (ctx, id, locals) => {
    const { openSurfaceWindow } = ctx
    switch (id) {
      case 'window-terminal-new':
        openSurfaceWindow('terminal', { another: true })
        break
    }
})

registerHostCommand(['window-browser'], (ctx, id, locals) => {
    const { openSurfaceWindow } = ctx
    switch (id) {
      case 'window-browser':
        openSurfaceWindow('browser')
        break
    }
})

registerHostCommand(['window-pull-request'], (ctx, id, locals) => {
    const { gitRepoCwd, openSurfaceWindow, showNotice } = ctx
    switch (id) {
      case 'window-pull-request':
        if (gitRepoCwd) openSurfaceWindow('pull-request')
        else showNotice('info', 'Pull requests need a git repository')
        break
    }
})

registerHostCommand(['window-agents'], (ctx, id, locals) => {
    const { openSurfaceWindow } = ctx
    switch (id) {
      case 'window-agents':
        openSurfaceWindow('agents')
        break
    }
})

registerHostCommand(['tab-coordination'], (ctx, id, locals) => {
    const { openPopoverWindow } = ctx
    switch (id) {
      case 'tab-coordination':
        openPopoverWindow('coordination', undefined, 'tab')
        break
    }
})

registerHostCommand(['tab-editor'], (ctx, id, locals) => {
    const { openPopoverWindow } = ctx
    switch (id) {
      case 'tab-editor':
        openPopoverWindow('editor', undefined, 'tab')
        break
    }
})

registerHostCommand(['window-float'], (ctx, id, locals) => {
    const { toggleFloatingFocused } = ctx
    switch (id) {
      case 'window-float':
        toggleFloatingFocused()
        break
    }
})

registerHostCommand(['window-float-shell'], (ctx, id, locals) => {
    const { floatNewShell } = ctx
    switch (id) {
      case 'window-float-shell':
        floatNewShell()
        break
    }
})

registerHostCommand(['tab-toggle'], (ctx, id, locals) => {
    const { setError, setTabsEnabled, showToggleOutcome, tabsEnabled } = ctx
    const { persistPreference } = locals
    switch (id) {
      case 'tab-toggle':
        {
        const next = !tabsEnabled
        setTabsEnabled(next)
        showToggleOutcome('Tab bar', next)
        void persistPreference(() => writeTuiTabsEnabled(next)).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store tab setting'))
        break
      }
    }
})

registerHostCommand(['split-add'], (ctx, id, locals) => {
    const { addSplitPane } = ctx
    switch (id) {
      case 'split-add':
        addSplitPane('columns')
        break
    }
})

registerHostCommand(['split-add-stacked'], (ctx, id, locals) => {
    const { addSplitPane } = ctx
    switch (id) {
      case 'split-add-stacked':
        addSplitPane('rows')
        break
    }
})

registerHostCommand(['split-rotate'], (ctx, id, locals) => {
    const { rotateSplitOrientation } = ctx
    switch (id) {
      case 'split-rotate':
        rotateSplitOrientation()
        break
    }
})

registerHostCommand(['split-grow-reader'], (ctx, id, locals) => {
    const { resizeSplitReader } = ctx
    switch (id) {
      case 'split-grow-reader':
        resizeSplitReader(1)
        break
    }
})

registerHostCommand(['split-shrink-reader'], (ctx, id, locals) => {
    const { resizeSplitReader } = ctx
    switch (id) {
      case 'split-shrink-reader':
        resizeSplitReader(-1)
        break
    }
})

registerHostCommand(['split-even'], (ctx, id, locals) => {
    const { resizeSplitReader } = ctx
    switch (id) {
      case 'split-even':
        resizeSplitReader(0)
        break
    }
})

registerHostCommand(['window-next-attention'], (ctx, id, locals) => {
    const { jumpToNextWindowAttention } = ctx
    switch (id) {
      case 'window-next-attention':
        jumpToNextWindowAttention()
        break
    }
})

registerHostCommand(['window-identify'], (ctx, id, locals) => {
    const { enterWindowControls } = ctx
    switch (id) {
      case 'window-identify':
        enterWindowControls('identify')
        break
    }
})

registerHostCommand(['window-manage'], (ctx, id, locals) => {
    const { enterWindowControls } = ctx
    switch (id) {
      case 'window-manage':
        enterWindowControls('manage')
        break
    }
})

registerHostCommand(['window-menu'], (ctx, id, locals) => {
    const { focusedControlKey, openWindowControlMenu } = ctx
    switch (id) {
      case 'window-menu':
        openWindowControlMenu(focusedControlKey())
        break
    }
})

registerHostCommand(['window-switcher'], (ctx, id, locals) => {
    const { setRecentWindowsOnly, setWindowSwitcherOpen } = ctx
    switch (id) {
      case 'window-switcher':
        setRecentWindowsOnly(false); setWindowSwitcherOpen(true)
        break
    }
})

registerHostCommand(['window-broadcast'], (ctx, id, locals) => {
    const { setWindowBroadcastOpen } = ctx
    switch (id) {
      case 'window-broadcast':
        setWindowBroadcastOpen(true)
        break
    }
})

registerHostCommand(['window-stop-coordinator'], (ctx, id, locals) => {
    const { checkpointWindowLayout, coordinatorWorkspaceRunId, setCoordinatorWorkspace, setCoordinatorWorkspaceRunId, showNotice } = ctx
    switch (id) {
      case 'window-stop-coordinator':
        if (coordinatorWorkspaceRunId) {
          checkpointWindowLayout()
          setCoordinatorWorkspace(null)
          setCoordinatorWorkspaceRunId(null)
          showNotice('info', 'Stopped watching the run · windows remain open')
        } else showNotice('info', 'No Coordinator run is being watched')
        break
    }
})

registerHostCommand(['workspaces-toggle'], (ctx, id, locals) => {
    const { toggleWorkspaces } = ctx
    switch (id) {
      case 'workspaces-toggle':
        toggleWorkspaces()
        break
    }
})

registerHostCommand(['spaces-switcher'], (ctx, id, locals) => {
    const { openSpaces } = ctx
    switch (id) {
      case 'spaces-switcher':
        openSpaces()
        break
    }
})

registerHostCommand(['window-redo', 'window-reopen', 'window-recent', 'window-previous', 'window-undo'], (ctx, id, locals) => {
    const { focusPreviousWindow, openRecentWindows, redoWindowLayout, reopenClosedWindow, undoWindowLayout } = ctx
    switch (id) {
      case 'window-redo':
      case 'window-reopen':
      case 'window-recent':
      case 'window-previous':
      case 'window-undo':
        redoWindowLayout(); break
        reopenClosedWindow(); break
        openRecentWindows(); break
        focusPreviousWindow(); break
        undoWindowLayout()
        break
    }
})

registerHostCommand(['split-help'], (ctx, id, locals) => {
    const { setChordHelp } = ctx
    switch (id) {
      case 'split-help':
        setChordHelp({ map: SPLIT_CHORD_MAP, dismissOnKey: true })
        break
    }
})

registerHostCommand(['split-close'], (ctx, id, locals) => {
    const { closeSplitPane } = ctx
    switch (id) {
      case 'split-close':
        closeSplitPane()
        break
    }
})

registerHostCommand(['split-toggle'], (ctx, id, locals) => {
    const { toggleSplitPanes } = ctx
    switch (id) {
      case 'split-toggle':
        toggleSplitPanes()
        break
    }
})

registerHostCommand(['split-focus'], (ctx, id, locals) => {
    const { cycleSplitFocus } = ctx
    switch (id) {
      case 'split-focus':
        cycleSplitFocus(1)
        break
    }
})

registerHostCommand(['split-focus-prev'], (ctx, id, locals) => {
    const { cycleSplitFocus } = ctx
    switch (id) {
      case 'split-focus-prev':
        cycleSplitFocus(-1)
        break
    }
})

registerHostCommand(['split-flip'], (ctx, id, locals) => {
    const { focusPreviousWindow } = ctx
    switch (id) {
      case 'split-flip':
        focusPreviousWindow()
        break
    }
})

registerHostCommand(['split-focus-back'], (ctx, id, locals) => {
    const { focusReaderFromSplit } = ctx
    switch (id) {
      case 'split-focus-back':
        focusReaderFromSplit()
        break
    }
})

registerHostCommand(['split-cycle'], (ctx, id, locals) => {
    const { cycleSplitPaneSession } = ctx
    switch (id) {
      case 'split-cycle':
        cycleSplitPaneSession()
        break
    }
})

registerHostCommand(['tab-prev'], (ctx, id, locals) => {
    const { activeStripIndex, selectStripIndex, setFocusedPane } = ctx
    switch (id) {
      case 'tab-prev':
        {
        setFocusedPane('messages')
        selectStripIndex(Math.max(activeStripIndex - 1, 0))
        break
      }
    }
})

registerHostCommand(['tab-next'], (ctx, id, locals) => {
    const { activeStripIndex, selectStripIndex, setFocusedPane, tabStripLength } = ctx
    switch (id) {
      case 'tab-next':
        {
        setFocusedPane('messages')
        selectStripIndex(Math.min(activeStripIndex + 1, tabStripLength - 1))
        break
      }
    }
})

registerHostCommand(['tab-close'], (ctx, id, locals) => {
    const { closePopoverTab, closeSessionTab, selectedSession, shownPopoverTab } = ctx
    switch (id) {
      case 'tab-close':
        {
        if (shownPopoverTab) closePopoverTab(shownPopoverTab)
        else if (selectedSession) closeSessionTab(selectedSession)
        break
      }
    }
})
