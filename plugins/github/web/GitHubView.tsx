'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ActionsTab } from './ActionsTab'
import { InboxTab } from './InboxTab'
import { IssuesTab } from './IssuesTab'
import { OverviewTab } from './OverviewTab'
import { PullsTab } from './PullsTab'
import { ReleasesTab } from './ReleasesTab'
import { SecurityTab } from './SecurityTab'

type Tab = 'overview' | 'inbox' | 'prs' | 'issues' | 'actions' | 'releases' | 'security'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'inbox', label: 'Inbox' }, { id: 'prs', label: 'Pull requests' }, { id: 'issues', label: 'Issues' },
  { id: 'actions', label: 'Actions' }, { id: 'releases', label: 'Releases' }, { id: 'security', label: 'Security' },
]

export function GitHubView({ cwd, docked, onClose, onAskAgent }: { cwd: string; docked: boolean; onClose: () => void; onAskAgent: (text: string) => void }) {
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => {
    if (docked) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, onClose])

  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--border-2)', flexWrap: 'wrap' }}>
        <strong style={{ marginRight: 12 }}>GitHub</strong>
        {TABS.map((entry) => <Button key={entry.id} size="sm" variant={tab === entry.id ? 'secondary' : 'ghost'} onClick={() => setTab(entry.id)}>{entry.label}</Button>)}
        <span style={{ flex: 1 }} />
        {!docked ? <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button> : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'overview' ? <OverviewTab cwd={cwd} go={setTab} /> : null}
        {tab === 'inbox' ? <InboxTab cwd={cwd} onAskAgent={onAskAgent} /> : null}
        {tab === 'prs' ? <PullsTab cwd={cwd} onAskAgent={onAskAgent} /> : null}
        {tab === 'issues' ? <IssuesTab cwd={cwd} onAskAgent={onAskAgent} /> : null}
        {tab === 'actions' ? <ActionsTab cwd={cwd} onAskAgent={onAskAgent} /> : null}
        {tab === 'releases' ? <ReleasesTab cwd={cwd} /> : null}
        {tab === 'security' ? <SecurityTab cwd={cwd} onAskAgent={onAskAgent} /> : null}
      </div>
    </div>
  )
  if (docked) return body
  return (
    <div role="dialog" aria-label="GitHub" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: 'min(1100px, calc(100vw - 32px))', height: 'min(760px, calc(100vh - 32px))', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.3)' }}>
        {body}
      </div>
    </div>
  )
}
