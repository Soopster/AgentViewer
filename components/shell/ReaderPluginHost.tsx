'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PluginSurfaceHost from './PluginSurfaceHost'
import type { WebPluginServices } from './pluginTypes'
import type { ReaderPluginBinding } from '../../lib/plugins/useReaderPlugins'
import type { ReaderPluginPresentation } from '../../lib/plugins/reader'
import { useDisabledPlugins } from '../../lib/plugins/useDisabledPlugins'

export function ReaderPluginHost({ binding, sessionKey, services, visible = true }: {
  binding: ReaderPluginBinding; sessionKey: string | null; services: WebPluginServices; visible?: boolean
}) {
  const disabled = useDisabledPlugins()
  if (!sessionKey) return null
  return <>{binding.controller.specs.filter(spec => !disabled.has(spec.pluginId)).map(spec => <ReaderSlot key={spec.id}
    spec={spec} binding={binding} sessionKey={sessionKey} services={services} visible={visible} />)}</>
}
function ReaderSlot({ spec, binding, sessionKey, services, visible }: {
  spec: ReaderPluginBinding['controller']['specs'][number]; binding: ReaderPluginBinding; sessionKey: string; services: WebPluginServices; visible: boolean
}) {
  const { controller, isCurrent } = binding
  const token = useRef(Symbol(spec.id)).current
  const [closedAt, setClosedAt] = useState(-1)
  const request = controller.request(spec.id)
  const report = useCallback((value: ReaderPluginPresentation) => { if (isCurrent()) controller.report(spec.id, token, value) }, [controller, isCurrent, spec.id, token])
  useEffect(() => () => controller.remove(spec.id, token), [controller, spec.id, token])
  const offered = useMemo(() => ({ ...services, 'reader-slot': { request, report } }), [services, request, report])
  const shown = controller.presentation(spec.id)?.visible ?? false
  if (closedAt === request.serial) return null
  return <div data-plugin-reader-slot={spec.id} style={{ display: visible ? 'flex' : 'none', flexShrink: 0, width: shown ? spec.width : 0, minHeight: 0 }}>
    <PluginSurfaceHost surfaceId={spec.surface} placement="panel" sessionKey={sessionKey}
      services={offered} onClose={() => { controller.remove(spec.id, token); setClosedAt(request.serial) }} />
  </div>
}
