import { useMemo } from 'react'
import type { Session } from '../../../../lib/types'
import { useWorkspaceContext, useWorkspaceState } from '../../workspaceContext'
import { useStableEvent } from '../../useStableEvent'
import { sessionKey } from '../sessionList'
import type { SidebarActivity } from '../SidebarFilters'

export type SessionSidebarPreferences = { pinned: string[]; activity: SidebarActivity }
type LegacySidebarPreferences = { pinned?: string[]; activity?: SidebarActivity; filter?: string }

/** Adopt the existing workspace pins once; future changes belong to the shared sidebar. */
export function migrateSessionSidebarPreferences(legacy: LegacySidebarPreferences, activity?: SidebarActivity): SessionSidebarPreferences {
  const savedActivity = activity !== undefined ? activity : legacy.activity ?? legacy.filter
  return {
    pinned: Array.isArray(legacy.pinned) ? legacy.pinned.filter(key => typeof key === 'string') : [],
    activity: savedActivity === 'running' || savedActivity === 'attention' || savedActivity === 'pinned' || savedActivity === 'settled' ? savedActivity : null,
  }
}

export function useSessionSidebarState() {
  const context = useWorkspaceContext()
  const [preferences, setPreferences] = useWorkspaceState<SessionSidebarPreferences>('sidebar:preferences', () => {
    const runtime = context?.runtime
    const legacy = runtime?.get<LegacySidebarPreferences>('engineering:preferences', {}, false) ?? {}
    const activity = runtime?.values.has('sidebar:activity') ? runtime.get<SidebarActivity>('sidebar:activity', null, false) : undefined
    return migrateSessionSidebarPreferences(legacy, activity)
  })
  const pinnedKeys = useMemo(() => new Set(preferences.pinned), [preferences.pinned])
  const togglePin = useStableEvent((session: Session) => {
    const key = sessionKey(session)
    setPreferences(previous => ({ ...previous, pinned: previous.pinned.includes(key) ? previous.pinned.filter(value => value !== key) : [...previous.pinned, key] }))
  })
  const setActivity = useStableEvent((activity: SidebarActivity) => setPreferences(previous => ({ ...previous, activity })))
  return { activity: preferences.activity, pinnedKeys, togglePin, setActivity }
}
