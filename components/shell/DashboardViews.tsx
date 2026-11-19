'use client'

import { usePluginDashboards } from './usePluginDashboards'
import { isPluginDashboardId } from '../../lib/plugins/dashboard'
import type { ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { DashboardTab } from '@/components/viewer-navigation/model'
import { DashboardIcon } from './dashboardIcons'

/** Every dashboard tab comes from plugin metadata; the shell owns only the tab bar. */
export function DashboardViews({ value, onValueChange, children }: {
  value: DashboardTab; onValueChange: (value: DashboardTab) => void; children: ReactNode
}) {
  const dashboards = usePluginDashboards()
  return <Tabs value={value} onValueChange={next => {
    if (isPluginDashboardId(next)) onValueChange(next)
  }} className="av-dashboard-tabs">
    <nav className="av-dashboard-tabbar" aria-label="Dashboard views">
      <TabsList variant="line" className="av-dashboard-tablist">
        {dashboards.map(dashboard => <TabsTrigger key={dashboard.id} value={dashboard.id} className="av-dashboard-tab"><DashboardIcon icon={dashboard.icon} glyph={dashboard.glyph} /> {dashboard.title}</TabsTrigger>)}
      </TabsList>
    </nav>
    {children}
  </Tabs>
}

export function DashboardView({ value, children }: { value: DashboardTab; children: ReactNode }) {
  return <TabsContent value={value} className="av-dashboard-tab-content">{children}</TabsContent>
}
