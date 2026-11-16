/** @jsxImportSource @opentui/react */
// Palette commands of one group, registered into the host command registry (../hostCommands.ts).
import { registerHostCommand } from '../hostCommands'
import type { ExecuteCommandPaletteContext } from '../commandPalette'
import { cycleTranscriptWidth } from '../../../engineeringLayout'
import { runTuiSessionAction, writeTuiDensity, writeTuiDiffLayout, writeTuiFocusMode, writeTuiStickyHeaders, writeTuiRailVisible, writeTuiShowToolCalls, writeTuiTabsEnabled, writeTuiTabOrientation, writeTuiTranscriptWidth, type TuiDiffLayout } from '../../../../../lib/tui/service'
import { type Session } from '../../../../../lib/types'
import { SIDEBAR_RESIZE_STEP } from '../../layoutConstants'
import { sessionKey } from '../../sessionList'
import { cycleDensityValue } from '../../viewHelpers'

registerHostCommand(['transcript-pager'], (ctx, id, locals) => {
    const { openSelectedTranscriptInPager } = ctx
    switch (id) {
      case 'transcript-pager':
        openSelectedTranscriptInPager()
        break
    }
})

registerHostCommand(['theme'], (ctx, id, locals) => {
    const { openThemeMenu } = ctx
    switch (id) {
      case 'theme':
        {
        openThemeMenu()
        break
      }
    }
})

registerHostCommand(['lightweight-windows'], (ctx, id, locals) => {
    const { toggleLightweightWindows } = ctx
    switch (id) {
      case 'lightweight-windows':
        toggleLightweightWindows()
        break
    }
})

registerHostCommand(['sticky-headers'], (ctx, id, locals) => {
    const { setError, setStickyHeaders, showToggleOutcome, stickyHeaders } = ctx
    const { persistPreference } = locals
    switch (id) {
      case 'sticky-headers':
        {
        const next = !stickyHeaders
        setStickyHeaders(next)
        showToggleOutcome('Sticky headers', next)
        void persistPreference(() => writeTuiStickyHeaders(next)).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store sticky headers'))
        break
      }
    }
})

registerHostCommand(['density'], (ctx, id, locals) => {
    const { density, setDensity, setError, showToggleOutcome } = ctx
    const { persistPreference } = locals
    switch (id) {
      case 'density':
        {
        const next = cycleDensityValue(density)
        setDensity(next)
        showToggleOutcome('Density:', next)
        void persistPreference(() => writeTuiDensity(next)).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store density'))
        break
      }
    }
})

registerHostCommand(['diff-layout'], (ctx, id, locals) => {
    const { diffLayout, setDiffLayout, setError, showToggleOutcome } = ctx
    const { persistPreference } = locals
    switch (id) {
      case 'diff-layout':
        {
        const next: TuiDiffLayout = diffLayout === 'stack' ? 'split' : 'stack'
        setDiffLayout(next)
        showToggleOutcome('Diff layout:', next)
        void persistPreference(() => writeTuiDiffLayout(next)).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store diff layout'))
        break
      }
    }
})

registerHostCommand(['rail'], (ctx, id, locals) => {
    const { focusedPane, railVisible, setError, setFocusedPane, setRailVisible, showToggleOutcome } = ctx
    const { persistPreference } = locals
    switch (id) {
      case 'rail':
        {
        const nextVisible = !railVisible
        setRailVisible(nextVisible)
        showToggleOutcome('Session rail', nextVisible)
        if (!nextVisible && focusedPane === 'sessions') setFocusedPane('messages')
        void persistPreference(() => writeTuiRailVisible(nextVisible)).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store rail'))
        break
      }
    }
})

registerHostCommand(['rail-narrow'], (ctx, id, locals) => {
    const { resizeSidebar } = ctx
    switch (id) {
      case 'rail-narrow':
        resizeSidebar(-SIDEBAR_RESIZE_STEP)
        break
    }
})

registerHostCommand(['rail-wide'], (ctx, id, locals) => {
    const { resizeSidebar } = ctx
    switch (id) {
      case 'rail-wide':
        resizeSidebar(SIDEBAR_RESIZE_STEP)
        break
    }
})

registerHostCommand(['focus'], (ctx, id, locals) => {
    const { focusMode, setError, setFocusMode, setFocusedPane, showToggleOutcome } = ctx
    const { persistPreference } = locals
    switch (id) {
      case 'focus':
        {
        const next = !focusMode
        setFocusMode(next)
        showToggleOutcome('Focus mode', next)
        if (next) setFocusedPane('messages')
        void persistPreference(() => writeTuiFocusMode(next)).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store focus mode'))
        break
      }
    }
})

registerHostCommand(['fullscreen'], (ctx, id, locals) => {
    const { toggleFullscreenMode } = ctx
    switch (id) {
      case 'fullscreen':
        toggleFullscreenMode()
        break
    }
})

registerHostCommand(['tools'], (ctx, id, locals) => {
    const { setError, setShowToolCalls, showToggleOutcome } = ctx
    const { persistPreference } = locals
    switch (id) {
      case 'tools':
        {
        setShowToolCalls((v) => {
          const next = !v
          showToggleOutcome('Tool calls', next ? 'shown' : 'hidden')
          void persistPreference(() => writeTuiShowToolCalls(next)).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store tool visibility'))
          return next
        })
        break
      }
    }
})

registerHostCommand(['velocity-scroll'], (ctx, id, locals) => {
    const { toggleVelocityScroll } = ctx
    switch (id) {
      case 'velocity-scroll':
        toggleVelocityScroll()
        break
    }
})

registerHostCommand(['mode'], (ctx, id, locals) => {
    const { composerAgentOptions, composerTargetSession, cycleClaudeComposerPermissionMode, provider, selectedSession, setCodexCollaborationMode, setTuiCopilotMode, setTuiOpenCodeAgent, showToggleOutcome, tuiCodexModeByKeyRef } = ctx
    switch (id) {
      case 'mode':
        {
        const target = composerTargetSession ?? selectedSession
        if (target?.provider === 'opencode') {
          if (composerAgentOptions.length === 0) break
          setTuiOpenCodeAgent((current) => {
            const index = Math.max(0, composerAgentOptions.findIndex((agent) => agent.value === current))
            const next = composerAgentOptions[(index + 1) % composerAgentOptions.length]?.value ?? current
            showToggleOutcome('OpenCode mode:', next)
            return next
          })
          break
        }
        if (target?.provider === 'copilot') {
          const order = ['interactive', 'plan', 'autopilot', 'shell'] as const
          setTuiCopilotMode((current) => {
            const next = order[(order.indexOf(current) + 1) % order.length]!
            showToggleOutcome('Copilot mode:', next)
            void runTuiSessionAction(target, {
              action: 'setMode',
              mode: next,
            }).catch(() => { /* swallow; next send carries body.mode */ })
            return next
          })
          break
        }
        if (target?.provider === 'codex') {
          const next = tuiCodexModeByKeyRef.current[sessionKey(target)] === 'plan' ? 'default' : 'plan'
          setCodexCollaborationMode(target, next)
          showToggleOutcome('Codex mode:', next)
          break
        }
        if (target?.provider === 'claude') {
          cycleClaudeComposerPermissionMode(target)
        }
        break
      }
    }
})

registerHostCommand(['model'], (ctx, id, locals) => {
    const { openModelPicker } = ctx
    switch (id) {
      case 'model':
        {
        void openModelPicker()
        break
      }
    }
})

registerHostCommand(['view'], (ctx, id, locals) => {
    const { openTranscriptViewMenu } = ctx
    switch (id) {
      case 'view':
        {
        openTranscriptViewMenu()
        break
      }
    }
})

registerHostCommand(['width'], (ctx, id, locals) => {
    const { setError, setTranscriptWidth, showToggleOutcome, transcriptWidth } = ctx
    const { persistPreference } = locals
    switch (id) {
      case 'width':
        {
        const next = cycleTranscriptWidth(transcriptWidth)
        setTranscriptWidth(next)
        showToggleOutcome('Transcript width:', next)
        void persistPreference(() => writeTuiTranscriptWidth(next)).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store transcript width'))
        break
      }
    }
})

registerHostCommand(['tabs-horizontal', 'tabs-vertical'], (ctx, id, locals) => {
    const { setError, setTabOrientation, setTabsEnabled, showNotice } = ctx
    const { persistPreference } = locals
    switch (id) {
      case 'tabs-horizontal':
      case 'tabs-vertical':
        {
        const next = id === 'tabs-vertical' ? 'vertical' : 'horizontal'
        setTabOrientation(next)
        setTabsEnabled(true)
        void persistPreference(() => Promise.all([writeTuiTabOrientation(next), writeTuiTabsEnabled(true)])).catch(err => setError(String(err)))
        showNotice('info', `${next === 'vertical' ? 'Vertical' : 'Horizontal'} tabs enabled`)
        break
      }
    }
})

registerHostCommand(['thinking'], (ctx, id, locals) => {
    const { setThinkingMode, showToggleOutcome } = ctx
    switch (id) {
      case 'thinking':
        setThinkingMode((current) => {
          const next = !current
          showToggleOutcome('Thinking mode', next)
          return next
        })
        break
    }
})
