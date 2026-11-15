import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { module } from '../plugins/plan-review/web'
import { webPlanReview } from '../components/shell/planReviewService'
import type { WebPluginViewProps } from '../components/shell/pluginTypes'
const cwd = (window as unknown as { PLAN_CWD: string }).PLAN_CWD
const target = { provider: 'codex' as const, providerInstanceId: 'work', sessionId: 'review-session' }
const session = { ...target, cwd, summary: 'Plan Review fixture', lastModified: 1 }
const useFixtureState: WebPluginViewProps['useState'] = (_name, initial) => useState(initial)
function Fixture() {
  const [open, setOpen] = useState(true), [placement, setPlacement] = useState<'overlay' | 'window' | 'panel'>('panel')
  const View = module.views['plan-review']!
  return <><button onClick={() => setOpen(!open)}>Toggle review</button><button onClick={() => setPlacement(placement === 'panel' ? 'window' : 'panel')}>Relocate review</button><button onClick={() => { setPlacement('overlay'); setOpen(true) }}>Overlay review</button>
    {open ? <div style={{ height: 850 }}><View pluginId="plan-review" surfaceId="plan-review" instanceId="fixture" placement={placement} target={{ cwd, sessionKey: 'source' }} services={{ 'plan-review': webPlanReview, repository: { cwd, sessionId: target.sessionId }, session: { session } }} close={() => setOpen(false)} useState={useFixtureState} onDispose={() => () => {}} /></div> : null}</>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
