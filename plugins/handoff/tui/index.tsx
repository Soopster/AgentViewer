/** @jsxImportSource @opentui/react */
// TUI entry for the Handoff brief plugin: loaded on first open, never at boot.
import { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { HandoffBriefPopover } from './HandoffBriefPopover'

const NO_BOOKMARKS: ReadonlySet<string> = new Set()

function HandoffSurface({ services, theme, syntaxStyle, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const session = services.session?.session ?? null
  const transcript = services['session-transcript']
  const handoff = services.handoff!
  const [bookmarkIds, setBookmarkIds] = useState<ReadonlySet<string>>(NO_BOOKMARKS)
  useEffect(() => {
    if (!session) return undefined
    const controller = new AbortController()
    handoff.bookmarkIds(session, controller.signal)
      .then(ids => { if (!controller.signal.aborted) setBookmarkIds(new Set(ids)) })
      .catch(() => { /* a brief without bookmarks is still a brief */ })
    return () => controller.abort()
  }, [handoff, session?.provider, session?.sessionId])
  if (!syntaxStyle) return null
  if (placement !== 'overlay' && !transcript?.detail) return <text fg={theme.dim}>{transcript?.status === 'gone' ? '  That session is no longer available.' : transcript?.status === 'error' ? '  Could not read the session.' : '  Loading…'}</text>
  const notices = services.notices
  const clipboard = services.clipboard
  return (
    <HandoffBriefPopover
      docked={placement !== 'overlay'}
      session={session}
      detail={transcript?.detail ?? null}
      bookmarkIds={bookmarkIds}
      theme={theme}
      syntaxStyle={syntaxStyle}
      width={width}
      height={height}
      readGit={handoff.readGit}
      onClose={close}
      onDetach={detach}
      onKeyHandlerReady={registerKeys}
      onCopy={async (text) => {
        if (!clipboard) { notices?.show('error', 'No clipboard in this host'); return }
        try {
          await clipboard.write(text)
          notices?.show('info', 'Copied handoff brief to clipboard')
        } catch (err) {
          notices?.show('error', err instanceof Error ? err.message : 'Failed to copy handoff brief')
        }
      }}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'handoff',
  views: { handoff: HandoffSurface },
}
