// Delivers the TUI's card interactions to plugins as `ui.interaction` runtime events. In process the
// event is published where the behavior host lives (loaded on the first flush, ~every 30s, never at
// boot: the host's graph is not worth paying for on a render thread that may never report); attached to
// a daemon it goes to the daemon, which is where the plugins run.
import { setUiInteractionSink, type UiInteractionReport } from '../../lib/plugins/uiInteractions'
import { isRemoteAttached, remoteJson } from '../../lib/tui/remote'

async function deliver(reports: readonly UiInteractionReport[]): Promise<void> {
  if (isRemoteAttached()) { await remoteJson('/api/plugins/ui-interaction', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reports }) }); return }
  const [{ pluginBehaviorHost }, { publishPluginRuntimeEvent }] = await Promise.all([import('../../lib/plugins/serverBehaviors'), import('../../lib/plugins/runtimeEvents')])
  pluginBehaviorHost() // makes sure the observers exist before the event is published
  for (const report of reports) publishPluginRuntimeEvent({ type: 'ui.interaction', source: 'renderer', target: { provider: report.target.provider as never, ...(report.target.providerInstanceId ? { providerInstanceId: report.target.providerInstanceId } : {}), sessionId: report.target.sessionId }, interaction: { action: report.action, subject: report.subject, count: report.count } })
}

export function installTuiUiInteractionSink(): void { setUiInteractionSink(deliver) }
