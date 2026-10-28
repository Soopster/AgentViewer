/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { TeamAttention } from '../../teamAttentionStore'
import React from 'react'
import { TextAttributes } from '@opentui/core'
import { formatProviderLabel, formatSessionTitle } from '../../../format'
import { getProviderAccent, type TuiDensity } from '../../../theme'
import { type Session, type SubagentSummary } from '../../../../lib/types'
import { fitText, joinMeta } from '../../textLayout'
import { type MenuPoint, type SidebarEntry, type SidebarSubagentEntry } from '../types'
import { fmtTokens } from '../contextMeter'
import { timeAgo } from '../format'
import { sessionKey, isSessionRecentlyTouched } from '../sessionList'
import { mixHexColor } from '../transcriptStyle'
import { sessionProviderLabel } from '../pickers'

export type BuildSidebarRowContext = {
  sidebarEntries: SidebarEntry[]
  sidebarInnerWidth: number
  firstSidebarEntryKey: string
  theme: TuiThemePalette
  sidebarSessionActivity: Map<string, 'needs-input' | 'running' | 'waiting'>
  showProviderInSessionRows: boolean
  selectSidebarSession: (session: Session) => void
  setSidebarSubagentCursor: React.Dispatch<React.SetStateAction<string | null>>
  setSubagentTranscriptSelection: React.Dispatch<React.SetStateAction<{ parent: Session; agent: SubagentSummary; } | null>>
  setPluginOverlay: React.Dispatch<React.SetStateAction<'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'terminal' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk' | null>>
  recentlyWrittenKeys: ReadonlySet<string>
  teamAttention: TeamAttention
  density: TuiDensity
  renameSessionKey: string | null
  childrenByParentId: Map<string, SidebarSubagentEntry[]>
  splitPaneActions: { close: (paneIndex: number) => void; promote: (session: Session) => void; openLayout: () => void; fullscreen: () => void; sessionMenu: (session: Session, source: 'rail' | 'tab' | 'pane', point: MenuPoint, paneIndex?: number) => void; }
  sessionDragHandlers: { press: (session: Session, fromPane: number | null, event: { x: number; y: number; }, onClick?: () => void) => void; move: (event: { x: number; y: number; }) => void; release: (event: { x: number; y: number; }) => void; }
  renameDraft: string
  setRenameDraft: React.Dispatch<React.SetStateAction<string>>
  commitRename: () => Promise<void>
  toggleSidebarSubagents: (parent: Session) => void
  collapsedSubagentSet: Set<string>
}

export function runBuildSidebarRow(ctx: BuildSidebarRowContext, entry: SidebarEntry, selected: boolean) {
  const {
    sidebarEntries, sidebarInnerWidth, firstSidebarEntryKey, theme, sidebarSessionActivity,
    showProviderInSessionRows, selectSidebarSession, setSidebarSubagentCursor,
    setSubagentTranscriptSelection, setPluginOverlay, recentlyWrittenKeys, teamAttention, density,
    renameSessionKey, childrenByParentId, splitPaneActions, sessionDragHandlers, renameDraft,
    setRenameDraft, commitRename, toggleSidebarSubagents, collapsedSubagentSet,
  } = ctx
  if (entry.type === 'project') {
    const countLabel = `${entry.count}`
    const projectLabel = fitText(entry.projectName, Math.max(sidebarInnerWidth - countLabel.length - 5, 1)).trimEnd()
    return (
      <box
        key={entry.key}
        id={`sidebar:${entry.key}`}
        paddingX={1}
        // A blank row separates groups; the first has the rail's own title
        // above it and nothing to be separated from.
        marginTop={entry.key === firstSidebarEntryKey ? 0 : 1}
        backgroundColor={theme.surface}
      >
        <text fg={theme.dim} wrapMode="none">
          {fitText(`${projectLabel} / ${countLabel}`, sidebarInnerWidth - 2)}
        </text>
      </box>
    )
  }

  if (entry.type === 'subagent') {
    const subagentEntry = entry.entry
    const accent = getProviderAccent(
      subagentEntry.kind === 'session'
        ? (subagentEntry.session.provider ?? 'claude')
        : (subagentEntry.summary.provider ?? entry.parentSession.provider ?? 'claude'),
    )
    const label = subagentEntry.kind === 'session'
      ? formatSessionTitle(subagentEntry.session) || subagentEntry.session.sessionId.slice(-8)
      : (subagentEntry.summary.taskDescription?.trim() || subagentEntry.summary.agentId.slice(-8))
    const summaryTokens = subagentEntry.kind === 'summary'
      ? subagentEntry.summary.usage.totalTokens
        ?? (subagentEntry.summary.usage.inputTokens + subagentEntry.summary.usage.outputTokens)
      : 0
    const detail = subagentEntry.kind === 'session'
      ? (() => {
          const activity = sidebarSessionActivity.get(sessionKey(subagentEntry.session))
          const marker = activity === 'needs-input' ? '⚠'
            : activity === 'running' ? '●'
            : activity === 'waiting' ? '◌'
            : isSessionRecentlyTouched(subagentEntry.session) ? '·'
            : null
          return joinMeta([
            showProviderInSessionRows ? sessionProviderLabel(subagentEntry.session) : null,
            `${timeAgo(subagentEntry.session.lastModified ?? subagentEntry.session.createdAt)}${marker ? ` ${marker}` : ''}`,
          ])
        })()
      : joinMeta([
          showProviderInSessionRows
            ? formatProviderLabel(subagentEntry.summary.provider ?? entry.parentSession.provider)
            : null,
          `${subagentEntry.summary.messageCount} msgs`,
          summaryTokens > 0 ? `${fmtTokens(summaryTokens)} tokens` : null,
        ])
    return (
      <box
        key={entry.key}
        id={`sidebar:${entry.key}`}
        flexDirection="column"
        paddingLeft={Math.min(entry.depth + 1, 5)}
        backgroundColor={selected ? theme.surface3 : theme.surface}
        onMouseDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          if (subagentEntry.kind === 'session') selectSidebarSession(subagentEntry.session)
          else {
            setSidebarSubagentCursor(entry.key)
            setSubagentTranscriptSelection({ parent: entry.parentSession, agent: subagentEntry.summary })
            setPluginOverlay('subagents')
          }
        }}
      >
        <text fg={selected ? accent : theme.muted} wrapMode="none">
          {fitText(`${selected ? '▎' : ' '} ${'↪'.repeat(Math.min(entry.depth, 3))} ${label}`, sidebarInnerWidth - 2)}
        </text>
        {detail && (
          <text fg={selected ? accent : theme.muted} wrapMode="none">
            {fitText(`${selected ? '▎' : ' '}   ${detail}`, sidebarInnerWidth - 2)}
          </text>
        )}
      </box>
    )
  }

  const sessionAccent = getProviderAccent(entry.session.provider ?? 'claude')
  const activityTime = entry.session.lastModified ?? entry.session.createdAt
  const recentlyTouched = isSessionRecentlyTouched(entry.session)
  const knownActivity = sidebarSessionActivity.get(sessionKey(entry.session))
  // Written to in the last couple of minutes by something this host is not
  // running — a native CLI in another terminal. Shown as working, in green
  // rather than the provider accent, so the two sources stay tellable apart.
  const activity = knownActivity ?? (recentlyWrittenKeys.has(sessionKey(entry.session)) ? 'active' : undefined)
  const ago = activity === 'running' ? 'now' : timeAgo(activityTime)
  const activityGlyph = activity === 'needs-input' ? '⚠'
    : activity === 'running' || activity === 'active' ? '●'
    : activity === 'waiting' ? '◌'
    : recentlyTouched ? '·'
    : null
  const activityColor = activity === 'needs-input' ? theme.amber
    : activity === 'running' ? sessionAccent
    : activity === 'active' ? theme.green
    : activity === 'waiting' ? theme.cyan
    : theme.dim
  // The selected row is tinted with its provider's accent across the full
  // rail width; surface3 alone sits too close to the rail's own surface in
  // most themes to find at a glance.
  const selectedRowBg = mixHexColor(sessionAccent, theme.surface, 0.22) ?? theme.surface3
  const rowBg = selected ? selectedRowBg : theme.surface

  const metaLine = joinMeta([
    activity === 'needs-input' ? 'Needs input'
      : activity === 'running' || activity === 'active' ? 'Working'
      : activity === 'waiting' ? 'Waiting' : null,
    showProviderInSessionRows ? sessionProviderLabel(entry.session) : null,
    ago,
  ])
  // Waiting outranks a result, as on the web row: a question blocks a
  // teammate, a result only waits to be read.
  const team = teamAttention.get(sessionKey(entry.session))
  const teamMark = team ? (team.waiting > 0 ? ` !${team.waiting}` : ` ✓${team.finished}`) : ''
  // Only the comfortable density spends a second row on the age. Otherwise it
  // rides the title's row, right-aligned, and the activity glyph stands in
  // for the word — twice the sessions in the same rail.
  const singleRow = density !== 'comfortable' && sessionKey(entry.session) !== renameSessionKey
  const rowMeta = joinMeta([
    showProviderInSessionRows ? sessionProviderLabel(entry.session) : null,
    ago,
  ])
  // "Recently touched" is the age itself on this row; only a turn's state
  // earns a glyph. Marks sit before the age so the ages stay one flush column.
  const settled = Boolean(entry.session.inbox?.settledAt)
  const rowGlyph = activity ? activityGlyph : settled ? '✓' : null
  const subagentDisclosureWidth = (childrenByParentId.get(sessionKey(entry.session))?.length ?? 0) > 0 ? 2 : 0
  const rowTitleWidth = Math.max(
    sidebarInnerWidth - 3 - subagentDisclosureWidth - (rowMeta ? rowMeta.length + 1 : 0) - teamMark.length - (rowGlyph ? 2 : 0),
    4,
  )

  return (
    <box
      key={entry.key}
      id={`sidebar:${entry.key}`}
      flexDirection="column"
      backgroundColor={rowBg}
      marginBottom={density === 'comfortable' ? 1 : 0}
      // Its text is not selectable: a press on selectable text starts a text
      // selection, which takes the drag away from the row.
      // Selects on release, not press: a press that moves is a drag onto the
      // window area, and selecting on press would put the session in the
      // reader before it could be dropped beside it.
      onMouseDown={(event) => {
        if (event.button === 2) {
          event.stopPropagation()
          splitPaneActions.sessionMenu(entry.session, 'rail', event)
          return
        }
        if (event.button !== 0) return
        event.stopPropagation()
        if (sessionKey(entry.session) === renameSessionKey) return
        sessionDragHandlers.press(entry.session, null, event, () => selectSidebarSession(entry.session))
      }}
      onMouseDrag={(event) => sessionDragHandlers.move(event)}
      onMouseUp={(event) => {
        if (event.button !== 0) return
        sessionDragHandlers.release(event)
      }}
    >
      {sessionKey(entry.session) === renameSessionKey ? (
        <box paddingX={1} backgroundColor={theme.surface3}>
          <input
            focused
            value={renameDraft}
            maxLength={80}
            onInput={(v: string) => setRenameDraft(v)}
            onSubmit={commitRename}
          />
        </box>
      ) : (
        <box paddingX={1} flexDirection="row" backgroundColor={rowBg}>
          <text fg={sessionAccent} wrapMode="none" selectable={false}>{selected ? '▎' : ' '}</text>
          {(childrenByParentId.get(sessionKey(entry.session))?.length ?? 0) > 0 ? <text
            id={`sidebar-subagents-toggle:${sessionKey(entry.session)}`} fg={sessionAccent} selectable={false}
            onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); toggleSidebarSubagents(entry.session) } }}
          >{collapsedSubagentSet.has(sessionKey(entry.session)) ? '▸ ' : '▾ '}</text> : null}
          {/* Keep the title readable; provider identity belongs to the rail. */}
          <text fg={settled && !activity ? theme.muted : theme.text} attributes={selected ? TextAttributes.BOLD : undefined} wrapMode="none" selectable={false}>
            {fitText(formatSessionTitle(entry.session), singleRow ? rowTitleWidth : sidebarInnerWidth - 3 - subagentDisclosureWidth)}
          </text>
          {singleRow ? (
            <>
              {teamMark ? <text fg={team!.waiting > 0 ? theme.amber : theme.green} wrapMode="none" selectable={false}>{teamMark}</text> : null}
              {rowGlyph ? <text fg={activity ? activityColor : theme.green} wrapMode="none" selectable={false}>{` ${rowGlyph}`}</text> : null}
              {rowMeta ? <text fg={activity === 'needs-input' ? theme.amber : theme.dim} wrapMode="none" selectable={false}>{` ${rowMeta}`}</text> : null}
            </>
          ) : null}
        </box>
      )}
      {singleRow ? null : (
      <box paddingX={1} flexDirection="row" backgroundColor={rowBg}>
        <text fg={sessionAccent} wrapMode="none" selectable={false}>{selected ? '▎' : ' '}</text>
        <text fg={activity === 'needs-input' ? theme.amber : theme.dim} wrapMode="none" selectable={false}>
          {fitText(metaLine, sidebarInnerWidth - 3 - (activityGlyph ? 2 : 0) - teamMark.length)}
        </text>
        {teamMark ? <text fg={team!.waiting > 0 ? theme.amber : theme.green} wrapMode="none" selectable={false}>{teamMark}</text> : null}
        {activityGlyph ? <text fg={activityColor} wrapMode="none" selectable={false}>{` ${activityGlyph}`}</text> : null}
      </box>
      )}
    </box>
  )
}
