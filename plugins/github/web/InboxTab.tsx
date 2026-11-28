'use client'

import type { GithubInbox, GithubInboxItem } from '@/lib/github/types'
import { Button } from '@/components/ui/button'
import { Message, Pill, Row, Status, api, muted, q, useAction, useRemote, when } from './shared'

export function InboxTab({ cwd, onAskAgent }: { cwd: string; onAskAgent: (text: string) => void }) {
  const { data, error, loading, reload } = useRemote<{ inbox: GithubInbox }>(`/api/github/inbox?${q({ cwd })}`)
  const action = useAction(reload)
  const inbox = data?.inbox
  if (inbox && !inbox.availability.ok) return <div style={{ padding: 16 }}>{inbox.availability.message}</div>
  return (
    <Status loading={loading && !inbox} error={error}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, padding: '6px 12px' }}>
        {inbox && inbox.notifications.length > 0 ? <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => void action.run(() => api('/api/github/notifications', { cwd, all: true }).then(() => undefined), 'Marked all read')}>Mark all read</Button> : null}
        <Button size="sm" variant="ghost" onClick={reload}>Refresh</Button>
      </div>
      <div style={{ padding: '0 12px' }}><Message message={action.message} /></div>
      {inbox?.sections.map((section) => (
        <div key={section.id}>
          <div style={{ padding: '6px 12px', fontWeight: 600 }}>{section.title} <span style={muted}>{section.items.length}</span></div>
          {section.items.length === 0 ? <div style={{ padding: '0 12px 8px', ...muted }}>Nothing here.</div> : null}
          {section.items.map((item: GithubInboxItem) => (
            <Row key={`${item.repo}#${item.number}`}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <a href={item.url} target="_blank" rel="noreferrer" style={{ flex: 1 }}>{item.isDraft ? <Pill>draft</Pill> : null}{item.title}</a>
                <Button size="sm" variant="ghost" onClick={() => onAskAgent(`Look at ${item.kind === 'pr' ? 'pull request' : 'issue'} #${item.number} (${item.url}): ${item.title}`)}>Ask agent</Button>
              </div>
              <div style={muted}>#{item.number} · {item.author} · {when(item.updatedAt)}{item.labels.length ? ` · ${item.labels.join(', ')}` : ''}</div>
            </Row>
          ))}
        </div>
      ))}
      {inbox && inbox.notifications.length > 0 ? (
        <div>
          <div style={{ padding: '6px 12px', fontWeight: 600 }}>Notifications <span style={muted}>{inbox.notifications.length}</span></div>
          {inbox.notifications.map((note) => (
            <Row key={note.id}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <a href={note.url} target="_blank" rel="noreferrer" style={{ flex: 1 }}>{note.title}</a>
                <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => void action.run(() => api('/api/github/notifications', { cwd, id: note.id }).then(() => undefined), 'Marked read')}>Done</Button>
              </div>
              <div style={muted}>{note.repo} · {note.reason.replace(/_/g, ' ')} · {when(note.updatedAt)}</div>
            </Row>
          ))}
        </div>
      ) : null}
    </Status>
  )
}
