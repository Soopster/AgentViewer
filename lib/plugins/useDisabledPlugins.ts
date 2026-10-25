// The disabled plugin set, re-rendering the caller when it changes.
import { useSyncExternalStore } from 'react'
import { readDisabledPlugins, subscribePluginEnablement } from './enablement'

export function useDisabledPlugins(): ReadonlySet<string> {
  return useSyncExternalStore(subscribePluginEnablement, readDisabledPlugins, readDisabledPlugins)
}
