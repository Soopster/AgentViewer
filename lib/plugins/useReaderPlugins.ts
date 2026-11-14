import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { createReaderPluginController, listReaderPlugins } from './reader'
import { useDisabledPlugins } from './useDisabledPlugins'
import { subscribePluginCommands } from './commandBus'
import { getPluginCommand } from './catalog'
import { isPluginEnabled } from './enablement'

const specs = listReaderPlugins()
export function useReaderPlugins(owner: string | null, commandsAllowed = true) {
  const controller = useMemo(() => createReaderPluginController(specs), [owner])
  const current = useRef(controller)
  current.current = controller
  const disabled = useDisabledPlugins()
  useLayoutEffect(() => controller.prune(), [controller, disabled])
  useEffect(() => { controller.activate(); return () => controller.dispose() }, [controller])
  useEffect(() => {
    if (!owner || !commandsAllowed) return
    return subscribePluginCommands(id => {
      const command = getPluginCommand(id)
      return Boolean(command?.webReader && command.renderers.includes('web') && isPluginEnabled(command.pluginId) && controller.open(command.webReader, command.webReaderAction))
    })
  }, [controller, owner, commandsAllowed])
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const isCurrent = useCallback(() => current.current === controller, [controller])
  return { controller, snapshot, isCurrent }
}
export type ReaderPluginBinding = ReturnType<typeof useReaderPlugins>
