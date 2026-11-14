import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { createPluginResourceScope } from './lifecycle'
import { isPluginEnabled } from './enablement'
import type { ComposerAccessoryProps, PluginComposerModule } from './composer'
import type { ComposerAccessoryController, listComposerAccessories } from './composerHost'

type Spec = ReturnType<typeof listComposerAccessories>[number]
class AccessoryErrorBoundary extends React.Component<{ onError: (error: Error) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { this.props.onError(error) }
  render() { return this.state.failed ? null : this.props.children }
}

/** Shared lifecycle/error boundary; renderer adapters provide components, never native roots. */
export function ComposerAccessoryBoundary<Props extends ComposerAccessoryProps>({ spec, registry, controller, isCurrent, props, Failure }: {
  spec: Spec
  registry: { load: (id: string) => Promise<PluginComposerModule<ComponentType<Props>>>; peek: (id: string) => PluginComposerModule<ComponentType<Props>> | undefined }
  controller: ComposerAccessoryController
  isCurrent: () => boolean
  props: Omit<Props, 'signal' | 'report' | 'registerKeys' | 'openRequest' | 'pluginId' | 'accessoryId'>
  Failure: ComponentType<{ error: Error; retry: () => void }>
}) {
  const [View, setView] = useState<ComponentType<Props> | null>(() => registry.peek(spec.pluginId)?.accessories[spec.id] ?? null)
  const [failure, setFailure] = useState<Error | null>(null)
  const [attempt, setAttempt] = useState(0)
  const token = useRef(Symbol(spec.id)).current
  const request = controller.request(spec.id)
  const previousRequest = useRef(request)
  useEffect(() => {
    if (request !== previousRequest.current) { previousRequest.current = request; if (failure) { setFailure(null); setAttempt(value => value + 1) } }
  }, [request, failure])
  useEffect(() => {
    if (View || failure || (!props.visible && !request)) return
    let live = true
    const missing = spec.services.filter(id => !props.services[id])
    if (missing.length) { setFailure(new Error(`Accessory ${spec.id} needs services: ${missing.join(', ')}`)); return }
    registry.load(spec.pluginId).then(module => { if (live) setView(() => module.accessories[spec.id]!) }, error => { if (live) setFailure(error instanceof Error ? error : new Error(String(error))) })
    return () => { live = false }
  }, [View, failure, attempt, registry, spec, props.services, props.visible, request])
  useEffect(() => {
    if (failure) controller.report(spec.id, token, { rows: 1 })
    return () => controller.remove(spec.id, token)
  }, [controller, spec.id, token, failure])
  const retry = () => { setFailure(null); setAttempt(value => value + 1) }
  if (failure) return props.visible ? React.createElement(Failure, { error: failure, retry }) : null
  if (!View) return null
  return React.createElement(AccessoryErrorBoundary, { key: attempt, onError: setFailure, children:
    React.createElement(ActiveAccessory<Props>, { View, spec, controller, token, isCurrent, props, request }),
  })
}

function ActiveAccessory<Props extends ComposerAccessoryProps>({ View, spec, controller, token, isCurrent, props, request }: {
  View: ComponentType<Props>; spec: Spec; controller: ComposerAccessoryController; token: symbol; isCurrent: () => boolean
  props: Omit<Props, 'signal' | 'report' | 'registerKeys' | 'openRequest' | 'pluginId' | 'accessoryId'>; request: number
}) {
  const [lifetime, setLifetime] = useState(() => new AbortController())
  useEffect(() => {
    if (lifetime.signal.aborted) { setLifetime(new AbortController()); return }
    const scope = createPluginResourceScope(spec.pluginId)
    scope.defer(() => lifetime.abort())
    return () => scope.dispose()
  }, [lifetime, spec.pluginId])
  const active = useCallback(() => !lifetime.signal.aborted && isCurrent() && isPluginEnabled(spec.pluginId), [lifetime, isCurrent, spec.pluginId])
  const report: ComposerAccessoryProps['report'] = useCallback(presentation => {
    if (active()) controller.report(spec.id, token, presentation)
  }, [active, controller, spec.id, token])
  const registerKeys: ComposerAccessoryProps['registerKeys'] = useCallback(handler => {
    if (active()) controller.keys(spec.id, token, handler)
  }, [active, controller, spec.id, token])
  const composer = spec.services.includes('composer') ? props.services.composer : undefined
  const services = React.useMemo(() => composer ? { composer: { sendDraft: (text: string) => {
    if (!active()) { const error = new Error('Composer accessory target changed'); error.name = 'AbortError'; throw error }
    return composer.sendDraft(text)
  }, stageDraft: composer.stageDraft ? (text: string, original: string) => {
    if (!active()) { const error = new Error('Composer accessory target changed'); error.name = 'AbortError'; throw error }
    composer.stageDraft!(text, original)
  } : undefined } } : {}, [composer, active])
  const identity = React.useMemo(() => Object.freeze({ sessionId: props.session.sessionId, provider: props.session.provider, providerInstanceId: props.session.providerInstanceId }), [props.session.sessionId, props.session.provider, props.session.providerInstanceId])
  return React.createElement(View, { ...props, session: identity, pluginId: spec.pluginId, accessoryId: spec.id, signal: lifetime.signal, services, openRequest: request, invocation: controller.input(spec.id), report, registerKeys } as Props)
}
