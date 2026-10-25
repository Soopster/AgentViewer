/** @jsxImportSource @opentui/react */
// Presents one plugin surface in an overlay or a window. The host owns what a
// plugin must not: loading its module, resolving its declared services for the
// target it was opened on, holding its scoped state, routing its keys, and
// containing its failures. A view that throws, or a module that fails to load,
// leaves a local Retry/Close view; the transcript and composer keep working.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RGBA } from '@opentui/core'
import type { Session } from '../../../lib/types'
import type { TuiSessionDetail } from '../../../lib/tui/service'
import { getPluginSurface, type PluginSurfaceId } from '../../../lib/plugins/catalog'
import { pluginState, useScopedPluginState, type PluginStateStore } from '../../../lib/plugins/scopedState'
import type { PluginPlacement, PluginTarget } from '../../../lib/plugins/types'
import type { TuiDensity, TuiThemePalette } from '../../theme'
import { usePinnedSessionDetail } from '../usePinnedSessionDetail'
import type { TuiPluginKeyEvent, TuiPluginServices, TuiPluginView, TuiPluginViewProps } from './pluginTypes'
import { tuiPluginViews } from './pluginViews'

type KeyHandler = (key: TuiPluginKeyEvent) => void

// The layer overlay views draw at (popoverRootProps' zIndex), with their scrim
// just beneath. Below the root modal scrim, which dims for a blocking modal.
export const PLUGIN_OVERLAY_Z_INDEX = 50

export type PluginSurfaceHostProps = {
  surfaceId: PluginSurfaceId
  placement: PluginPlacement
  /** The session the surface was opened for, resolved by the root. */
  session: Session | null
  sessionKey: string | null
  /** The root's loaded detail for the selected session, reused rather than re-read. */
  selected: { key: string | null; detail: TuiSessionDetail | null }
  density: TuiDensity
  showToolCalls: boolean
  shouldYield: () => boolean
  theme: TuiThemePalette
  width: number
  height: number
  focused: boolean
  onClose: () => void
  onDetach?: () => void
  onKeyHandlerReady: (handler: KeyHandler) => void
  /** Test seams. */
  registry?: Pick<typeof tuiPluginViews, 'load' | 'peek'>
  store?: PluginStateStore
}

/** One instance per pin: an overlay and the window it becomes share state. */
export function pluginInstanceId(surfaceId: string, sessionKey: string | null): string {
  return getPluginSurface(surfaceId as PluginSurfaceId).pin === 'session' && sessionKey ? `${surfaceId}:${sessionKey}` : surfaceId
}

class PluginErrorBoundary extends React.Component<{ onError: (error: Error) => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { this.props.onError(error) }
  render() { return this.state.failed ? null : this.props.children }
}

export function PluginSurfaceHost(props: PluginSurfaceHostProps) {
  const { surfaceId, placement, session, sessionKey, selected, theme, width, height, onClose, onKeyHandlerReady } = props
  const registry = props.registry ?? tuiPluginViews
  const store = props.store ?? pluginState
  const surface = getPluginSurface(surfaceId)
  const instanceId = pluginInstanceId(surfaceId, sessionKey)

  const [attempt, setAttempt] = useState(0)
  const [failure, setFailure] = useState<Error | null>(null)
  const [View, setView] = useState<TuiPluginView | null>(() => registry.peek(surface.pluginId)?.views[surfaceId] ?? null)
  useEffect(() => {
    if (View) return undefined
    let live = true
    registry.load(surface.pluginId).then(
      (module) => { if (live) setView(() => module.views[surfaceId]!) },
      (error: unknown) => { if (live) setFailure(error instanceof Error ? error : new Error(String(error))) },
    )
    return () => { live = false }
  }, [View, attempt, registry, surface.pluginId, surfaceId])

  useEffect(() => store.hold(surface.pluginId, instanceId), [store, surface.pluginId, instanceId])

  // Services are resolved for the target, never for whatever is selected now.
  const wantsTranscript = surface.services.includes('session-transcript')
  const useSelectedDetail = wantsTranscript && Boolean(sessionKey && sessionKey === selected.key && selected.detail)
  const pinned = usePinnedSessionDetail(wantsTranscript && !useSelectedDetail ? session : null, props.density, props.showToolCalls, props.shouldYield)
  const transcript = useSelectedDetail ? selected.detail : pinned.detail
  const transcriptStatus = useSelectedDetail ? 'ready' : pinned.status
  const services = useMemo<TuiPluginServices>(() => (
    wantsTranscript ? { 'session-transcript': { detail: transcript, status: transcriptStatus } } : {}
  ), [wantsTranscript, transcript, transcriptStatus])

  const viewKeys = useRef<KeyHandler | null>(null)
  const retry = useCallback(() => { setFailure(null); setView(null); setAttempt(value => value + 1) }, [])
  const failed = useRef(false)
  failed.current = failure !== null
  useEffect(() => {
    onKeyHandlerReady((key) => {
      if (failed.current) {
        if (key.name === 'escape' || key.sequence === 'q') onClose()
        else if (key.sequence === 'r') retry()
        return
      }
      if (key.name === 'escape' && !viewKeys.current) { onClose(); return }
      viewKeys.current?.(key)
    })
  }, [onKeyHandlerReady, onClose, retry])

  const target = useMemo<PluginTarget>(() => ({ sessionKey }), [sessionKey])
  const useState_ = useCallback(<T,>(name: string, initial: T) => (
    // Called from the view's render as a hook; the identity is stable per instance.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useScopedPluginState(store, surface.pluginId, instanceId, name, initial)
  ), [store, surface.pluginId, instanceId])
  const onDispose = useCallback((cleanup: () => void) => store.onDispose(surface.pluginId, instanceId, cleanup), [store, surface.pluginId, instanceId])
  const registerKeys = useCallback((handler: KeyHandler | null) => { viewKeys.current = handler }, [])

  const overlay = placement === 'overlay'
  const scrim = overlay ? <box position="absolute" top={0} left={0} width={width} height={height} backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)} zIndex={PLUGIN_OVERLAY_Z_INDEX - 1} /> : null

  if (failure) {
    const boxWidth = overlay ? Math.min(width - 4, 72) : width
    return (
      <>
        {scrim}
        <box
          {...(overlay ? { position: 'absolute' as const, top: Math.max(1, Math.floor(height / 3)), left: Math.max(0, Math.floor((width - boxWidth) / 2)), zIndex: PLUGIN_OVERLAY_Z_INDEX, border: true, borderColor: theme.red, title: ` ${surface.title} ` } : {})}
          id={`plugin-failure:${surfaceId}`}
          width={boxWidth}
          flexDirection="column"
          paddingX={1}
          backgroundColor={theme.bg}
        >
          <text fg={theme.red} wrapMode="word">{surface.title.slice(2)} stopped: {failure.message}</text>
          <text fg={theme.muted}><span fg={theme.cyan}>r</span> retry · <span fg={theme.cyan}>esc</span> close</text>
        </box>
      </>
    )
  }
  if (!View) return scrim
  // OpenTUI's JSX yields ReactNode; React renders any function component.
  const Component = View as unknown as (props: TuiPluginViewProps) => React.ReactElement | null
  const viewProps: TuiPluginViewProps = {
    pluginId: surface.pluginId, surfaceId, instanceId, placement, target, services, theme, width, height,
    focused: props.focused, useState: useState_, onDispose, registerKeys, close: onClose,
    ...(overlay && props.onDetach ? { detach: props.onDetach } : {}),
  }
  return (
    <>
      {scrim}
      <PluginErrorBoundary key={attempt} onError={setFailure}>
        <Component {...viewProps} />
      </PluginErrorBoundary>
    </>
  )
}
