import type { ReactNode } from 'react'
import { SidebarInset } from '@/components/ui/sidebar'

export function ReaderPane({ children }: { children: ReactNode }) {
  return <SidebarInset style={{ position: 'relative' }}>
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', position: 'relative', flex: 1 }}>
      {children}
    </div>
  </SidebarInset>
}

export function ReaderPaneCollapseButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} title="Collapse message pane" className="av-hover-control" style={{
    position: 'absolute', top: 6, right: 8, zIndex: 10,
    background: 'var(--surface-2)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-3)',
    padding: '2px 6px', borderRadius: 6, lineHeight: 1, fontSize: 12,
  }}>›</button>
}

export function CollapsedReaderPane({ onExpand }: { onExpand: () => void }) {
  return <div style={{ width: 32, minWidth: 32, height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
    paddingTop: 10, borderLeft: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
    <button type="button" onClick={onExpand} title="Expand message pane" className="av-hover-control" style={{
      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: '4px 6px', borderRadius: 6, lineHeight: 1, fontSize: 14,
    }}>‹</button>
  </div>
}
