'use client'

// Presents one plugin surface on the web. Loads the plugin's chunk on first
// open, holds its scoped state, and contains its failures: a plugin that fails
// to load or throws while rendering shows a local Retry/Close card, and the
// transcript and composer around it keep working.
import React, { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { resolvePluginServices } from '@/lib/plugins/activation'
import { getPluginSurface, type PluginSurfaceId } from '@/lib/plugins/catalog'
import { pluginState, useScopedPluginState, type PluginStateStore } from '@/lib/plugins/scopedState'
import { useDisabledPlugins } from '@/lib/plugins/useDisabledPlugins'
import type { PluginPlacement } from '@/lib/plugins/types'
import type { WebPluginServices, WebPluginView, WebPluginViewProps } from './pluginTypes'
import { webPluginViews } from './pluginViews'

type Props = {
  ownerId?: string
  surfaceId: PluginSurfaceId
  placement: PluginPlacement
  sessionKey: string | null
  /** The repository a `pin: 'cwd'` surface was opened on. */
  cwd?: string | null
  services: WebPluginServices
  onClose: () => void
  registry?: Pick<typeof webPluginViews, 'load' | 'peek'>
  store?: PluginStateStore
}

class PluginErrorBoundary extends React.Component<{ onError: (error: Error) => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { this.props.onError(error) }
  render() { return this.state.failed ? null : this.props.children }
}

export default function PluginSurfaceHost(props: Props) {
  const localOwner = useId()
  const surface = getPluginSurface(props.surfaceId)
  if (useDisabledPlugins().has(surface.pluginId)) {
    // A panel tab or layout can outlive the choice to turn its plugin off; it says so and loads nothing.
    return (
      <div data-plugin-disabled={props.surfaceId} style={{ padding: 16, fontSize: 13, color: 'var(--text-2)' }}>
        {surface.title.slice(2)} is turned off. Turn it on from Plugins in the command palette.{' '}
        <button type="button" onClick={props.onClose} style={{ textDecoration: 'underline', background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}>Close</button>
      </div>
    )
  }
  return <ActivePluginSurface key={props.surfaceId} {...props} ownerId={props.ownerId ?? localOwner} />
}

function ActivePluginSurface({ ownerId, surfaceId, placement, sessionKey, cwd, services: offered, onClose, registry = webPluginViews, store = pluginState }: Props) {
  const surface = getPluginSurface(surfaceId)
  const targetId = surface.pin === 'session' && sessionKey ? `${surfaceId}:${sessionKey}` : surface.pin === 'cwd' && cwd ? `${surfaceId}:${cwd}` : surfaceId
  const instanceId = `${ownerId}:${targetId}`
  const [attempt, setAttempt] = useState(0)
  const [loadFailure, setFailure] = useState<Error | null>(null)
  const [View, setView] = useState<WebPluginView | null>(() => registry.peek(surface.pluginId)?.views[surfaceId] ?? null)
  const resolved = useMemo(() => resolvePluginServices(surface, offered), [surface, offered])
  const { services } = resolved
  const failure = loadFailure ?? resolved.error
  useEffect(() => {
    if (View || resolved.error) return undefined
    let live = true
    registry.load(surface.pluginId).then(
      (module) => { if (live) setView(() => module.views[surfaceId]!) },
      (error: unknown) => { if (live) setFailure(error instanceof Error ? error : new Error(String(error))) },
    )
    return () => { live = false }
  }, [View, attempt, registry, surface.pluginId, surfaceId, resolved.error])
  useEffect(() => store.hold(surface.pluginId, instanceId), [store, surface.pluginId, instanceId])

  const target = useMemo(() => ({ sessionKey, cwd: cwd ?? null }), [sessionKey, cwd])
  const useState_ = useCallback(<T,>(name: string, initial: T) => (
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useScopedPluginState(store, surface.pluginId, instanceId, name, initial)
  ), [store, surface.pluginId, instanceId])
  const onDispose = useCallback((cleanup: () => void) => store.onDispose(surface.pluginId, instanceId, cleanup), [store, surface.pluginId, instanceId])
  const retry = () => { setFailure(null); setView(null); setAttempt(value => value + 1) }

  if (failure) {
    return (
      <div role="alertdialog" aria-label={`${surface.title.slice(2)} failed`} data-plugin-failure={surfaceId} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)' }}>
        <div style={{ background: 'var(--bg-2, var(--bg))', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 18px', maxWidth: 420, color: 'var(--text)', fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{surface.title.slice(2)} stopped</div>
          <div style={{ color: 'var(--text-2)', marginBottom: 12, wordBreak: 'break-word' }}>{failure.message}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose}>Close</button>
            <button type="button" onClick={retry}>Retry</button>
          </div>
        </div>
      </div>
    )
  }
  if (!View) return null
  const props: WebPluginViewProps = { pluginId: surface.pluginId, surfaceId, instanceId, placement, target, services, useState: useState_, onDispose, close: onClose }
  return (
    <PluginErrorBoundary key={attempt} onError={setFailure}>
      <View {...props} />
    </PluginErrorBoundary>
  )
}
