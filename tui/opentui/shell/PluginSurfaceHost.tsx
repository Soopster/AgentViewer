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
import type { ThreadedMessage } from '../../../lib/threading'
import { getPluginSurface, type PluginSurfaceId } from '../../../lib/plugins/catalog'
import { pluginState, useScopedPluginState, type PluginStateStore } from '../../../lib/plugins/scopedState'
import { useDisabledPlugins } from '../../../lib/plugins/useDisabledPlugins'
import type { PluginPlacement, PluginServiceId, PluginTarget } from '../../../lib/plugins/types'
import type { TuiDensity, TuiThemePalette } from '../../theme'
import { usePinnedSessionDetail } from '../usePinnedSessionDetail'
import type { SyntaxStyle } from '@opentui/core'
import type { TuiPluginKeyHandler, TuiProvidedPluginServices, TuiPluginServices, TuiPluginView, TuiPluginViewProps } from './pluginTypes'
import { tuiPluginViews } from './pluginViews'

type KeyHandler = TuiPluginKeyHandler

// The layer overlay views draw at (popoverRootProps' zIndex), with their scrim
// just beneath. Below the root modal scrim, which dims for a blocking modal.
export const PLUGIN_OVERLAY_Z_INDEX = 50

const NO_SELECTION = { key: null, detail: null } as const
const NO_LIVE_MESSAGES: readonly ThreadedMessage[] = []
const NEVER_YIELD = () => false

export type PluginSurfaceHostProps = {
  surfaceId: PluginSurfaceId
  placement: PluginPlacement
  /** The session the surface was opened for, resolved by the root. */
  session?: Session | null
  sessionKey?: string | null
  /** The root's loaded detail for the selected session, reused rather than re-read. */
  selected?: { key: string | null; detail: TuiSessionDetail | null }
  /** The selected session's in-flight turn, which the transcript does not hold yet. */
  live?: { key: string | null; messages: readonly ThreadedMessage[] }
  /** Counts the root's requests to open this surface (PluginTarget.request). */
  request?: number
  density?: TuiDensity
  showToolCalls?: boolean
  shouldYield?: () => boolean
  /** The repository a `pin: 'cwd'` surface was opened on, and the session scoping it. */
  cwd?: string | null
  repositorySessionId?: string | null
  repositoryLabel?: string
  /** A file the surface opens on, 1-based line or null (its target). */
  path?: string | null
  line?: number | null
  /** Service values the host offers; a view receives the ones its surface declares. */
  provided?: TuiProvidedPluginServices
  theme: TuiThemePalette
  syntaxStyle?: SyntaxStyle | null
  width: number
  height: number
  focused: boolean
  /** An overlay's layer, for one opened above another overlay. */
  zIndex?: number
  onClose: () => void
  onDetach?: () => void
  onKeyHandlerReady: (handler: KeyHandler) => void
  onCaptureChange?: (capture: boolean) => void
  runCommand?: (commandId: string) => boolean
  /** Test seams. */
  registry?: Pick<typeof tuiPluginViews, 'load' | 'peek'>
  store?: PluginStateStore
}

/** One instance per pin: an overlay and the window it becomes share state. */
export function pluginInstanceId(surfaceId: string, sessionKey: string | null, cwd: string | null = null): string {
  const pin = getPluginSurface(surfaceId as PluginSurfaceId).pin
  if (pin === 'session' && sessionKey) return `${surfaceId}:${sessionKey}`
  if (pin === 'cwd' && cwd) return `${surfaceId}:${cwd}`
  return surfaceId
}

class PluginErrorBoundary extends React.Component<{ onError: (error: Error) => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { this.props.onError(error) }
  render() { return this.state.failed ? null : this.props.children }
}

export function PluginSurfaceHost(props: PluginSurfaceHostProps) {
  const disabled = useDisabledPlugins().has(getPluginSurface(props.surfaceId).pluginId)
  if (disabled) return <DisabledPluginSurface {...props} />
  return <ActivePluginSurface {...props} />
}

// A window, panel tab or saved layout can outlive the choice to turn its plugin
// off; it says so, and loads nothing.
function DisabledPluginSurface({ surfaceId, theme, onClose, onKeyHandlerReady }: PluginSurfaceHostProps) {
  const surface = getPluginSurface(surfaceId)
  useEffect(() => {
    onKeyHandlerReady((key) => {
      if (key.name === 'escape' || key.sequence === 'q') onClose()
      return true
    })
  }, [onKeyHandlerReady, onClose])
  return (
    <box id={`plugin-disabled:${surfaceId}`} flexDirection="column" paddingX={1}>
      <text fg={theme.muted}>{surface.title.slice(2)} is turned off.</text>
      <text fg={theme.dim}>Turn it on from Plugins in the ⌃K palette · <span fg={theme.cyan}>esc</span> close</text>
    </box>
  )
}

function ActivePluginSurface(props: PluginSurfaceHostProps) {
  const { surfaceId, placement, theme, width, height, onClose, onKeyHandlerReady } = props
  const session = props.session ?? null
  const sessionKey = props.sessionKey ?? null
  const selected = props.selected ?? NO_SELECTION
  const registry = props.registry ?? tuiPluginViews
  const store = props.store ?? pluginState
  const surface = getPluginSurface(surfaceId)
  const cwd = props.cwd ?? null
  const instanceId = pluginInstanceId(surfaceId, sessionKey, cwd)
  const zIndex = props.zIndex ?? PLUGIN_OVERLAY_Z_INDEX

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
  const pinned = usePinnedSessionDetail(wantsTranscript && !useSelectedDetail ? session : null, props.density ?? 'balanced', props.showToolCalls ?? true, props.shouldYield ?? NEVER_YIELD)
  const transcript = useSelectedDetail ? selected.detail : pinned.detail
  const transcriptStatus = useSelectedDetail ? 'ready' : pinned.status
  const wants = (service: PluginServiceId) => surface.services.includes(service) || (surface.optionalServices?.includes(service) ?? false)
  const repositoryCwd = cwd ?? process.cwd()
  const { repositorySessionId = null, repositoryLabel, provided } = props
  // Only a surface that declares them follows these, so a streaming turn or a
  // selection change does not re-render every other open view.
  const targetSession = wants('session') ? session : null
  const liveMessages = wants('live-transcript') && sessionKey && props.live?.key === sessionKey ? props.live.messages : NO_LIVE_MESSAGES
  const services = useMemo<TuiPluginServices>(() => {
    const offered = Object.entries(provided ?? {}).filter(([id, value]) => value && wants(id as PluginServiceId))
    return {
      ...Object.fromEntries(offered),
      ...(wantsTranscript ? { 'session-transcript': { detail: transcript, status: transcriptStatus } } : {}),
      ...(wants('repository') ? { repository: { cwd: repositoryCwd, sessionId: repositorySessionId, ...(repositoryLabel ? { label: repositoryLabel } : {}) } } : {}),
      ...(wants('session') ? { session: { session: targetSession } } : {}),
      ...(wants('live-transcript') ? { 'live-transcript': { messages: liveMessages } } : {}),
    }
  // `wants` reads only the surface, which `surfaceId` names.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceId, wantsTranscript, transcript, transcriptStatus, repositoryCwd, repositorySessionId, repositoryLabel, provided, targetSession, liveMessages])

  const viewKeys = useRef<KeyHandler | null>(null)
  const retry = useCallback(() => { setFailure(null); setView(null); setAttempt(value => value + 1) }, [])
  const failed = useRef(false)
  failed.current = failure !== null
  useEffect(() => {
    onKeyHandlerReady((key) => {
      if (failed.current) {
        if (key.name === 'escape' || key.sequence === 'q') onClose()
        else if (key.sequence === 'r') retry()
        return true
      }
      if (key.name === 'escape' && !viewKeys.current) { onClose(); return true }
      return viewKeys.current?.(key)
    })
  }, [onKeyHandlerReady, onClose, retry])
  // A failed or unmounted view holds no input.
  const { onCaptureChange } = props
  const setCapture = useCallback((capture: boolean) => { onCaptureChange?.(capture) }, [onCaptureChange])
  useEffect(() => { if (failure) onCaptureChange?.(false) }, [failure, onCaptureChange])
  useEffect(() => () => { onCaptureChange?.(false) }, [onCaptureChange])
  const { runCommand: hostRunCommand } = props
  const runCommand = useCallback((commandId: string) => hostRunCommand?.(commandId) ?? false, [hostRunCommand])

  const filePath = props.path ?? null
  const fileLine = props.line ?? null
  const request = props.request ?? 0
  const target = useMemo<PluginTarget>(() => ({ sessionKey, cwd: surface.pin === 'cwd' ? repositoryCwd : null, path: filePath, line: fileLine, request }), [sessionKey, surface.pin, repositoryCwd, filePath, fileLine, request])
  const useState_ = useCallback(<T,>(name: string, initial: T) => (
    // Called from the view's render as a hook; the identity is stable per instance.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useScopedPluginState(store, surface.pluginId, instanceId, name, initial)
  ), [store, surface.pluginId, instanceId])
  const onDispose = useCallback((cleanup: () => void) => store.onDispose(surface.pluginId, instanceId, cleanup), [store, surface.pluginId, instanceId])
  const registerKeys = useCallback((handler: KeyHandler | null) => { viewKeys.current = handler }, [])

  const overlay = placement === 'overlay'
  const scrim = overlay ? <box position="absolute" top={0} left={0} width={width} height={height} backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)} zIndex={zIndex - 1} /> : null

  if (failure) {
    const boxWidth = overlay ? Math.min(width - 4, 72) : width
    return (
      <>
        {scrim}
        <box
          {...(overlay ? { position: 'absolute' as const, top: Math.max(1, Math.floor(height / 3)), left: Math.max(0, Math.floor((width - boxWidth) / 2)), zIndex, border: true, borderColor: theme.red, title: ` ${surface.title} ` } : {})}
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
    pluginId: surface.pluginId, surfaceId, instanceId, placement, target, services, theme, syntaxStyle: props.syntaxStyle ?? null, width, height,
    focused: props.focused, zIndex, useState: useState_, onDispose, registerKeys, setCapture, runCommand, close: onClose,
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
