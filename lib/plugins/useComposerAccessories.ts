import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { PLUGIN_MANIFESTS } from './catalog'
import { createComposerAccessoryController, listComposerAccessories } from './composerHost'
import { useDisabledPlugins } from './useDisabledPlugins'
import type { PluginRenderer } from './types'

export function useComposerAccessories(renderer: PluginRenderer, owner: string | null) {
  const specs = useMemo(() => listComposerAccessories(renderer, PLUGIN_MANIFESTS), [renderer])
  const controller = useMemo(() => createComposerAccessoryController(specs), [specs, owner])
  const current = useRef(controller)
  current.current = controller
  const disabled = useDisabledPlugins()
  useLayoutEffect(() => { controller.prune() }, [controller, disabled])
  useEffect(() => { controller.activate(); return () => controller.dispose() }, [controller])
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const isCurrent = useCallback(() => current.current === controller, [controller])
  return { controller, snapshot, isCurrent }
}
export type ComposerAccessoryBinding = ReturnType<typeof useComposerAccessories>
