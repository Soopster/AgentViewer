'use client'

import { memo, useState, useEffect } from 'react'

import type { Session, SubagentSummary } from '@/lib/types'

import { sessionTabKey, formatCompactTokens } from './presentation'

import { SessionRow } from './SessionRow'

const SubagentSidebarRow = memo(function SubagentSidebarRow({
  summary,
  session,
  onSelect,
}: {
  summary: SubagentSummary
  session: Session
  onSelect: (session: Session) => void
}) {
  const label = summary.taskDescription?.trim() || summary.agentId
  return (
    <div
      onClick={() => onSelect(session)}
      className="av-session-row av-hover-control"
      title={summary.taskDescription || summary.agentId}
      style={{
        padding: '7px 16px 7px 44px',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: 'var(--text-2)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', gap: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)' }}>
        <span>{summary.agentId.slice(-8)}</span>
        <span>{summary.messageCount} msgs</span>
        <span>{formatCompactTokens(summary.usage.inputTokens)} ctx / {formatCompactTokens(summary.usage.outputTokens)} out</span>
      </div>
    </div>
  )
})

export const SessionRowGroup = memo(function SessionRowGroup({
  session,
  selected,
  selectedId,
  hydrated,
  knownChildren,
  onSelect,
  onRename,
  onTag,
}: {
  session: Session
  selected: boolean
  selectedId: string | null
  hydrated: boolean
  knownChildren: Session[]
  onSelect: (session: Session) => void
  onRename: (sessionId: string, title: string) => void
  onTag: (sessionId: string, tag: string | null) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [claudeSubagents, setClaudeSubagents] = useState<SubagentSummary[] | null>(null)
  const [loadingSubagents, setLoadingSubagents] = useState(false)
  const canHaveClaudeSubagents = !session.provider || session.provider === 'claude'
  const hasKnownChildren = knownChildren.length > 0
  const showDisclosure = hasKnownChildren || canHaveClaudeSubagents

  useEffect(() => {
    if (!expanded || !canHaveClaudeSubagents || claudeSubagents !== null || loadingSubagents) return
    let cancelled = false
    setLoadingSubagents(true)
    fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/subagents?${new URLSearchParams({ ...(session.provider ? { provider: session.provider } : {}), ...(session.providerInstanceId ? { providerInstanceId: session.providerInstanceId } : {}) })}`)
      .then((res) => (res.ok ? res.json() : { subagents: [] }))
      .then((data: { subagents?: SubagentSummary[] }) => {
        if (!cancelled) setClaudeSubagents(data.subagents ?? [])
      })
      .catch(() => {
        if (!cancelled) setClaudeSubagents([])
      })
      .finally(() => {
        if (!cancelled) setLoadingSubagents(false)
      })
    return () => { cancelled = true }
  }, [expanded, canHaveClaudeSubagents, claudeSubagents, loadingSubagents, session.sessionId, session.provider, session.providerInstanceId])

  const subagentCount = (claudeSubagents?.length ?? 0) + knownChildren.length

  return (
    <div>
      <div style={{ position: 'relative' }}>
        {showDisclosure && (
          <span
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
            title={expanded ? 'Collapse subagents' : 'Expand subagents'}
            style={{
              position: 'absolute',
              left: 8,
              top: 12,
              fontSize: 11,
              color: 'var(--text-3)',
              cursor: 'pointer',
              zIndex: 1,
              padding: 4,
            }}
          >
            {expanded ? '▾' : '▸'}
          </span>
        )}
        <SessionRow
          session={session}
          selected={selected}
          hydrated={hydrated}
          onSelect={onSelect}
          onRename={onRename}
          onTag={onTag}
        />
      </div>
      {expanded && (
        <div>
          {(hasKnownChildren || subagentCount > 0) && (
            <div
              style={{
                padding: '4px 16px 4px 32px',
                fontSize: 11,
                color: 'var(--text-3)',
              }}
            >
              Subagents {subagentCount > 0 ? `(${subagentCount})` : ''}
            </div>
          )}
          {knownChildren.map((child) => (
            <div key={sessionTabKey(child)} style={{ paddingLeft: 20 }}>
              <SessionRow
                session={child}
                selected={sessionTabKey(child) === selectedId}
                hydrated={hydrated}
                onSelect={onSelect}
                onRename={onRename}
                onTag={onTag}
              />
            </div>
          ))}
          {loadingSubagents && (
            <div style={{ padding: '6px 16px 6px 44px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)' }}>
              Loading…
            </div>
          )}
          {claudeSubagents?.map((summary) => (
            <SubagentSidebarRow key={summary.agentId} summary={summary} session={session} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
})
