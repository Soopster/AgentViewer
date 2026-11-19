import dynamic from 'next/dynamic'
import { type RightPanelSurface } from '@/lib/rightPanel'
import type { WebPluginServices } from './pluginTypes'

const PluginSurfaceHost = dynamic(() => import('./PluginSurfaceHost'), { ssr: false })

type Props = {
  surface: RightPanelSurface
  repositoryServices: WebPluginServices | null
  contextServices: WebPluginServices
  coordinationServices: WebPluginServices
  onClose: (id: string) => void
  onBrowserNavigate: (id: string, url: string) => void
}

/** The panel adapter supplies capabilities; the shared host owns plugin state,
 * loading, failure boundaries, focus, and window treatment. */
export function PanelPluginSurface({ surface, repositoryServices, contextServices, coordinationServices, onClose, onBrowserNavigate }: Props) {
  const close = () => onClose(surface.id)
  switch (surface.kind) {
    case 'browser': return <PluginSurfaceHost surfaceId="browser" placement="panel" sessionKey={null} onClose={close} services={{
      ...contextServices,
      'browser-location': { url: surface.url ?? null, navigate: url => onBrowserNavigate(surface.id, url) },
    }} />
    case 'terminal': return <PluginSurfaceHost surfaceId="terminal" placement="panel" sessionKey={null} services={contextServices} onClose={close} />
    case 'files':
    case 'diff':
    case 'pull-request': {
      const cwd = repositoryServices?.repository?.cwd
      return cwd && repositoryServices ? <PluginSurfaceHost surfaceId={surface.kind} placement="panel" sessionKey={null}
        cwd={cwd} services={repositoryServices} onClose={close} /> : null
    }
    case 'agents': return <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, overflow: 'auto' }}>
      <PluginSurfaceHost surfaceId="coordination" placement="panel" sessionKey={null} services={coordinationServices} onClose={close} />
    </div>
  }
}
