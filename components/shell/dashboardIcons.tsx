'use client'

// Host icons a dashboard may name in its metadata (`dashboards[].icon`). A
// manifest stays metadata-only, so it names an icon rather than importing one;
// an unknown name falls back to the dashboard's glyph.
import type { ReactNode } from 'react'
import { LayoutDashboard, UsersRound } from 'lucide-react'

const ICONS: Record<string, (size: number) => ReactNode> = {
  'layout-dashboard': size => <LayoutDashboard size={size} strokeWidth={2.2} aria-hidden="true" />,
  'users-round': size => <UsersRound size={size} strokeWidth={2.2} aria-hidden="true" />,
}

export function DashboardIcon({ icon, glyph, size = 16 }: { icon?: string; glyph: string; size?: number }) {
  const render = icon ? ICONS[icon] : undefined
  return render ? <>{render(size)}</> : <span aria-hidden="true">{glyph}</span>
}
