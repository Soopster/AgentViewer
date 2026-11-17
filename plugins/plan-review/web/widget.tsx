'use client'
import { useMemo, useSyncExternalStore } from 'react'
import { webActivityFeed } from '@/lib/plugins/activityFeed'
import { useActivitySource } from '@/lib/plugins/useActivityFeed'
import { dispatchPluginCommand } from '@/lib/plugins/commandBus'
import type { WebPluginWidget } from '@/components/shell/pluginTypes'
import { PLUGIN_API_VERSION, type PluginWidgetModule } from '@/lib/plugins/types'
import { latestPlan, planApproved, type PlanTarget } from '@/lib/plugins/planReview'
import { usePlanReviews } from '@/lib/plugins/usePlanReview'
import { modAppStore } from '@/lib/plugins/modApp'
function Pending({ services }: React.ComponentProps<WebPluginWidget>) {
  const app = useSyncExternalStore(modAppStore.subscribe, modAppStore.getSnapshot, modAppStore.getSnapshot)
  const selected = app.sessions.find(item => item.key === app.selectedKey)
  const target = selected && selected.cwd === services?.repository?.cwd ? selected.target as PlanTarget : undefined
  const { snapshot } = usePlanReviews(services?.['plan-review'], services?.repository?.cwd ?? null, target)
  const count = snapshot?.reviews.filter(review => !planApproved(review) && !review.deliveries.some(item => item.revision === latestPlan(review).hash && item.action === 'feedback' && item.status === 'sent')).length ?? 0
  const rows = useMemo(() => count ? [{ id: 'plan-review:pending', source: 'plan-review', kind: 'plan' as const, status: 'waiting' as const,
    title: `Plan Review: ${count} awaiting review`, detail: 'A teammate or agent submitted a plan that needs your decision', target, dismissKey: `plans:${count}`,
    actions: [{ id: 'review', label: 'Review', tone: 'primary' as const, run: () => { dispatchPluginCommand('plan-review') } }] }] : [], [count, target])
  const island = useActivitySource(webActivityFeed, 'plan-review', rows)
  if (island || !count) return null
  return <div role="status" className="rounded border bg-background px-3 py-2 text-xs shadow-sm">Plan Review · {count} awaiting review · open from the palette</div>
}
export const widgets: PluginWidgetModule<WebPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'plan-review', widgets: { pending: Pending } }
