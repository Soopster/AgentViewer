'use client'
import { useCallback, useEffect, useState } from 'react'
import type { PluginSurfaceId } from '../../lib/plugins/catalog'
import type { WebPluginServices } from './pluginTypes'
import PluginSurfaceHost from './PluginSurfaceHost'

/** Standalone routes provide location; feature code still loads through the registry. */
export default function PluginPage({ surfaceId }: { surfaceId: PluginSurfaceId }) {
  const [location, setLocation] = useState<WebPluginServices['page-location']>(undefined)
  useEffect(() => { setLocation({ get url() { return window.location.href }, replaceQuery(name, value) {
    const url = new URL(window.location.href)
    url.searchParams.set(name, value)
    window.history.replaceState(null, '', url)
  } }) }, [])
  const close = useCallback(() => window.location.assign('/'), [])
  return location ? <PluginSurfaceHost surfaceId={surfaceId} placement="window" sessionKey={null}
    services={{ session: { session: null }, 'page-location': location }} onClose={close} /> : null
}
