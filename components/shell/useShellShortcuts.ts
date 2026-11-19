import { useEffect } from 'react'
import { dispatchPluginCommand } from '@/lib/plugins/commandBus'

type ShellShortcuts = {
  repositoryAvailable: boolean
  onToggleRightPanel: () => void
  onToggleCommandPalette: () => void
}

/** One shell listener routes global commands; nested surfaces can consume
 * an event first by preventing its default action. */
export function useShellShortcuts({ repositoryAvailable, onToggleRightPanel, onToggleCommandPalette }: ShellShortcuts) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault()
        onToggleCommandPalette()
        return
      }
      if (!event.ctrlKey || event.metaKey || event.altKey) return
      if (key === 'b' && !event.shiftKey) {
        event.preventDefault()
        onToggleRightPanel()
        return
      }
      if (!repositoryAvailable) return
      const command = key === 'g' ? (event.shiftKey ? 'pull-requests' : 'git')
        : key === 'f' && !event.shiftKey ? 'files' : null
      if (!command) return
      event.preventDefault()
      dispatchPluginCommand(command)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [repositoryAvailable, onToggleRightPanel, onToggleCommandPalette])
}
