'use client'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { PluginWidgetHost } from '../components/shell/PluginWidgetHost'
import { ApplicationPluginHost } from '../components/shell/ApplicationPluginHost'
import { ProviderLoadingToasts } from '../components/ProviderLoadingToasts'
import { webNotifications } from '../lib/plugins/notifications'
import { webActivityFeed } from '../lib/plugins/activityFeed'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS, withPluginEnabled } from '../lib/plugins/enablement'
import { beginProviderLoading } from '../lib/providerLoading'
import type { PluginSessionRef } from '../lib/plugins/bookmarks'

const sessions = [
  { provider: 'codex' as const, providerInstanceId: 'work', sessionId: 'same', customTitle: 'Work session' },
  { provider: 'codex' as const, providerInstanceId: 'personal', sessionId: 'same', customTitle: 'Personal session' },
]
const opened: PluginSessionRef[] = []
let finishLoading: (() => void) | undefined
const fixture = {
  opened,
  notify: () => webNotifications.service.show('info', 'Changes saved'),
  error: () => webNotifications.service.show('error', 'Build failed'),
  disable: () => applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'dynamic-island', false)),
  enable: () => applyPluginSettings(DEFAULT_PLUGIN_SETTINGS),
  run: () => webActivityFeed.publish({ id: 'fixture-run', source: 'fixture', title: 'Background build', status: 'running', progress: 0.45 }),
  loading: () => { finishLoading = beginProviderLoading('codex') },
  finishLoading: () => finishLoading?.(),
}
function Fixture() {
  useEffect(() => { Object.assign(window, { activityFixture: fixture }) }, [])
  return <>
    <textarea aria-label="Composer" defaultValue="Keep typing here" />
    <div id="transcript" style={{ height: 250, overflow: 'auto' }}>{Array.from({ length: 100 }, (_, index) => <p key={index}>Transcript row {index}</p>)}</div>
    <ApplicationPluginHost sessions={sessions} selectedSession={sessions[0]} openSession={session => { opened.push(session) }} />
    <PluginWidgetHost slot="top-center" /><PluginWidgetHost slot="corner" />
    <ProviderLoadingToasts />
  </>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
