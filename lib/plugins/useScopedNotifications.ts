import { useEffect, useMemo } from 'react'
import { webNotifications, tuiNotifications, type PluginNotifications } from './notifications'
import type { PluginRenderer } from './types'

/** Closing a surface revokes retained notification callbacks, including in StrictMode. */
export function useScopedNotifications(renderer: PluginRenderer, owner: string): PluginNotifications {
  const binding = useMemo(() => ({ active: true, service: (renderer === 'web' ? webNotifications : tuiNotifications).service }), [renderer, owner])
  useEffect(() => { binding.active = true; return () => { binding.active = false } }, [binding])
  return useMemo(() => ({
    show: (...args: Parameters<PluginNotifications['show']>) => binding.active ? binding.service.show(...args) : '',
    dismiss: id => { if (binding.active) binding.service.dismiss(id) },
  }), [binding])
}
