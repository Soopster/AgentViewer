/** @jsxImportSource @opentui/react */
// Palette commands of one group, registered into the host command registry (../hostCommands.ts).
import { registerHostCommand } from '../hostCommands'
import type { ExecuteCommandPaletteContext } from '../commandPalette'

registerHostCommand(['move-prev'], (ctx, id, locals) => {
    const { effectiveFocus, moveAgentToolCursor, moveCoordinatorSelection, moveCursor, moveSelection, setFocusedPane, sidebarView } = ctx
    switch (id) {
      case 'move-prev':
        if (effectiveFocus === 'sessions') {
          if (sidebarView === 'coordinator') moveCoordinatorSelection(-1)
          else moveSelection(-1)
        } else {
          setFocusedPane('messages')
          if (!moveAgentToolCursor(-1)) moveCursor(-1)
        }
        break
    }
})

registerHostCommand(['move-next'], (ctx, id, locals) => {
    const { effectiveFocus, moveAgentToolCursor, moveCoordinatorSelection, moveCursor, moveSelection, setFocusedPane, sidebarView } = ctx
    switch (id) {
      case 'move-next':
        if (effectiveFocus === 'sessions') {
          if (sidebarView === 'coordinator') moveCoordinatorSelection(1)
          else moveSelection(1)
        } else {
          setFocusedPane('messages')
          if (!moveAgentToolCursor(1)) moveCursor(1)
        }
        break
    }
})

registerHostCommand(['first'], (ctx, id, locals) => {
    const { jumpToTranscriptIndex, setFocusedPane } = ctx
    switch (id) {
      case 'first':
        setFocusedPane('messages')
        jumpToTranscriptIndex(0)
        break
    }
})

registerHostCommand(['last'], (ctx, id, locals) => {
    const { jumpToTranscriptTail, setFocusedPane } = ctx
    switch (id) {
      case 'last':
        setFocusedPane('messages')
        jumpToTranscriptTail()
        break
    }
})

registerHostCommand(['page-prev'], (ctx, id, locals) => {
    const { moveViewport, setFocusedPane } = ctx
    switch (id) {
      case 'page-prev':
        setFocusedPane('messages')
        moveViewport(-1)
        break
    }
})

registerHostCommand(['page-next'], (ctx, id, locals) => {
    const { moveViewport, setFocusedPane } = ctx
    switch (id) {
      case 'page-next':
        setFocusedPane('messages')
        moveViewport(1)
        break
    }
})

registerHostCommand(['focus-next'], (ctx, id, locals) => {
    const { focusedPane, setFocusedPane, tabFromRail } = ctx
    switch (id) {
      case 'focus-next':
        if (focusedPane === 'sessions') tabFromRail()
        else setFocusedPane('sessions')
        break
    }
})

registerHostCommand(['live'], (ctx, id, locals) => {
    const { jumpToTranscriptTail, setFocusedPane } = ctx
    switch (id) {
      case 'live':
        setFocusedPane('messages')
        jumpToTranscriptTail()
        break
    }
})

registerHostCommand(['unread'], (ctx, id, locals) => {
    const { jumpToUnreadBoundary, setFocusedPane } = ctx
    switch (id) {
      case 'unread':
        setFocusedPane('messages')
        jumpToUnreadBoundary()
        break
    }
})

registerHostCommand(['mark'], (ctx, id, locals) => {
    const { jumpToResumeMarker, setFocusedPane } = ctx
    switch (id) {
      case 'mark':
        setFocusedPane('messages')
        jumpToResumeMarker()
        break
    }
})

registerHostCommand(['search'], (ctx, id, locals) => {
    const { setFocusedPane, setSearchMode } = ctx
    switch (id) {
      case 'search':
        setFocusedPane('messages')
        setSearchMode(true)
        break
    }
})

registerHostCommand(['search-prev'], (ctx, id, locals) => {
    const { jumpToSearchMatch, searchMatches, setFocusedPane, setSearchMode } = ctx
    switch (id) {
      case 'search-prev':
        setFocusedPane('messages')
        if (searchMatches.length > 0) jumpToSearchMatch(-1)
        else setSearchMode(true)
        break
    }
})

registerHostCommand(['search-next'], (ctx, id, locals) => {
    const { jumpToSearchMatch, searchMatches, setFocusedPane, setSearchMode } = ctx
    switch (id) {
      case 'search-next':
        setFocusedPane('messages')
        if (searchMatches.length > 0) jumpToSearchMatch(1)
        else setSearchMode(true)
        break
    }
})

registerHostCommand(['conversation-prev'], (ctx, id, locals) => {
    const { jumpToMatchingCard, setFocusedPane } = ctx
    switch (id) {
      case 'conversation-prev':
        setFocusedPane('messages')
        jumpToMatchingCard(-1, (card) => card.category === 'conversation')
        break
    }
})

registerHostCommand(['conversation-next'], (ctx, id, locals) => {
    const { jumpToMatchingCard, setFocusedPane } = ctx
    switch (id) {
      case 'conversation-next':
        setFocusedPane('messages')
        jumpToMatchingCard(1, (card) => card.category === 'conversation')
        break
    }
})

registerHostCommand(['technical-prev'], (ctx, id, locals) => {
    const { jumpToMatchingCard, setFocusedPane } = ctx
    switch (id) {
      case 'technical-prev':
        setFocusedPane('messages')
        jumpToMatchingCard(-1, (card) => card.category !== 'conversation')
        break
    }
})

registerHostCommand(['technical-next'], (ctx, id, locals) => {
    const { jumpToMatchingCard, setFocusedPane } = ctx
    switch (id) {
      case 'technical-next':
        setFocusedPane('messages')
        jumpToMatchingCard(1, (card) => card.category !== 'conversation')
        break
    }
})

registerHostCommand(['fold'], (ctx, id, locals) => {
    const { setFocusedPane, toggleExpansion } = ctx
    switch (id) {
      case 'fold':
        setFocusedPane('messages')
        toggleExpansion()
        break
    }
})

registerHostCommand(['fold-parent'], (ctx, id, locals) => {
    const { openSelectedAsyncQuestionsOrFold, setFocusedPane } = ctx
    switch (id) {
      case 'fold-parent':
        setFocusedPane('messages')
        openSelectedAsyncQuestionsOrFold()
        break
    }
})

registerHostCommand(['copy'], (ctx, id, locals) => {
    const { copySelectedMessage, setFocusedPane } = ctx
    switch (id) {
      case 'copy':
        setFocusedPane('messages')
        void copySelectedMessage()
        break
    }
})

registerHostCommand(['reply'], (ctx, id, locals) => {
    const { replySelectedMessage, setFocusedPane } = ctx
    switch (id) {
      case 'reply':
        setFocusedPane('messages')
        replySelectedMessage()
        break
    }
})

registerHostCommand(['bookmark-toggle'], (ctx, id, locals) => {
    const { setFocusedPane, toggleBookmarkForCursor } = ctx
    switch (id) {
      case 'bookmark-toggle':
        setFocusedPane('messages')
        void toggleBookmarkForCursor()
        break
    }
})

registerHostCommand(['bookmark-prev'], (ctx, id, locals) => {
    const { jumpToBookmark, setFocusedPane } = ctx
    switch (id) {
      case 'bookmark-prev':
        setFocusedPane('messages')
        jumpToBookmark(-1)
        break
    }
})

registerHostCommand(['bookmark-jump'], (ctx, id, locals) => {
    const { jumpToBookmark, setFocusedPane } = ctx
    switch (id) {
      case 'bookmark-jump':
        setFocusedPane('messages')
        jumpToBookmark(1)
        break
    }
})
