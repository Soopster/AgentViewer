import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { module } from '../plugins/skills-manager/web'
import { webSkillsManager } from '../components/shell/skillsManagerService'
import type { WebPluginViewProps } from '../components/shell/pluginTypes'
const cwd = (window as unknown as { SKILLS_CWD: string }).SKILLS_CWD
const useFixtureState: WebPluginViewProps['useState'] = (_name, initial) => useState(initial)
function Fixture() {
  const [open, setOpen] = useState(true), [placement, setPlacement] = useState<'panel' | 'window' | 'overlay'>('panel')
  const View = module.views['skills-manager']!
  return <><button onClick={() => setOpen(!open)}>Toggle manager</button><button onClick={() => setPlacement(placement === 'panel' ? 'window' : 'panel')}>Relocate manager</button><button onClick={() => { setPlacement('overlay'); setOpen(true) }}>Overlay manager</button>{open ? <div style={{ height: 900 }}><View pluginId="skills-manager" surfaceId="skills-manager" instanceId="fixture" placement={placement} target={{ cwd, sessionKey: null }} services={{ 'skills-manager': webSkillsManager, repository: { cwd, sessionId: null } }} close={() => setOpen(false)} useState={useFixtureState} onDispose={() => () => {}} /></div> : null}</>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
