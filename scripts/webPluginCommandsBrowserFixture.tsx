import React, { StrictMode, useMemo, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { usePluginDashboardCommands } from '../components/shell/usePluginDashboards'
import type { PluginDashboardId } from '../lib/plugins/dashboard'
import MessageView from '../components/MessageView'
import type { Session, SessionMessage } from '../lib/types'
import { dispatchPluginCommand } from '../lib/plugins/commandBus'
import { applyPluginSettings, readPluginSettings, withPluginEnabled } from '../lib/plugins/enablement'
import { useDisabledPlugins } from '../lib/plugins/useDisabledPlugins'

function Fixture() {
  const [instance, setInstance] = useState('personal')
  const [withTasks, setWithTasks] = useState(true)
  const params = new URLSearchParams(window.location.search)
  const taskMode = params.has('tasks')
  const projectMode = params.has('project')
  const [handled, setHandled] = useState(false)
  const [dashboard, setDashboard] = useState('')
  usePluginDashboardCommands(useCallback((id: PluginDashboardId) => setDashboard(id), []))
  const disabledPlugins = useDisabledPlugins()
  const disabled = disabledPlugins.has('composer-tools')
  const goalsDisabled = disabledPlugins.has('goals')
  const diagnosticsDisabled = disabledPlugins.has('diagnostics')
  const tasksDisabled = disabledPlugins.has('tasks')
  const bridgesDisabled = disabledPlugins.has('bridges')
  const provider = new URLSearchParams(window.location.search).get('provider') === 'claude' ? 'claude' : 'codex'
  const session = useMemo<Session>(() => ({ sessionId: 'same', provider, providerInstanceId: instance, summary: instance, cwd: '/fixture' }), [instance, provider])
  const messages = useMemo<SessionMessage[]>(() => [{ uuid: `prompt-${instance}`, session_id: 'same', provider, providerInstanceId: instance,
    type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: `Original ${instance} prompt` }] },
  }, ...(taskMode && withTasks ? [{ uuid: `task-${instance}`, session_id: 'same', provider, providerInstanceId: instance,
    type: 'system', parent_tool_use_id: null, message: { type: 'system', subtype: 'task_started', task_id: 'task-1', description: `Task ${instance}` },
  } as SessionMessage] : [])], [instance, provider, taskMode, withTasks])

  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ position: 'relative', zIndex: 100 }}>
      <button onClick={() => setHandled(dispatchPluginCommand('reuse'))}>Run reuse</button>
      <button onClick={() => setInstance(instance === 'personal' ? 'work' : 'personal')}>Switch account</button>
      <button onClick={() => applyPluginSettings(withPluginEnabled(readPluginSettings(), 'composer-tools', disabled))}>{disabled ? 'Enable tools' : 'Disable tools'}</button>
      <button onClick={() => dispatchPluginCommand('goal')}>Open goal</button>
      <button onClick={() => applyPluginSettings(withPluginEnabled(readPluginSettings(), 'goals', goalsDisabled))}>{goalsDisabled ? 'Enable goals' : 'Disable goals'}</button>
      <button onClick={() => applyPluginSettings(withPluginEnabled(readPluginSettings(), 'diagnostics', diagnosticsDisabled))}>{diagnosticsDisabled ? 'Enable diagnostics' : 'Disable diagnostics'}</button>
      <button onClick={() => dispatchPluginCommand('open-cross-session-messaging')}>Open messaging command</button>
      <button onClick={() => dispatchPluginCommand('open-task-panel')}>Open task command</button>
      <button onClick={() => dispatchPluginCommand('toggle-task-panel')}>Toggle task command</button>
      <button onClick={() => setWithTasks(value => !value)}>Toggle task data</button>
      <button onClick={() => applyPluginSettings(withPluginEnabled(readPluginSettings(), 'tasks', tasksDisabled))}>{tasksDisabled ? 'Enable tasks' : 'Disable tasks'}</button>
      <button onClick={() => applyPluginSettings(withPluginEnabled(readPluginSettings(), 'bridges', bridgesDisabled))}>{bridgesDisabled ? 'Enable bridges' : 'Disable bridges'}</button>
      <button onClick={() => dispatchPluginCommand('toggle-channel-bridge-route')}>Toggle CLI route command</button>
      <button onClick={() => dispatchPluginCommand('toggle-ide-bridge-route')}>Toggle IDE route command</button>
      <output data-testid="dashboard">{dashboard}</output>
      <output data-testid="handled">{String(handled)}</output>
    </div>
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}><MessageView messages={messages} loading={false} session={projectMode ? null : session} projectView={projectMode ? { key: 'fixture-project', sessionCount: 1, providerMode: 'all' } : undefined} hideCoordinator /></div>
  </div>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
