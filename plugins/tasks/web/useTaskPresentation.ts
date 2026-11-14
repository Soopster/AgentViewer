import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { WebPluginViewProps } from '../../../components/shell/pluginTypes'
import { createPluginResourceScope } from '../../../lib/plugins/lifecycle'
import { sessionIdentityKey } from '../../../lib/sessionIdentity'

/** Open state follows the view instance; async controls follow the mounted target. */
export function useTaskPresentation({ services, instanceId, useState: useScopedState, close }: WebPluginViewProps, count: number) {
  const [open, setOpen] = useScopedState('open', true)
  const [explicit, setExplicit] = useScopedState('explicit-open', false)
  const [lastRequest, setLastRequest] = useScopedState('reader-request', 0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [stopping, setStopping] = useState<string | null>(null)
  const slot = services['reader-slot']
  const control = services['task-control']
  const source = services.session?.session
  const identity = useMemo(() => source ? Object.freeze({ sessionId: source.sessionId, provider: source.provider, providerInstanceId: source.providerInstanceId }) : null,
    [source?.sessionId, source?.provider, source?.providerInstanceId])
  const owner = identity ? sessionIdentityKey(identity) : null
  const lifetime = useRef<{ owner: string | null; instanceId: string; signal: AbortSignal } | null>(null)
  const pending = useRef(false)
  const handled = useRef({ instanceId, serial: lastRequest })

  useLayoutEffect(() => {
    const scope = createPluginResourceScope('tasks')
    lifetime.current = { owner, instanceId, signal: scope.signal }
    pending.current = false
    setStopping(null)
    setError(null)
    setNotice(null)
    return () => scope.dispose()
  }, [instanceId, owner])

  useLayoutEffect(() => {
    if (handled.current.instanceId !== instanceId) handled.current = { instanceId, serial: lastRequest }
    const request = slot?.request
    if (!request?.serial || handled.current.serial === request.serial) return
    handled.current.serial = request.serial
    setLastRequest(request.serial)
    setOpen(current => request.action === 'toggle' ? !(current && (count > 0 || explicit)) : true)
    setExplicit(true)
  }, [instanceId, slot?.request, lastRequest, setLastRequest, setOpen, setExplicit, count, explicit])

  const visible = open && (count > 0 || explicit || !slot)
  useLayoutEffect(() => { slot?.report({ visible, count }) }, [slot?.report, visible, count])

  const closePanel = useCallback(() => {
    const current = lifetime.current
    if (!current || current.signal.aborted || current.owner !== owner || current.instanceId !== instanceId) return
    if (slot) setOpen(false)
    else close()
  }, [slot, setOpen, close, owner, instanceId])
  const jumpTo = useCallback((uuid: string): boolean => {
    const current = lifetime.current
    if (!control || !current || current.signal.aborted || current.owner !== owner || current.instanceId !== instanceId) return false
    try { control.jumpTo(uuid); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not jump to the task'); return false }
  }, [control, owner, instanceId])
  const stopTask = useCallback((taskId: string) => {
    const current = lifetime.current
    if (!current || current.owner !== owner || current.instanceId !== instanceId) return
    const signal = current.signal
    if (!control?.stop || !identity || signal.aborted || pending.current) return
    pending.current = true
    setStopping(taskId)
    setError(null)
    setNotice(null)
    void (async () => {
      try {
        await control.stop!(identity, taskId, signal)
        if (!signal.aborted) setNotice(`Stopped task #${taskId}.`)
      } catch (cause) {
        if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not stop the task')
      } finally {
        if (!signal.aborted) {
          pending.current = false
          setStopping(null)
        }
      }
    })()
  }, [control, identity, owner, instanceId])
  return { visible, closePanel, jumpTo, stopTask: control?.stop && identity ? stopTask : undefined, error, notice, stopping }
}
