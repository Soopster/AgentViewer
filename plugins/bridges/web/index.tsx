'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { createPluginResourceScope } from '../../../lib/plugins/lifecycle'
import { createContextAttachment } from '../../../lib/composerContext'
import { isPluginEnabled } from '../../../lib/plugins/enablement'
import type { ChannelBridgeViewService, IdeBridgeViewService } from '../../../lib/plugins/bridges'
import type { WebPluginView, WebPluginViewProps } from '../../../components/shell/pluginTypes'
import ChannelBridgePanel from './ChannelBridgePanel'
import IdeBridgePanel from './IdeBridgePanel'

function isLive(signal: AbortSignal) { return !signal.aborted && isPluginEnabled('bridges') }
function assertLive(signal: AbortSignal) {
  if (isLive(signal)) return
  const error = new Error('Bridge presentation is no longer active')
  error.name = 'AbortError'
  throw error
}

function useBridgeLifetime(instanceId: string, acquireView: () => () => void) {
  const [signal, setSignal] = useState<AbortSignal | null>(null)
  const [error, setError] = useState<Error | null>(null)
  useEffect(() => {
    const scope = createPluginResourceScope('bridges')
    if (scope.signal.aborted) return () => scope.dispose()
    try {
      scope.defer(acquireView())
      setSignal(scope.signal)
      setError(null)
    } catch (cause) {
      scope.dispose()
      setError(cause instanceof Error ? cause : new Error(String(cause)))
    }
    return () => scope.dispose()
  }, [instanceId, acquireView])
  if (error) throw error
  return signal
}

function Frame({ placement, close, children }: Pick<WebPluginViewProps, 'placement' | 'close'> & { children: React.ReactNode }) {
  if (placement !== 'overlay') return <div style={{ height: '100%', minHeight: 0 }}>{children}</div>
  return <div role="dialog" aria-modal="true" aria-label="Bridge panel"
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}
    onMouseDown={event => { if (event.target === event.currentTarget) close() }}
    style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)', padding: 16 }}>
    <div style={{ width: 'min(480px, 100%)', height: 'min(600px, 84vh)', overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 18px 40px rgba(0,0,0,0.34)' }}>{children}</div>
  </div>
}

function ChannelSurface({ services, instanceId, useState, close, placement }: WebPluginViewProps) {
  const offered = services['channel-bridge']!
  const signal = useBridgeLifetime(instanceId, offered.acquireView)
  const bridge = useMemo<ChannelBridgeViewService | null>(() => signal ? {
    ...offered,
    setBaseUrl: value => { if (isLive(signal)) offered.setBaseUrl(value) },
    setToken: value => { if (isLive(signal)) offered.setToken(value) },
    setSendError: value => { if (isLive(signal)) offered.setSendError(value) },
    setRouteComposer: value => { if (isLive(signal)) offered.setRouteComposer(value) },
    send: async text => { assertLive(signal); return offered.send(text) },
    respond: async (entry, verdict) => { assertLive(signal); return offered.respond(entry, verdict) },
  } : null, [offered, signal])
  return <Frame placement={placement} close={close}>{bridge && signal && <ChannelBridgePanel bridge={bridge} accent={bridge.accent} signal={signal} useState={useState} onClose={close} />}</Frame>
}

function IdeSurface({ services, instanceId, useState, close, placement }: WebPluginViewProps) {
  const offered = services['ide-bridge']!
  const signal = useBridgeLifetime(instanceId, offered.acquireView)
  const bridge = useMemo<IdeBridgeViewService | null>(() => signal ? {
    ...offered,
    setBaseUrl: value => { if (isLive(signal)) offered.setBaseUrl(value) },
    setToken: value => { if (isLive(signal)) offered.setToken(value) },
    setSendError: value => { if (isLive(signal)) offered.setSendError(value) },
    setRouteComposer: value => { if (isLive(signal)) offered.setRouteComposer(value) },
    send: async text => { assertLive(signal); return offered.send(text) },
    respondDiff: async (entry, verdict) => { assertLive(signal); return offered.respondDiff(entry, verdict) },
  } : null, [offered, signal])
  const insertText = services.composer?.insertText
  const attachContext = services.composer?.attachContext
  const sendComment = useCallback((text: string) => {
    if (!signal || !isLive(signal)) return
    if (attachContext) attachContext(createContextAttachment('diff', /File: (.*)/.exec(text)?.[1] || 'Diff comment', text))
    else insertText?.(text)
  }, [signal, insertText, attachContext])
  return <Frame placement={placement} close={close}>{bridge && signal && <IdeBridgePanel bridge={bridge} accent={bridge.accent} signal={signal} useState={useState} onClose={close} onSendComment={insertText || attachContext ? sendComment : undefined} />}</Frame>
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'bridges',
  views: { 'channel-bridge': ChannelSurface, 'ide-bridge': IdeSurface },
}
