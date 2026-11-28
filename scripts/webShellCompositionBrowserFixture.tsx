import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import RightPanel from '../components/RightPanel'
import { RightPanelContent } from '../components/right-panel/RightPanelContent'
import { DashboardViews, DashboardView } from '../components/shell/DashboardViews'
import { ReaderPane, ReaderPaneCollapseButton, CollapsedReaderPane } from '../components/shell/ReaderPane'
import { RIGHT_PANEL_SURFACE_KINDS, type RightPanelSurface } from '../lib/rightPanel'
import type { DashboardTab } from '../components/viewer-navigation/model'

const availability = Object.fromEntries(RIGHT_PANEL_SURFACE_KINDS.map(kind => [kind, kind === 'browser'])) as Record<(typeof RIGHT_PANEL_SURFACE_KINDS)[number], boolean>
const noop = () => {}
function Counter({ name }: { name: string }) {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(value => value + 1)}>{name} count {count}</button>
}
function Fixture() {
  const [dashboard, setDashboard] = useState<DashboardTab>('sessions')
  const [collapsed, setCollapsed] = useState(false)
  const [surfaces, setSurfaces] = useState<RightPanelSurface[]>([{ id: 'first', kind: 'browser' }, { id: 'second', kind: 'browser' }])
  const [activeId, setActiveId] = useState('missing')
  return <div style={{ display: 'flex', minHeight: 700 }}>
    {collapsed ? <CollapsedReaderPane onExpand={() => setCollapsed(false)} /> : <ReaderPane>
      <ReaderPaneCollapseButton onClick={() => setCollapsed(true)} />
      <DashboardViews value={dashboard} onValueChange={setDashboard}>
        <DashboardView value="sessions"><Counter name="Sessions" /></DashboardView>
        <DashboardView value="agents"><Counter name="Agents" /></DashboardView>
        <DashboardView value="messaging"><Counter name="Messaging" /></DashboardView>
      </DashboardViews>
    </ReaderPane>}
    <RightPanel surfaces={surfaces} activeId={activeId} width={400} expanded={false} availability={availability} unavailableHints={{}}
      onOpenSurface={noop} onActivate={setActiveId} onClose={id => setSurfaces(previous => previous.filter(surface => surface.id !== id))}
      onCloseAll={() => setSurfaces([])} onCollapse={noop} onToggleExpanded={noop} onWidthChange={noop}
      surfaceTitle={surface => `Panel ${surface.id}`}>
      {surfaces.map(surface => <RightPanelContent key={surface.id} surfaceId={surface.id}><Counter name={surface.id} /></RightPanelContent>)}
    </RightPanel>
  </div>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
