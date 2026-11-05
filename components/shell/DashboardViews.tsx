import type { ReactNode } from 'react'
import { LayoutDashboard, MessageSquare, UsersRound } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { DashboardTab } from '@/components/viewer-navigation/model'

export function DashboardViews({ value, onValueChange, children }: {
  value: DashboardTab; onValueChange: (value: DashboardTab) => void; children: ReactNode
}) {
  return <Tabs value={value} onValueChange={next => {
    if (next === 'sessions' || next === 'agents' || next === 'messaging') onValueChange(next)
  }} className="av-dashboard-tabs">
    <nav className="av-dashboard-tabbar" aria-label="Dashboard views">
      <TabsList variant="line" className="av-dashboard-tablist">
        <TabsTrigger value="sessions" className="av-dashboard-tab"><LayoutDashboard aria-hidden="true" /> Session Runs</TabsTrigger>
        <TabsTrigger value="agents" className="av-dashboard-tab"><UsersRound aria-hidden="true" /> Agent Operations</TabsTrigger>
        <TabsTrigger value="messaging" className="av-dashboard-tab"><MessageSquare aria-hidden="true" /> Messaging</TabsTrigger>
      </TabsList>
    </nav>
    {children}
  </Tabs>
}

export function DashboardView({ value, children }: { value: DashboardTab; children: ReactNode }) {
  return <TabsContent value={value} className="av-dashboard-tab-content">{children}</TabsContent>
}
