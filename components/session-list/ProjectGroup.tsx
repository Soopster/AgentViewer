'use client'

import type { SessionMetadataCallbacks } from '@/components/session-catalog/actions'

import { memo, useState, useEffect, useMemo } from 'react'

import { sameProjectPath } from '@/lib/projectPaths'
import { sessionActivityMs } from '@/lib/sessionListModel'
import { isDateBucketCollapsedByDefault, splitSidebarDates } from '@/lib/sessionSidebarModel'
import type { Session } from '@/lib/types'

import { sessionTabKey } from './presentation'

import { SessionRowGroup } from './SessionRowGroup'

const EMPTY_SESSIONS: Session[] = []

export const ProjectGroup = memo(function ProjectGroup({
  name,
  projectKey,
  sessions,
  selectedId,
  selectedProject,
  hydrated,
  scrollToSessionKey,
  childrenByParentId,
  onSelect,
  onSelectProject,
  onRename,
  onTag,
  defaultCollapsed = false,
  dateGroups = false,
  tone,
}: {
  name: string
  projectKey: string
  sessions: Session[]
  selectedId: string | null
  selectedProject: string | null
  hydrated: boolean
  scrollToSessionKey?: string | null
  childrenByParentId?: Map<string, Session[]>
  onSelect: (session: Session) => void
  /** Omitted for groups that are not a project (NEEDS YOU, RUNNING, PINNED). */
  onSelectProject?: (projectDir: string, projectName: string, sessions: Session[]) => void
  onRename: SessionMetadataCallbacks['onRename']
  onTag: SessionMetadataCallbacks['onTag']
  /** Coordinator runs start folded, as in the TUI. */
  defaultCollapsed?: boolean
  /** Split the sessions into Today / Yesterday / Older when they span more than one. */
  dateGroups?: boolean
  /** The header's colour (the lifted groups'). */
  tone?: string
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [collapsedDates, setCollapsedDates] = useState<ReadonlySet<string>>(() => new Set())
  const dated = useMemo(() => dateGroups ? splitSidebarDates(sessions, sessionActivityMs) : null, [dateGroups, sessions])
  const [hovered, setHovered] = useState(false)
  const isProjectSelected = sameProjectPath(selectedProject, projectKey)
  const hasSelected = isProjectSelected || sessions.some((s) => sessionTabKey(s) === selectedId)

  useEffect(() => {
    if (!scrollToSessionKey) return
    if (sessions.some((session) => sessionTabKey(session) === scrollToSessionKey)) {
      setCollapsed(false)
    }
  }, [scrollToSessionKey, sessions])

  return (
    <div>
      {/* Group header */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`av-project-header ${isProjectSelected ? 'av-selected' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '8px 14px 8px 16px',
          userSelect: 'none',
          position: 'sticky',
          top: 0,
          borderBottom: '1px solid var(--border)',
          zIndex: 1,
        }}
      >
        {/* Chevron: collapses/expands */}
        <span
          onClick={() => setCollapsed(v => !v)}
          style={{ color: 'var(--text-3)', fontSize: 10, flexShrink: 0, cursor: 'pointer', padding: '2px 4px 2px 0' }}
        >
          {collapsed ? '▶' : '▼'}
        </span>
        {/* Name: loads project consolidated view */}
        <span
          onClick={() => onSelectProject ? onSelectProject(projectKey, name, sessions) : setCollapsed(v => !v)}
          className="av-project-name"
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.01em',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            color: tone,
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: isProjectSelected ? 'var(--violet)' : 'var(--text-3)',
            background: isProjectSelected ? 'rgba(139,128,240,0.12)' : 'var(--surface-3)',
            border: `1px solid ${isProjectSelected ? 'rgba(139,128,240,0.3)' : 'var(--border)'}`,
            borderRadius: 3,
            padding: '1px 6px',
            flexShrink: 0,
          }}
        >
          {sessions.length}
        </span>
      </div>

      {/* Sessions, by day when they span more than one */}
      {!collapsed && dated && dated.map((bucket) => {
        const bucketKey = `${projectKey}:date:${bucket.label}`
        // This month and Older start folded, as in the TUI; a click flips the default.
        const folded = collapsedDates.has(bucketKey) !== isDateBucketCollapsedByDefault(bucket.label)
        return (
          <div key={bucketKey}>
            <div onClick={() => setCollapsedDates((current) => { const next = new Set(current); if (next.has(bucketKey)) next.delete(bucketKey); else next.add(bucketKey); return next })}
              data-date-group={bucket.label}
              style={{ display: 'flex', gap: 6, padding: '4px 16px 4px 26px', fontSize: 11, color: 'var(--text-3)', cursor: 'pointer', userSelect: 'none' }}>
              <span style={{ fontSize: 9 }}>{folded ? '▶' : '▼'}</span>
              <span>{bucket.label}</span>
              <span style={{ marginLeft: 'auto' }}>{bucket.items.length}</span>
            </div>
            {folded ? null : bucket.items.map((session) => (
              <SessionRowGroup
                key={sessionTabKey(session)}
                session={session}
                selected={sessionTabKey(session) === selectedId}
                selectedId={selectedId}
                hydrated={hydrated}
                knownChildren={childrenByParentId?.get(session.sessionId) ?? EMPTY_SESSIONS}
                onSelect={onSelect}
                onRename={onRename}
                onTag={onTag}
              />
            ))}
          </div>
        )
      })}
      {!collapsed && !dated && sessions.map((session) => (
        <SessionRowGroup
          key={sessionTabKey(session)}
          session={session}
          selected={sessionTabKey(session) === selectedId}
          selectedId={selectedId}
          hydrated={hydrated}
          knownChildren={childrenByParentId?.get(session.sessionId) ?? EMPTY_SESSIONS}
          onSelect={onSelect}
          onRename={onRename}
          onTag={onTag}
        />
      ))}
    </div>
  )
})
