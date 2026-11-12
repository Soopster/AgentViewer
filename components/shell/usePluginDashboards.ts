'use client'
import { useEffect } from 'react'
import { listPluginDashboards, type PluginDashboardId } from '../../lib/plugins/dashboard'
import { subscribePluginCommands } from '../../lib/plugins/commandBus'
import { isPluginEnabled } from '../../lib/plugins/enablement'
import { useDisabledPlugins } from '../../lib/plugins/useDisabledPlugins'

const dashboards = listPluginDashboards()
export function usePluginDashboards({ includeDisabled = false }: { includeDisabled?: boolean } = {}) {
  const disabled = useDisabledPlugins()
  return dashboards.filter(dashboard => includeDisabled || !disabled.has(dashboard.pluginId))
}
export function usePluginDashboardCommands(open: (id: PluginDashboardId) => void) {
  useEffect(() => subscribePluginCommands(id => {
    const dashboard = dashboards.find(dashboard => dashboard.command === id)
    if (!dashboard || !isPluginEnabled(dashboard.pluginId)) return false
    open(dashboard.id as PluginDashboardId)
    return true
  }), [open])
}
