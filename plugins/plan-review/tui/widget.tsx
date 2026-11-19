/** @jsxImportSource @opentui/react */
import { useSyncExternalStore } from 'react'
import { PLUGIN_API_VERSION, type PluginWidgetModule } from '../../../lib/plugins/types'
import { latestPlan, planApproved, type PlanTarget } from '../../../lib/plugins/planReview'
import { usePlanReviews } from '../../../lib/plugins/usePlanReview'
import { modAppStore } from '../../../lib/plugins/modApp'
import { tuiActivityFeed } from '../../../lib/plugins/activityFeed'
import { useActivitySource } from '../../../lib/plugins/useActivityFeed'
import { useMemo } from 'react'
import { fitText, type TuiPluginWidgetProps } from '../../../tui/opentui/shell/sdk'
function Pending({ services, theme, width, runCommand }: TuiPluginWidgetProps) {
  const app = useSyncExternalStore(modAppStore.subscribe, modAppStore.getSnapshot, modAppStore.getSnapshot), selected = app.sessions.find(item => item.key === app.selectedKey)
  const target = selected && selected.cwd === services?.repository?.cwd ? selected.target as PlanTarget : undefined
  const { snapshot } = usePlanReviews(services?.['plan-review'], services?.repository?.cwd ?? null, target)
  const count = snapshot?.reviews.filter(review => !planApproved(review) && !review.deliveries.some(item => item.revision === latestPlan(review).hash && item.action === 'feedback' && item.status === 'sent')).length ?? 0
  // With the island up, the count is one of its rows (with a Review action) rather than a second floating label.
  const rows = useMemo(() => count ? [{ id: 'plan-review:pending', source: 'plan-review', kind: 'plan' as const, status: 'waiting' as const,
    title: `Plan Review: ${count} awaiting review`, detail: 'A teammate or agent submitted a plan that needs your decision', target, dismissKey: `plans:${count}`,
    actions: [{ id: 'review', label: 'Review', tone: 'primary' as const, run: () => runCommand?.('plan-review') }] }] : [], [count, target, runCommand])
  const island = useActivitySource(tuiActivityFeed, 'plan-review', rows)
  if (island || !count) return null
  return <box height={1} width={width} backgroundColor={theme.surface}><text fg={theme.amber} wrapMode="none" onMouseDown={() => runCommand?.('plan-review')}>{fitText(`Plan Review · ${count} awaiting review`, width)}</text></box>
}
export const widgets: PluginWidgetModule<(props: TuiPluginWidgetProps) => React.ReactNode> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'plan-review', widgets: { pending: Pending } }
