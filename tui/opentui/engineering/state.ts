import { useAppState, useWorkspaceState } from '../workspaceContext'
import { useState, type Dispatch, type SetStateAction } from 'react'
import type { TuiTranscriptView } from '../../theme'
import { DEFAULT_SIDEBAR_WIDTH } from '../app/layoutConstants'
import { ENGINEERING_DEFAULTS, engineeringGeometry, type EngineeringPreferences } from './model'

export function useEngineeringStateKey(key: string) {
  const [view] = useAppState<TuiTranscriptView>('transcriptView', 'conversation')
  return view === 'engineering' ? `engineering:${key}` : key
}

/** Keep legacy storage keys exactly as they were outside Engineering. */
export function useEngineeringWorkspaceState<T>(key: string, initial: T | (() => T), persist = true) {
  return useWorkspaceState(useEngineeringStateKey(key), initial, persist)
}

export function useEngineeringAppState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [view] = useAppState<TuiTranscriptView>('transcriptView', 'conversation')
  const legacy = useAppState(key, initial)
  const engineering = useWorkspaceState(`engineering:${key}`, initial)
  return view === 'engineering' ? engineering : legacy
}

export function useEngineeringLocalState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [view] = useAppState<TuiTranscriptView>('transcriptView', 'conversation')
  const legacy = useState(initial)
  const engineering = useWorkspaceState(`engineering:${key}`, initial)
  return view === 'engineering' ? engineering : legacy
}

export function useEngineeringLayout(width: number, height: number) {
  const [view] = useAppState<TuiTranscriptView>('transcriptView', 'conversation')
  const [preferences, setPreferences] = useWorkspaceState<EngineeringPreferences>('engineering:preferences', ENGINEERING_DEFAULTS)
  const active = view === 'engineering'
  const [sidebarWidth] = useAppState('sidebarWidthPreference', DEFAULT_SIDEBAR_WIDTH)
  const geometry = engineeringGeometry(width, height, preferences, sidebarWidth)
  return { active, preferences, setPreferences, ...geometry,
    width: active ? geometry.width : width, height: active ? geometry.height : height }
}
