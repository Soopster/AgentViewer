import type { Session } from '../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { SessionMessage } from '../../lib/types'
import type { RefObject } from 'react'
import type { ProviderComposerConfig } from '../../lib/providerComposer'
import type { JSX } from 'react'
import type { TaskRegistry } from '../../lib/taskRegistry'
import { type SessionDiagnosticSection } from '@/lib/types'
import { type ThreadedMessage } from '@/lib/threading'
import { messageToCopyText } from '@/lib/threadedMessageText'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import dynamic from 'next/dynamic'
import { Filter, Minimize2, Search, X } from 'lucide-react'
import { MessageDensityProvider, ViewModeProvider, DiffStyleProvider, DiffOptionsProvider, type MessageDensity, type WebViewMode } from '../MessageItem'
import { type PierreDiffStyle } from '../PierreDiffView'
import { QuestionAnswerComposerContext, DiffCommentComposerContext, LiveSubagentTextContext, TaskActiveFormsContext, type DiffOptions } from '../messageItemShared'
import { TaskRail } from '../TaskRail'
import MessageSessionVisualizer, { type MessageVisualizerRow } from '../MessageSessionVisualizer'
import StreamHistoryRail, { type StreamHistoryItem } from '../StreamHistoryRail'
import { type ColorTreatment } from '@/lib/colorTreatment'
import { type TimelineRow, type ActiveTranscriptFilter } from './types'
import { TIMELINE_TARGET_TOP_GUTTER_PX, TRANSCRIPT_FILTERS, TRANSCRIPT_FILTER_LABELS } from './constants'
import { LiveSpinner } from './composerUi'
import { DiffReviewMode, CLAUDE_DIAGNOSTIC_ACTIONS } from './lazyPanels'

type TimelineBodyProps = {
  maximized: boolean
  onToggleMaximized: (() => void) | undefined
  showReviewMode: boolean
  session: Session | null
  isProject: boolean
  threadedFull: ThreadedMessage[]
  diffStyle: PierreDiffStyle
  diffOptions: DiffOptions
  handleReviewJumpToMessage: (messageId: string) => void
  setShowReviewMode: Dispatch<SetStateAction<boolean>>
  showVisualizer: boolean
  visualizerRows: MessageVisualizerRow[]
  messages: SessionMessage[]
  loading: boolean
  handleVisualizerSelectMessage: (messageId: string) => void
  hasLiveTimeline: boolean
  transcriptSearch: string
  setTranscriptSearch: Dispatch<SetStateAction<string>>
  transcriptFilters: ActiveTranscriptFilter[]
  setTranscriptFilters: Dispatch<SetStateAction<ActiveTranscriptFilter[]>>
  bookmarksOnly: boolean
  bookmarkIds: Set<string>
  setBookmarksOnly: Dispatch<SetStateAction<boolean>>
  renderedTimelineRows: TimelineRow[]
  hasTranscriptFocus: boolean
  timelineRows: TimelineRow[]
  viewMode: WebViewMode
  streamHistoryItems: StreamHistoryItem[]
  timelineRef: RefObject<HTMLDivElement | null>
  timelineContentRef: RefObject<HTMLDivElement | null>
  handleJumpToMessage: (messageId: string) => void
  stickyHeaders: boolean
  stickyHeaderIndex: number | null
  timelineRowsRef: RefObject<TimelineRow[]>
  handleTimelineScroll: () => void
  showDiagnostics: boolean
  runClaudeSessionAction: (action: string, extra: Record<string, unknown>, busyKey: string, successNotice: string) => Promise<Record<string, unknown> | null>
  claudeMcpBusy: string | null
  diagnosticsLoading: boolean
  diagnosticSections: SessionDiagnosticSection[]
  addClaudeMcpServer: () => Promise<void>
  claudeHookQuery: string
  setClaudeHookQuery: Dispatch<SetStateAction<string>>
  searchClaudeHookEvents: () => Promise<void>
  claudeHookSearching: boolean
  claudeMcpPermissionModes: Record<string, 'default' | 'auto'>
  applyClaudeMcpPermissionMode: (serverName: string, permissionModeKey: string, mode: 'default' | 'auto' | null, previous: 'default' | 'auto' | undefined) => Promise<void>
  composerConfig: ProviderComposerConfig
  colorTreatment: ColorTreatment
  handleReusePrompt: (text: string) => void
  hasTranscriptTimeline: boolean
  timelineRenderedHeight: number
  timelineWidth: 'full' | 'centered'
  density: MessageDensity
  onOpenSession: ((session: Session) => void) | undefined
  turnDurations: Map<string, number>
  handleQuestionAnswerToComposer: (answer: string) => void
  handleDiffCommentToComposer: (prompt: string) => void
  liveSubagentText: Record<string, string>
  taskActiveForms: Map<string, string>
  timelineRowElements: JSX.Element[]
  autoFollow: boolean
  setAutoFollow: Dispatch<SetStateAction<boolean>>
  scrollTimelineToBottom: (behavior?: ScrollBehavior) => void
  taskRailOpen: boolean
  taskRegistry: TaskRegistry
  setTaskRailOpen: Dispatch<SetStateAction<boolean>>
  stopClaudeTask: (taskId: string) => Promise<void>
}

export function TimelineBody(props: TimelineBodyProps) {
  const {
    maximized, onToggleMaximized, showReviewMode, session, isProject, threadedFull, diffStyle,
    diffOptions, handleReviewJumpToMessage, setShowReviewMode, showVisualizer, visualizerRows,
    messages, loading, handleVisualizerSelectMessage, hasLiveTimeline, transcriptSearch,
    setTranscriptSearch, transcriptFilters, setTranscriptFilters, bookmarksOnly, bookmarkIds,
    setBookmarksOnly, renderedTimelineRows, hasTranscriptFocus, timelineRows, viewMode,
    streamHistoryItems, timelineRef, timelineContentRef, handleJumpToMessage, stickyHeaders,
    stickyHeaderIndex, timelineRowsRef, handleTimelineScroll, showDiagnostics,
    runClaudeSessionAction, claudeMcpBusy, diagnosticsLoading, diagnosticSections,
    addClaudeMcpServer, claudeHookQuery, setClaudeHookQuery, searchClaudeHookEvents,
    claudeHookSearching, claudeMcpPermissionModes, applyClaudeMcpPermissionMode, composerConfig,
    colorTreatment, handleReusePrompt, hasTranscriptTimeline, timelineRenderedHeight,
    timelineWidth, density, onOpenSession, turnDurations, handleQuestionAnswerToComposer,
    handleDiffCommentToComposer, liveSubagentText, taskActiveForms, timelineRowElements,
    autoFollow, setAutoFollow, scrollTimelineToBottom, taskRailOpen, taskRegistry, setTaskRailOpen,
    stopClaudeTask,
  } = props
  return (
    (
<div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
      {maximized && onToggleMaximized ? (
        <button
          type="button"
          className="av-hover-control"
          onClick={onToggleMaximized}
          title="Restore app chrome (Esc)"
          aria-label="Restore app chrome"
          style={{
            position: 'absolute',
            top: 12,
            right: 16,
            zIndex: 20,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-2)',
            cursor: 'pointer',
            boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
          }}
        >
          <Minimize2 size={14} aria-hidden="true" />
        </button>
      ) : null}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {!maximized && showReviewMode && session && !isProject ? (
          <DiffReviewMode
            session={session}
            messages={threadedFull}
            diffStyle={diffStyle}
            diffOptions={diffOptions}
            onJumpToMessage={handleReviewJumpToMessage}
            onClose={() => setShowReviewMode(false)}
          />
        ) : !maximized && showVisualizer ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              padding: '18px 24px',
            }}
          >
            <MessageSessionVisualizer
              rows={visualizerRows}
              rawEventCount={messages.length}
              loading={loading}
              showSession={isProject}
              onSelectMessage={handleVisualizerSelectMessage}
            />
          </div>
        ) : (
          <>
            {!maximized && !loading && hasLiveTimeline && (
              <div className="av-transcript-filter-panel">
                <label className="av-session-viz-search">
                  <Search aria-hidden="true" />
                  <input
                    aria-label="Search transcript"
                    value={transcriptSearch}
                    onChange={(event) => setTranscriptSearch(event.target.value)}
                    placeholder="Search turns, tools, paths, commands…"
                  />
                </label>
                <div className="av-session-viz-filterbar" aria-label="Transcript filters">
                  <Filter aria-hidden="true" />
                  {TRANSCRIPT_FILTERS.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      aria-pressed={filter.key === 'all' ? transcriptFilters.length === 0 : transcriptFilters.includes(filter.key)}
                      className={cn('av-hover-control', (filter.key === 'all' ? transcriptFilters.length === 0 : transcriptFilters.includes(filter.key)) && 'av-active')}
                      onClick={() => {
                        if (filter.key === 'all') {
                          setTranscriptFilters([])
                          return
                        }
                        const selectedFilter = filter.key
                        setTranscriptFilters((current) => (
                          current.includes(selectedFilter)
                            ? current.filter((activeFilter) => activeFilter !== selectedFilter)
                            : [...current, selectedFilter]
                        ))
                      }}
                    >
                      {filter.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={bookmarksOnly}
                    disabled={bookmarkIds.size === 0 && !bookmarksOnly}
                    className={cn('av-hover-control', 'av-session-viz-bookmark-filter', bookmarksOnly && 'av-active')}
                    title={bookmarkIds.size === 0 ? 'No bookmarks in this session yet' : 'Show only bookmarked messages'}
                    onClick={() => setBookmarksOnly((value) => !value)}
                  >
                    {bookmarksOnly ? '★' : '☆'} Bookmarks{bookmarkIds.size > 0 ? ` (${bookmarkIds.size})` : ''}
                  </button>
                </div>
                <div className="av-session-viz-result-count">
                  {renderedTimelineRows.length} shown
                </div>
                {hasTranscriptFocus && (
                  <div className="av-session-viz-focusbar">
                    <span className="av-session-viz-focus-count">
                      {renderedTimelineRows.length} of {timelineRows.length} turns
                    </span>
                    {transcriptFilters.map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        className="av-session-viz-focus-chip av-hover-control"
                        onClick={() => {
                          setTranscriptFilters((current) => current.filter((activeFilter) => activeFilter !== filter))
                        }}
                      >
                        Filter: {TRANSCRIPT_FILTER_LABELS.get(filter) ?? filter}
                        <X aria-hidden="true" />
                      </button>
                    ))}
                    {transcriptSearch.trim() && (
                      <button
                        type="button"
                        className="av-session-viz-focus-chip av-hover-control"
                        onClick={() => setTranscriptSearch('')}
                      >
                        Search: {transcriptSearch.trim()}
                        <X aria-hidden="true" />
                      </button>
                    )}
                    {bookmarksOnly && (
                      <button
                        type="button"
                        className="av-session-viz-focus-chip av-hover-control"
                        onClick={() => setBookmarksOnly(false)}
                      >
                        ★ Bookmarks only
                        <X aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="av-session-viz-clear-focus av-hover-control"
                      onClick={() => {
                        setTranscriptFilters([])
                        setTranscriptSearch('')
                        setBookmarksOnly(false)
                      }}
                    >
                      Clear all
                    </button>
                  </div>
                )}
              </div>
            )}
            <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {!maximized && viewMode === 'stream' && streamHistoryItems.length > 1 ? (
                <StreamHistoryRail
                  items={streamHistoryItems}
                  scrollRef={timelineRef}
                  contentRef={timelineContentRef}
                  anchorOffset={TIMELINE_TARGET_TOP_GUTTER_PX}
                  onSelect={handleJumpToMessage}
                />
              ) : null}
              {stickyHeaders && stickyHeaderIndex != null && timelineRowsRef.current[stickyHeaderIndex] ? (() => {
                const stickyMessage = timelineRowsRef.current[stickyHeaderIndex].message
                const stickyText = messageToCopyText(stickyMessage).trim().split('\n').find((line) => line.trim()) ?? ''
                return (
                  <button
                    type="button"
                    className="av-hover-control"
                    onClick={() => handleJumpToMessage(stickyMessage.uuid)}
                    title="Jump to this prompt"
                    style={{
                      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5,
                      display: 'block', width: '100%', padding: '6px 32px', border: 0,
                      borderBottom: '1px solid var(--border)', background: 'var(--surface-2)',
                      color: 'var(--text)', fontSize: 12, textAlign: 'left', cursor: 'pointer',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ color: 'var(--cyan)', marginRight: 8 }}>▸</span>{stickyText}
                  </button>
                )
              })() : null}
              <div
                ref={timelineRef}
                onScroll={handleTimelineScroll}
                className={cn(viewMode === 'stream' && 'av-stream-timeline-scroll')}
                style={{
                  height: '100%',
                  minHeight: 0,
                  overflow: 'auto',
                  overflowAnchor: 'none',
                  padding: viewMode === 'stream' && !maximized ? '28px 32px 72px 94px' : '28px 32px 72px',
                }}
              >
        {!maximized && showDiagnostics && !isProject && (
          <div
            style={{
              marginBottom: 18,
              padding: '14px 16px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--surface-2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <div style={{ fontFamily: "'Oxanium', monospace", fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                Session Diagnostics
              </div>
              {session?.provider === 'claude' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 5 }}>
                  {CLAUDE_DIAGNOSTIC_ACTIONS.map(([action, busyKey, label, notice, title]) => (
                    <button
                      key={action}
                      type="button"
                      className="av-hover-control"
                      onClick={() => { void runClaudeSessionAction(action, {}, busyKey, notice) }}
                      disabled={claudeMcpBusy !== null}
                      title={title}
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        color: 'var(--cyan)',
                        background: 'var(--surface)',
                        border: '1px solid rgba(56,217,245,0.3)',
                        borderRadius: 5,
                        padding: '3px 8px',
                        cursor: claudeMcpBusy !== null ? 'not-allowed' : 'pointer',
                        letterSpacing: '0.06em',
                        opacity: claudeMcpBusy !== null && claudeMcpBusy !== busyKey ? 0.45 : 1,
                      }}
                    >
                      {claudeMcpBusy === busyKey ? 'WORKING…' : label}
                    </button>
                  ))}
                </div>
              )}
              </div>
            {diagnosticsLoading ? (
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
                Loading diagnostics…
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                {diagnosticSections.map((section) => (
                  <div key={section.id}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>
                        {section.title}
                      </span>
                      {section.id === 'mcp' && session?.provider === 'claude' && (
                        <button
                          type="button"
                          className="av-hover-control"
                          onClick={() => { void addClaudeMcpServer() }}
                          disabled={claudeMcpBusy !== null}
                          title="Add a session-scoped MCP server"
                          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--green)', background: 'transparent', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 4, height: 18, padding: '0 5px', cursor: claudeMcpBusy ? 'not-allowed' : 'pointer' }}
                        >
                          + ADD
                        </button>
                      )}
                      {section.id === 'hooks' && session?.provider === 'claude' && (
                        <span style={{ display: 'flex', gap: 4, minWidth: 0 }}>
                          <input
                            aria-label="Search Claude hook timeline"
                            value={claudeHookQuery}
                            onChange={(event) => setClaudeHookQuery(event.target.value)}
                            onKeyDown={(event) => { if (event.key === 'Enter') void searchClaudeHookEvents() }}
                            placeholder="filter hooks"
                            style={{ width: 110, height: 18, padding: '0 5px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4 }}
                          />
                          <button
                            type="button"
                            className="av-hover-control"
                            onClick={() => { void searchClaudeHookEvents() }}
                            disabled={claudeHookSearching}
                            style={{ height: 18, padding: '0 5px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--cyan)', background: 'transparent', border: '1px solid rgba(56,217,245,0.3)', borderRadius: 4, cursor: claudeHookSearching ? 'wait' : 'pointer' }}
                          >
                            {claudeHookSearching ? '…' : 'SEARCH'}
                          </button>
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {section.id === 'mcp' && session?.provider === 'claude' ? (
                        section.items.map((item, index) => {
                          if (item === 'None') {
                            return <div key={`${section.id}-${index}`} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>None</div>
                          }
                          const [rawName, rawStatus] = item.split(' · ')
                          const name = rawName?.trim() ?? ''
                          const status = rawStatus?.trim() ?? ''
                          const dynamic = item.endsWith(' · dynamic')
                          const enabled = status !== 'disabled'
                          const permissionModeKey = `${session.sessionId}:${name}`
                          const appliedPermissionMode = claudeMcpPermissionModes[permissionModeKey]
                          const busyKey = `mcp:${name}`
                          const busy = claudeMcpBusy !== null
                          return (
                            <div
                              key={`${section.id}-${index}`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 6,
                                fontFamily: "'IBM Plex Mono', monospace",
                                fontSize: 11,
                                color: 'var(--text-2)',
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }} title={item}>
                                {name} <span style={{ color: enabled ? 'var(--green)' : 'var(--text-3)' }}>· {status}</span>
                              </span>
                              <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                <select
                                  aria-label={`Permission policy for MCP server ${name}`}
                                  title={`Claude permission policy for ${name}`}
                                  value={appliedPermissionMode ?? ''}
                                  disabled={busy}
                                  onChange={(event) => {
                                    const selected = event.target.value
                                    const mode = selected === 'clear' ? null : selected === 'auto' ? 'auto' : 'default'
                                    const previous = appliedPermissionMode
                                    void applyClaudeMcpPermissionMode(name, permissionModeKey, mode, previous)
                                  }}
                                  style={{
                                    height: 18,
                                    maxWidth: 82,
                                    fontFamily: "'IBM Plex Mono', monospace",
                                    fontSize: 11,
                                    color: 'var(--text-2)',
                                    background: 'var(--surface)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 4,
                                  }}
                                >
                                  <option value="" disabled>POLICY…</option>
                                  <option value="default">DEFAULT</option>
                                  <option value="auto">Auto</option>
                                  <option value="clear">CLEAR</option>
                                </select>
                                <button
                                  type="button"
                                  className="av-hover-control"
                                  onClick={() => runClaudeSessionAction('reconnectMcpServer', { serverName: name }, busyKey, `Reconnected ${name}.`)}
                                  disabled={busy}
                                  title={`Reconnect ${name}`}
                                  style={{
                                    fontFamily: "'IBM Plex Mono', monospace",
                                    fontSize: 11,
                                    color: 'var(--cyan)',
                                    background: 'transparent',
                                    border: '1px solid rgba(56,217,245,0.3)',
                                    borderRadius: 4,
                                    padding: '0 5px',
                                    height: 18,
                                    cursor: busy ? 'not-allowed' : 'pointer',
                                    letterSpacing: '0.06em',
                                    opacity: busy ? 0.5 : 1,
                                  }}
                                >
                                  RECONN
                                </button>
                                <button
                                  type="button"
                                  className="av-hover-control"
                                  onClick={() => runClaudeSessionAction('toggleMcpServer', { serverName: name, enabled: !enabled }, `mcp:toggle:${name}`, `${enabled ? 'Disabled' : 'Enabled'} ${name}.`)}
                                  disabled={busy}
                                  title={`${enabled ? 'Disable' : 'Enable'} ${name}`}
                                  style={{
                                    fontFamily: "'IBM Plex Mono', monospace",
                                    fontSize: 11,
                                    color: enabled ? 'var(--yellow)' : 'var(--green)',
                                    background: 'transparent',
                                    border: enabled ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(74,222,128,0.3)',
                                    borderRadius: 4,
                                    padding: '0 5px',
                                    height: 18,
                                    cursor: busy ? 'not-allowed' : 'pointer',
                                    letterSpacing: '0.06em',
                                    opacity: busy ? 0.5 : 1,
                                  }}
                                >
                                  {enabled ? 'DISABLE' : 'ENABLE'}
                                </button>
                                {dynamic && (
                                  <button
                                    type="button"
                                    className="av-hover-control"
                                    onClick={() => runClaudeSessionAction('setMcpServers', { operation: 'remove', serverName: name }, `mcp:remove:${name}`, `Removed dynamic MCP server ${name}.`)}
                                    disabled={busy}
                                    title={`Remove dynamic MCP server ${name}`}
                                    style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--red)', background: 'transparent', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 4, padding: '0 5px', height: 18, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 }}
                                  >
                                    REMOVE
                                  </button>
                                )}
                              </span>
                            </div>
                          )
                        })
                      ) : (
                        section.items.map((item, index) => (
                          <div key={`${section.id}-${index}`} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-2)' }}>
                            {item}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {loading && (
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              color: 'var(--text-3)',
              letterSpacing: '0.04em',
            }}
          >
            Loading…
          </div>
        )}
        {!loading && !hasLiveTimeline && (
          session ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                maxWidth: 640,
                padding: '20px 18px',
                borderRadius: 10,
                border: `1px solid rgba(${composerConfig.cssAccentRgb},0.28)`,
                background: colorTreatment === 'flat'
                  ? `rgba(${composerConfig.cssAccentRgb},0.06)`
                  : `linear-gradient(180deg, rgba(${composerConfig.cssAccentRgb},0.08), transparent 70%)`,
              }}
            >
              <div style={{
                fontFamily: "'Oxanium', monospace",
                fontSize: 16,
                fontWeight: 600,
                color: `var(${composerConfig.cssAccentVar})`,
                letterSpacing: '0.04em',
              }}>
                {composerConfig.welcomeTitle}
              </div>
              <div style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: 'var(--text-3)',
                letterSpacing: '0.04em',
              }}>
                {composerConfig.welcomeSubtitle}
              </div>
              {session.cwd && (
                <div style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  color: 'var(--text-3)',
                  letterSpacing: '0.02em',
                }}>
                  cwd <span style={{ color: 'var(--text-2)' }}>{session.cwd}</span>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {composerConfig.welcomeBullets.map((bullet) => (
                  <button
                    key={bullet}
                    type="button"
                    className="av-hover-control"
                    onClick={() => handleReusePrompt(bullet)}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 10,
                      textAlign: 'left',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '8px 12px',
                      cursor: 'pointer',
                      fontFamily: "'IBM Plex Sans', sans-serif",
                      fontSize: 13,
                      color: 'var(--text)',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background = `rgba(${composerConfig.cssAccentRgb},0.10)`
                      event.currentTarget.style.borderColor = `rgba(${composerConfig.cssAccentRgb},0.45)`
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = 'transparent'
                      event.currentTarget.style.borderColor = 'var(--border)'
                    }}
                  >
                    <span style={{ color: `var(${composerConfig.cssAccentVar})`, fontWeight: 600 }}>{composerConfig.glyph}</span>
                    <span>{bullet}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No messages.</div>
          )
        )}
        {!loading && hasLiveTimeline && !hasTranscriptTimeline && (
          <div className="av-transcript-no-results">
            No messages match the current filter.
          </div>
        )}
        {!loading && hasTranscriptTimeline && (
          <div style={{ position: 'relative' }}>
            {viewMode !== 'stream' && viewMode !== 'agents' && (
            <div
              className="timeline-line"
              style={{
                position: 'absolute',
                left: 9,
                top: 10,
                height: Math.max(timelineRenderedHeight - 10, 0),
                width: 2,
                borderRadius: 999,
                background: 'linear-gradient(to bottom, color-mix(in srgb, var(--border-2) 92%, var(--text-2)) 0%, var(--border-2) 70%, transparent 100%)',
                boxShadow: '0 0 0 1px color-mix(in srgb, var(--bg) 72%, transparent), 0 0 10px color-mix(in srgb, var(--border-2) 38%, transparent)',
                pointerEvents: 'none',
              }}
            />
            )}
            <div
              ref={timelineContentRef}
              style={{
                position: 'relative',
                minHeight: timelineRenderedHeight,
                height: timelineRenderedHeight,
                // Centered width caps the measure so lines stay readable on
                // wide monitors instead of spanning the viewport. Stream is
                // prose-first and reads best narrower; card views keep more
                // room for tool cards and diffs.
                maxWidth: timelineWidth === 'centered' ? (viewMode === 'stream' ? 900 : 1040) : undefined,
                marginInline: timelineWidth === 'centered' ? 'auto' : undefined,
              }}
            >
              <MessageDensityProvider session={session ?? undefined} density={density} onOpenSession={onOpenSession} turnDurations={turnDurations}>
              <ViewModeProvider mode={viewMode}>
              <DiffStyleProvider diffStyle={diffStyle}>
              <DiffOptionsProvider options={diffOptions}>
              <QuestionAnswerComposerContext.Provider value={handleQuestionAnswerToComposer}>
              <DiffCommentComposerContext.Provider value={handleDiffCommentToComposer}>
                <LiveSubagentTextContext.Provider value={liveSubagentText}>
                  <TaskActiveFormsContext.Provider value={taskActiveForms}>
                    {timelineRowElements}
                  </TaskActiveFormsContext.Provider>
                </LiveSubagentTextContext.Provider>
              </DiffCommentComposerContext.Provider>
              </QuestionAnswerComposerContext.Provider>
              </DiffOptionsProvider>
              </DiffStyleProvider>
              </ViewModeProvider>
              </MessageDensityProvider>
            </div>
          </div>
        )}
        {!maximized && hasTranscriptTimeline && (
          <div style={{ position: 'sticky', bottom: 12, display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            {autoFollow ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: '1px solid color-mix(in srgb, var(--cyan) 35%, var(--border))',
                  background: colorTreatment === 'flat'
                    ? 'color-mix(in srgb, var(--cyan) 10%, var(--surface))'
                    : 'linear-gradient(110deg, color-mix(in srgb, var(--cyan) 10%, var(--surface)), color-mix(in srgb, var(--violet) 10%, var(--surface)))',
                  boxShadow: '0 10px 30px var(--cyan-glow), inset 0 0 14px var(--violet-glow)',
                }}
              >
                <LiveSpinner label="waiting for new messages" />
              </div>
            ) : (
              <Button
                onClick={() => {
                  setAutoFollow(true)
                  scrollTimelineToBottom()
                }}
                size="sm"
                style={{
                  height: 28,
                  padding: '0 10px',
                  borderRadius: 999,
                  border: '1px solid rgba(56,217,245,0.24)',
                  background: 'var(--surface)',
                  color: 'var(--cyan)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  letterSpacing: '0.05em',
                  cursor: 'pointer',
                  boxShadow: '0 10px 30px var(--cyan-glow)',
                }}
              >
                FOLLOW LIVE
              </Button>
            )}
          </div>
        )}
            </div>
            </div>
          </>
        )}
      </div>
      {!maximized && taskRailOpen && taskRegistry.size > 0 && (
        <TaskRail
          registry={taskRegistry}
          onJumpToEvent={handleJumpToMessage}
          onClose={() => setTaskRailOpen(false)}
          onStopTask={session?.provider === 'claude' ? stopClaudeTask : undefined}
        />
      )}
      </div>
)
  )
}
