'use client'
import { StrictMode, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import PluginManager from '../components/shell/PluginManager'
import { applyWebLocalPlugins } from '../components/shell/localPlugins'

applyWebLocalPlugins({ local: { dir: '/fixture/plugins', plugins: [{ id: 'my-checks', title: 'My checks', description: 'Custom verification', source: 'local', behavior: { hooks: ['beforeTurn'] }, commands: [] }], refused: [{ id: 'broken-mod', dir: 'broken-mod', problems: ['Syntax failure'] }] } })
function Fixture() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return <><button type="button" onClick={() => setOpen(true)}>Open plugins</button>{open ? <PluginManager open onClose={close} /> : null}</>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
