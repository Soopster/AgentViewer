'use client'

// The Web's `shell-overview` service (lib/plugins/shellOverview.ts): read-only
// context built from the app state the page already publishes (modAppStore —
// the cwd, sessions with their activity, the selection, the available
// commands), with actions that go back through that host. The TUI builds the
// same contract from its root.
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { modAppStore } from '../../lib/plugins/modApp'
import type { GitSummary } from '../../lib/gitProvider'
import type { PluginShellOverview, ShellOverviewAction } from '../../lib/plugins/shellOverview'

/** What only the page can do: open its palette and start a session. */
export type WebShellActions = { readonly openPalette: () => void; readonly newSession: () => void }

async function readGit(cwd: string): Promise<GitSummary | null> {
  const response = await fetch(`/api/git?${new URLSearchParams({ cwd, action: 'summary' })}`)
  if (!response.ok) return null
  const body = await response.json().catch(() => ({}))
  return (body.summary as GitSummary | undefined) ?? null
}

export function useWebShellOverview(actions: WebShellActions): PluginShellOverview {
  const app = useSyncExternalStore(modAppStore.subscribe, modAppStore.getSnapshot, modAppStore.getSnapshot)
  const run = useCallback((action: ShellOverviewAction) => {
    const host = modAppStore.host()
    const current = modAppStore.getSnapshot()
    if (action === 'commands') actions.openPalette()
    else if (action === 'new-session') actions.newSession()
    else if (action === 'repository') host?.runCommand('git')
    else if (action === 'session' || action === 'attention') {
      const target = action === 'attention'
        ? current.sessions.find(session => session.activity === 'needs-input')
        : current.sessions.find(session => session.key === current.selectedKey)
      if (target) void host?.openSession?.(target.target)
      else if (action === 'attention') host?.runCommand('attention')
    }
  }, [actions])
  return useMemo(() => {
    const selected = app.sessions.find(session => session.key === app.selectedKey) ?? null
    const available = app.commands.filter(command => command.available).map(command => command.id)
    return {
      snapshot: {
        cwd: app.cwd ?? '',
        sessionKey: app.selectedKey,
        sessionTitle: selected?.title ?? null,
        provider: selected?.target.provider,
        activity: selected?.activity ?? 'idle',
        running: selected?.activity === 'running',
        // The Web's activity registry reports state, not when a turn began.
        startedAt: null,
        runningCount: app.sessions.filter(session => session.activity === 'running').length,
        attentionCount: app.sessions.filter(session => session.activity === 'needs-input').length,
      },
      readGit,
      run,
      commands: { ids: available, run: (id: string) => { modAppStore.host()?.runCommand(id) } },
    }
  }, [app, run])
}
