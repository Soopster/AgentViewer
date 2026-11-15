'use client'
import { useSyncExternalStore } from 'react'
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
  if (!count) return null
  return <div role="status" className="rounded border bg-background px-3 py-2 text-xs shadow-sm">Plan Review · {count} awaiting review · open from the palette</div>
}
export const widgets: PluginWidgetModule<WebPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'plan-review', widgets: { pending: Pending } }
