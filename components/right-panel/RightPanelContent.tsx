import { use, type ReactNode } from 'react'
import { ActiveSurfaceContext } from './activeSurfaceContext'

/** Keeps inactive content mounted while the shell controls its visibility. */
export function RightPanelContent({ surfaceId, children }: { surfaceId: string; children: ReactNode }) {
  const activeId = use(ActiveSurfaceContext)
  if (activeId === undefined) throw new Error('RightPanelContent must be composed inside RightPanel.')
  const active = surfaceId === activeId
  return <div data-right-panel-content={surfaceId} style={{ display: active ? 'flex' : 'none', flexDirection: 'column',
    flex: active ? 1 : undefined, minHeight: 0, minWidth: 0 }}>{children}</div>
}

