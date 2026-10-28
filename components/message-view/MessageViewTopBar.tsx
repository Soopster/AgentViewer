import type { Session } from '../../lib/types'
import type { SessionMessage } from '../../lib/types'
import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { TaskRegistry } from '../../lib/taskRegistry'
import type { SessionCapabilities } from '../../lib/types'
import Link from 'next/link'
import { type ContextUsage, type SessionInfo } from '@/lib/types'
import { type ThreadedMessage } from '@/lib/threading'
import { Button } from '@/components/ui/button'
import { dispatchPluginCommand } from '@/lib/plugins/commandBus'
import { ChartNetwork, FileCode2, Fullscreen, Maximize2, PanelRight, Terminal } from 'lucide-react'
import { type MessageDensity, type WebViewMode } from '../MessageItem'
import { type PierreDiffStyle } from '../PierreDiffView'
import { type DiffOptions } from '../messageItemShared'
import CodeThemeToggle from '../CodeThemeToggle'
import RenderFontToggle from '../RenderFontToggle'
import { applyColorTreatment, type ColorTreatment } from '@/lib/colorTreatment'
import { WEB_TOOLBAR_PLUGIN_COMMANDS } from './lazyPanels'

type MessageViewTopBarProps = {
  maximized: boolean
  colorTreatment: ColorTreatment
  isProject: boolean
  dirName: string
  projectView: { key: string; sessionCount: number; providerMode: 'current' | 'all'; }
  session: Session | null
  sessionInfo: SessionInfo | null
  contextUsage: ContextUsage | null
  disabledPlugins: ReadonlySet<string>
  loading: boolean
  threaded: ThreadedMessage[]
  messages: SessionMessage[]
  viewDropdownRef: RefObject<HTMLDivElement | null>
  setViewDropdownOpen: Dispatch<SetStateAction<boolean>>
  setActionsDropdownOpen: Dispatch<SetStateAction<boolean>>
  viewDropdownOpen: boolean
  setShowVisualizer: Dispatch<SetStateAction<boolean>>
  setShowReviewMode: Dispatch<SetStateAction<boolean>>
  showVisualizer: boolean
  showReviewMode: boolean
  taskRegistry: TaskRegistry
  setTaskRailOpen: Dispatch<SetStateAction<boolean>>
  taskRailOpen: boolean
  setViewMode: Dispatch<SetStateAction<WebViewMode>>
  viewMode: WebViewMode
  setDensity: Dispatch<SetStateAction<MessageDensity>>
  density: MessageDensity
  setTimelineWidth: Dispatch<SetStateAction<'full' | 'centered'>>
  timelineWidth: 'full' | 'centered'
  setStickyHeaders: Dispatch<SetStateAction<boolean>>
  stickyHeaders: boolean
  setDiffStyle: Dispatch<SetStateAction<PierreDiffStyle>>
  diffStyle: PierreDiffStyle
  setDiffOptions: Dispatch<SetStateAction<DiffOptions>>
  diffOptions: DiffOptions
  onToggleMaximized: (() => void) | undefined
  onToggleRightPanel: (() => void) | undefined
  rightPanelOpen: boolean | undefined
  onEnterFullscreen: (() => void) | undefined
  actionsDropdownRef: RefObject<HTMLDivElement | null>
  actionsDropdownOpen: boolean
  handleFork: () => Promise<void>
  forking: boolean
  cliCommand: string | null
  cliPopoverRef: RefObject<HTMLDivElement | null>
  setCliPopoverOpen: Dispatch<SetStateAction<boolean>>
  cliPopoverOpen: boolean
  handleExport: () => Promise<void>
  exporting: boolean
  toggleDiagnostics: () => Promise<void>
  showDiagnostics: boolean
  activeProvider: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | undefined
  sessionCapabilities: SessionCapabilities | undefined
  runSessionAction: (action: string) => Promise<void>
  sessionActionLoading: string | null
  handleDeleteSession: () => Promise<void>
  deleting: boolean
  toggleLiveFollow: () => void
  autoFollow: boolean
}

export function MessageViewTopBar(props: MessageViewTopBarProps) {
  const {
    maximized, colorTreatment, isProject, dirName, projectView, session, sessionInfo, contextUsage,
    disabledPlugins, loading, threaded, messages, viewDropdownRef, setViewDropdownOpen,
    setActionsDropdownOpen, viewDropdownOpen, setShowVisualizer, setShowReviewMode, showVisualizer,
    showReviewMode, taskRegistry, setTaskRailOpen, taskRailOpen, setViewMode, viewMode, setDensity,
    density, setTimelineWidth, timelineWidth, setStickyHeaders, stickyHeaders, setDiffStyle,
    diffStyle, setDiffOptions, diffOptions, onToggleMaximized, onToggleRightPanel, rightPanelOpen,
    onEnterFullscreen, actionsDropdownRef, actionsDropdownOpen, handleFork, forking, cliCommand,
    cliPopoverRef, setCliPopoverOpen, cliPopoverOpen, handleExport, exporting, toggleDiagnostics,
    showDiagnostics, activeProvider, sessionCapabilities, runSessionAction, sessionActionLoading,
    handleDeleteSession, deleting, toggleLiveFollow, autoFollow,
  } = props
  return (
    !maximized && <div
        style={{
          padding: '0 28px',
          height: 52,
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          background: colorTreatment === 'flat' ? 'var(--surface)' : 'linear-gradient(to right, rgba(139,128,240,0.05) 0%, var(--surface) 40%)',
        }}
      >
        {/* Project / session name (project view only — single-session view shows the full cwd instead) */}
        {isProject && (
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text)',
            }}
          >
            {dirName}
          </span>
        )}

        {/* Project view badge */}
        {isProject && (
          <>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.1em',
                color: 'var(--violet)',
                background: 'rgba(139,128,240,0.1)',
                border: '1px solid rgba(139,128,240,0.25)',
                borderRadius: 3,
                padding: '2px 7px',
                flexShrink: 0,
              }}
            >
              All sessions
            </span>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.1em',
                color: projectView.providerMode === 'all' ? 'var(--green)' : 'var(--text-3)',
                background: projectView.providerMode === 'all' ? 'rgba(45,212,160,0.1)' : 'var(--surface-2)',
                border: `1px solid ${projectView.providerMode === 'all' ? 'rgba(45,212,160,0.25)' : 'var(--border)'}`,
                borderRadius: 3,
                padding: '2px 7px',
                flexShrink: 0,
              }}
            >
              {projectView.providerMode === 'all' ? 'All providers' : 'Current provider'}
            </span>
          </>
        )}

        {/* Single-session path + git branch */}
        {!isProject && session?.cwd && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {session.cwd}
            {sessionInfo?.gitBranch && (
              <span style={{ color: 'var(--violet)', marginLeft: 8 }}>
                ⎇ {sessionInfo.gitBranch}
              </span>
            )}
          </span>
        )}

        <span style={{ flex: 1 }} />

        {/* Context usage bar */}
        {!isProject && contextUsage && (
          <div
            title={`${contextUsage.totalTokens.toLocaleString()} / ${contextUsage.maxTokens.toLocaleString()} tokens (${Math.round(contextUsage.percentage)}%)`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
            }}
          >
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: contextUsage.percentage > 80 ? 'var(--red, #f87171)' : 'var(--text-3)',
              letterSpacing: '0.03em',
            }}>
              {Math.round(contextUsage.percentage)}%
            </span>
            <div style={{
              width: 56,
              height: 4,
              borderRadius: 2,
              background: 'var(--border-2)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${Math.min(contextUsage.percentage, 100)}%`,
                borderRadius: 2,
                background: contextUsage.percentage > 80
                  ? 'var(--red, #f87171)'
                  : contextUsage.percentage > 60
                  ? 'var(--yellow, #fbbf24)'
                  : 'var(--violet)',
                transition: 'width 0.4s ease',
              }} />
            </div>
          </div>
        )}

        {/* All-session analytics */}
        <Link
          href="/analytics"
          transitionTypes={['route']}
          title="Cross-session analytics"
          className="av-hover-control"
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            height: 26,
            padding: '0 10px',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 5,
            color: 'var(--text-2)',
            fontSize: 12,
            textDecoration: 'none',
          }}
        >
          Analytics
        </Link>

        {/* Embedded TUI terminal */}
        <Link
          href="/terminal"
          transitionTypes={['route']}
          title="Embedded TUI terminal"
          className="av-hover-control"
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 26,
            padding: '0 10px',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 5,
            color: 'var(--text-2)',
            fontSize: 12,
            textDecoration: 'none',
          }}
        >
          <Terminal size={13} strokeWidth={2.2} />
          Terminal
        </Link>

        {/* Feature plugin commands (lib/plugins/catalog.ts) */}
        {!isProject && WEB_TOOLBAR_PLUGIN_COMMANDS.filter((command) => !disabledPlugins.has(command.pluginId)).map((command) => (
          <Button
            key={command.id}
            onClick={() => dispatchPluginCommand(command.id)}
            title={command.label}
            variant="outline"
            size="sm"
            className="av-hover-control"
            style={{
              flexShrink: 0,
              height: 26,
              padding: '0 10px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 5,
              color: 'var(--text-2)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {command.webToolbarLabel}
          </Button>
        ))}

        {/* Stats */}
        {!loading && (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
            {isProject
              ? `${projectView!.sessionCount} sessions · ${threaded.length} turns`
              : `${threaded.length} turns · ${messages.length} events`}
          </span>
        )}

        {/* VIEW dropdown — display settings */}
        <div ref={viewDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => { setViewDropdownOpen(v => !v); setActionsDropdownOpen(false) }}
            className="av-hover-control"
            style={{
              height: 26, padding: '0 10px', borderRadius: 5, cursor: 'pointer',
              background: viewDropdownOpen ? 'var(--surface-3)' : 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
              fontSize: 12,
            }}
          >
            View ▾
          </button>
          {viewDropdownOpen && (
            <div style={{
              position: 'absolute', top: 32, right: 0, zIndex: 60,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '6px 0', minWidth: 200,
              boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
              display: 'flex', flexDirection: 'column', gap: 0,
            }}>
              {/* Visualiser toggle */}
              <button type="button" className="av-hover-control" onClick={() => { setShowVisualizer(v => !v); setShowReviewMode(false); setViewDropdownOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: showVisualizer ? 'var(--cyan)' : 'var(--text-2)', fontSize: 12, textAlign: 'left' }}>
                <ChartNetwork style={{ width: 13, height: 13, flexShrink: 0 }} />
                {showVisualizer ? 'Transcript' : 'Visualiser'}
              </button>
              {!isProject && session?.cwd && (
                <button type="button" className="av-hover-control" onClick={() => { setShowReviewMode(v => !v); setShowVisualizer(false); setViewDropdownOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: showReviewMode ? 'var(--cyan)' : 'var(--text-2)', fontSize: 12, textAlign: 'left' }}>
                  <FileCode2 style={{ width: 13, height: 13, flexShrink: 0 }} />
                  {showReviewMode ? 'Transcript' : 'Review changes'}
                </button>
              )}
              {/* Tasks toggle */}
              {!isProject && taskRegistry.size > 0 && (
                <button type="button" className="av-hover-control" onClick={() => { setTaskRailOpen(v => !v); setViewDropdownOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: taskRailOpen ? 'var(--amber)' : 'var(--text-2)', fontSize: 12, textAlign: 'left' }}>
                  ☐ Tasks · {taskRegistry.size}
                </button>
              )}
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* View mode */}
              <div style={{ padding: '4px 14px 2px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>Messages</div>
              {(['conversation', 'continue', 'stream', 'agents'] as const).map((mode) => (
                <button key={mode} type="button" className="av-hover-control"
                  onClick={() => { setViewMode(mode); setViewDropdownOpen(false) }}
                  style={{ padding: '6px 14px', background: viewMode === mode || (mode === 'conversation' && viewMode === 'full') ? 'rgba(139,92,246,0.1)' : 'transparent', border: 0, cursor: 'pointer', color: viewMode === mode || (mode === 'conversation' && viewMode === 'full') ? 'var(--violet)' : 'var(--text-2)', fontSize: 12, textAlign: 'left' }}>
                  {mode === 'conversation' ? 'Full' : mode === 'continue' ? 'Continue' : mode === 'stream' ? 'Stream' : 'Agents'}
                  <span style={{ color: 'var(--text-3)', marginLeft: 8, fontSize: 10 }}>
                    {mode === 'conversation' ? 'all cards' : mode === 'continue' ? 'no tools' : mode === 'stream' ? 'plain text' : 'AgentsView cards'}
                  </span>
                </button>
              ))}
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* Density */}
              <div style={{ padding: '4px 14px 2px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>Density</div>
              {(['comfortable', 'balanced', 'dense'] as const).map((d) => (
                <button key={d} type="button" className="av-hover-control"
                  onClick={() => { setDensity(d); setViewDropdownOpen(false) }}
                  style={{ padding: '6px 14px', background: density === d ? 'rgba(56,217,245,0.08)' : 'transparent', border: 0, cursor: 'pointer', color: density === d ? 'var(--cyan)' : 'var(--text-2)', fontSize: 12, textAlign: 'left' }}>
                  {d === 'comfortable' ? 'Comfortable' : d === 'balanced' ? 'Balanced' : 'Dense'}
                </button>
              ))}
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* Timeline width */}
              <div style={{ padding: '4px 14px 2px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>Width</div>
              {(['centered', 'full'] as const).map((w) => (
                <button key={w} type="button" className="av-hover-control"
                  onClick={() => { setTimelineWidth(w); setViewDropdownOpen(false) }}
                  style={{ padding: '6px 14px', background: timelineWidth === w ? 'rgba(56,217,245,0.08)' : 'transparent', border: 0, cursor: 'pointer', color: timelineWidth === w ? 'var(--cyan)' : 'var(--text-2)', fontSize: 12, textAlign: 'left', whiteSpace: 'nowrap' }}>
                  {w === 'centered' ? 'Centered' : 'Full width'}
                  <span style={{ color: 'var(--text-3)', marginLeft: 8, fontSize: 11 }}>
                    {w === 'centered' ? 'readable column' : 'whole window'}
                  </span>
                </button>
              ))}
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              <button type="button" className="av-hover-control"
                onClick={() => { setStickyHeaders((on) => !on); setViewDropdownOpen(false) }}
                style={{ padding: '6px 14px', background: stickyHeaders ? 'rgba(56,217,245,0.08)' : 'transparent', border: 0, cursor: 'pointer', color: stickyHeaders ? 'var(--cyan)' : 'var(--text-2)', fontSize: 12, textAlign: 'left', whiteSpace: 'nowrap' }}>
                {stickyHeaders ? '☑' : '☐'} Sticky prompt headers
              </button>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* Color treatment */}
              <div style={{ padding: '4px 14px 2px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>Color</div>
              {(['gradient', 'flat'] as const).map((c) => (
                <button key={c} type="button" className="av-hover-control"
                  onClick={() => { applyColorTreatment(c); setViewDropdownOpen(false) }}
                  style={{ padding: '6px 14px', background: colorTreatment === c ? 'rgba(56,217,245,0.08)' : 'transparent', border: 0, cursor: 'pointer', color: colorTreatment === c ? 'var(--cyan)' : 'var(--text-2)', fontSize: 12, textAlign: 'left', whiteSpace: 'nowrap' }}>
                  {c === 'gradient' ? 'Gradient' : 'Flat'}
                  <span style={{ color: 'var(--text-3)', marginLeft: 8, fontSize: 11 }}>
                    {c === 'gradient' ? 'themed washes & glows' : 'flat surfaces'}
                  </span>
                </button>
              ))}
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* Diff style */}
              <div style={{ padding: '4px 14px 2px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>Diff style</div>
              {(['stacked', 'split'] as const).map((style) => (
                <button key={style} type="button" className="av-hover-control"
                  onClick={() => { setDiffStyle(style); setViewDropdownOpen(false) }}
                  style={{ padding: '6px 14px', background: diffStyle === style ? 'rgba(56,217,245,0.08)' : 'transparent', border: 0, cursor: 'pointer', color: diffStyle === style ? 'var(--cyan)' : 'var(--text-2)', fontSize: 12, textAlign: 'left', whiteSpace: 'nowrap' }}>
                  {style === 'stacked' ? 'Stacked' : 'Split'}
                  <span style={{ color: 'var(--text-3)', marginLeft: 8, fontSize: 11 }}>
                    {style === 'stacked' ? 'one column' : 'side by side'}
                  </span>
                </button>
              ))}
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* Change indicators */}
              <div style={{ padding: '4px 14px 2px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>Change indicators</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 14px 3px' }}>
                {(['classic', 'bars', 'none'] as const).map((style) => (
                  <button key={style} type="button" className="av-hover-control"
                    onClick={() => { setDiffOptions((prev) => ({ ...prev, changeStyle: style })); setViewDropdownOpen(false) }}
                    style={{ padding: '4px 8px', borderRadius: 4, background: diffOptions.changeStyle === style ? 'rgba(56,217,245,0.12)' : 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', color: diffOptions.changeStyle === style ? 'var(--cyan)' : 'var(--text-2)', fontSize: 11 }}>
                    {style === 'classic' ? 'Classic' : style === 'bars' ? 'Bars' : 'None'}
                  </button>
                ))}
              </div>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* Inline diff highlighting */}
              <div style={{ padding: '4px 14px 2px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>Inline diff</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 14px 3px' }}>
                {(['word-alt', 'word', 'char', 'none'] as const).map((style) => (
                  <button key={style} type="button" className="av-hover-control"
                    onClick={() => { setDiffOptions((prev) => ({ ...prev, inlineDiffStyle: style })); setViewDropdownOpen(false) }}
                    style={{ padding: '4px 8px', borderRadius: 4, background: diffOptions.inlineDiffStyle === style ? 'rgba(56,217,245,0.12)' : 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', color: diffOptions.inlineDiffStyle === style ? 'var(--cyan)' : 'var(--text-2)', fontSize: 11 }}>
                    {style === 'word-alt' ? 'Word (alt)' : style === 'word' ? 'Word' : style === 'char' ? 'Character' : 'None'}
                  </button>
                ))}
              </div>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* Display toggles */}
              <div style={{ padding: '4px 14px 2px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>Display</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, padding: '0 6px' }}>
                {([
                  { key: 'backgrounds', label: 'Backgrounds', active: diffOptions.showBackgrounds, toggle: () => setDiffOptions((prev) => ({ ...prev, showBackgrounds: !prev.showBackgrounds })) },
                  { key: 'wrap', label: 'Wrap', active: diffOptions.wrap, toggle: () => setDiffOptions((prev) => ({ ...prev, wrap: !prev.wrap })) },
                  { key: 'lineNumbers', label: 'Line numbers', active: diffOptions.showLineNumbers, toggle: () => setDiffOptions((prev) => ({ ...prev, showLineNumbers: !prev.showLineNumbers })) },
                  { key: 'hunkHeaders', label: 'Hunk headers', active: diffOptions.showHunkHeaders, toggle: () => setDiffOptions((prev) => ({ ...prev, showHunkHeaders: !prev.showHunkHeaders })) },
                ] as const).map((opt) => (
                  <button key={opt.key} type="button" className="av-hover-control"
                    onClick={opt.toggle}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'transparent', border: 0, cursor: 'pointer', color: opt.active ? 'var(--cyan)' : 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.06em', textAlign: 'left', whiteSpace: 'nowrap' }}>
                    {opt.active ? '☑' : '☐'} {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Code theme — standalone so its sub-popover isn't clipped by the VIEW dropdown */}
        <RenderFontToggle />
        <CodeThemeToggle />

        {!isProject && onToggleMaximized ? (
          <Button
            type="button"
            onClick={onToggleMaximized}
            title="Maximize transcript"
            aria-label="Maximize transcript"
            variant="outline"
            size="sm"
            className="av-hover-control"
            style={{
              flexShrink: 0,
              width: 28,
              height: 26,
              padding: 0,
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 5,
              color: 'var(--text-2)',
              cursor: 'pointer',
            }}
          >
            <Maximize2 size={13} aria-hidden="true" />
          </Button>
        ) : null}

        {onToggleRightPanel ? (
          <Button
            type="button"
            onClick={onToggleRightPanel}
            title={rightPanelOpen ? 'Hide right panel' : 'Show right panel'}
            aria-label={rightPanelOpen ? 'Hide right panel' : 'Show right panel'}
            aria-pressed={rightPanelOpen ? true : false}
            variant="outline"
            size="sm"
            className="av-hover-control"
            style={{
              flexShrink: 0,
              width: 28,
              height: 26,
              padding: 0,
              background: rightPanelOpen ? 'var(--surface-3)' : 'transparent',
              border: `1px solid ${rightPanelOpen ? 'color-mix(in srgb, var(--cyan) 40%, var(--border))' : 'var(--border)'}`,
              borderRadius: 5,
              color: rightPanelOpen ? 'var(--cyan)' : 'var(--text-2)',
              cursor: 'pointer',
            }}
          >
            <PanelRight size={13} aria-hidden="true" />
          </Button>
        ) : null}

        {!isProject && onEnterFullscreen ? (
          <Button
            type="button"
            onClick={onEnterFullscreen}
            title="Enter fullscreen"
            aria-label="Enter fullscreen"
            variant="outline"
            size="sm"
            className="av-hover-control"
            style={{
              flexShrink: 0,
              width: 28,
              height: 26,
              padding: 0,
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 5,
              color: 'var(--text-2)',
              cursor: 'pointer',
            }}
          >
            <Fullscreen size={13} aria-hidden="true" />
          </Button>
        ) : null}

        {/* ··· actions dropdown — session actions */}
        {!isProject && (
          <div ref={actionsDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => { setActionsDropdownOpen(v => !v); setViewDropdownOpen(false) }}
              className="av-hover-control"
              style={{
                height: 26, padding: '0 10px', borderRadius: 5, cursor: 'pointer',
                background: actionsDropdownOpen ? 'var(--surface-3)' : 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-2)',
                fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, letterSpacing: '0.05em',
              }}
            >
              ···
            </button>
            {actionsDropdownOpen && (
              <div style={{
                position: 'absolute', top: 32, right: 0, zIndex: 60,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '10px 0', minWidth: 160,
                boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
                display: 'flex', flexDirection: 'column', gap: 0,
              }}>
                {session?.provider !== 'copilot' && (
                  <button type="button" className="av-hover-control" onClick={() => { handleFork(); setActionsDropdownOpen(false) }} disabled={forking}
                    style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: forking ? 'not-allowed' : 'pointer', color: 'var(--text-2)', fontSize: 12, textAlign: 'left', opacity: forking ? 0.5 : 1 }}>
                    {forking ? 'Forking…' : 'Fork session'}
                  </button>
                )}
                {cliCommand && (
                  <div ref={cliPopoverRef} style={{ position: 'relative' }}>
                    <button type="button" className="av-hover-control" onClick={() => setCliPopoverOpen(v => !v)}
                      style={{ width: '100%', padding: '7px 14px', background: cliPopoverOpen ? 'rgba(56,217,245,0.08)' : 'transparent', border: 0, cursor: 'pointer', color: cliPopoverOpen ? 'var(--cyan)' : 'var(--text-2)', fontSize: 12, textAlign: 'left' }}>
                      Resume in CLI
                    </button>
                    {cliPopoverOpen && (
                      <div style={{ position: 'absolute', top: 0, right: 170, zIndex: 70, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 320, boxShadow: '0 4px 24px rgba(0,0,0,0.35)' }}>
                        <code style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--cyan)', wordBreak: 'break-all', userSelect: 'all' }}>{cliCommand}</code>
                        <button type="button" className="av-hover-control" style={{ alignSelf: 'flex-end', height: 24, fontSize: 11, padding: '0 10px', cursor: 'pointer', background: 'rgba(56,217,245,0.07)', border: '1px solid rgba(56,217,245,0.25)', borderRadius: 4, color: 'var(--cyan)', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.08em' }}
                          onClick={() => { void navigator.clipboard.writeText(cliCommand); setCliPopoverOpen(false); setActionsDropdownOpen(false) }}>Copy</button>
                      </div>
                    )}
                  </div>
                )}
                <button type="button" className="av-hover-control" onClick={() => { handleExport(); setActionsDropdownOpen(false) }} disabled={exporting}
                  style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: exporting ? 'not-allowed' : 'pointer', color: 'var(--text-2)', fontSize: 12, textAlign: 'left', opacity: exporting ? 0.6 : 1 }}>
                  {exporting ? 'Exporting…' : 'Export'}
                </button>
                <button type="button" className="av-hover-control" onClick={() => { toggleDiagnostics(); setActionsDropdownOpen(false) }}
                  style={{ padding: '7px 14px', background: showDiagnostics ? 'rgba(234,170,64,0.1)' : 'transparent', border: 0, cursor: 'pointer', color: showDiagnostics ? 'var(--amber)' : 'var(--text-2)', fontSize: 12, textAlign: 'left' }}>
                  Diagnostics
                </button>
                {activeProvider === 'opencode' && (
                  <>
                    {sessionCapabilities?.shareSession && <button type="button" className="av-hover-control" onClick={() => { runSessionAction('share'); setActionsDropdownOpen(false) }} disabled={!!sessionActionLoading} style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--text-2)', fontSize: 12, textAlign: 'left', opacity: sessionActionLoading ? 0.55 : 1 }}>Share</button>}
                    {sessionCapabilities?.unshareSession && <button type="button" className="av-hover-control" onClick={() => { runSessionAction('unshare'); setActionsDropdownOpen(false) }} disabled={!!sessionActionLoading} style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--text-2)', fontSize: 12, textAlign: 'left', opacity: sessionActionLoading ? 0.55 : 1 }}>Unshare</button>}
                    {sessionCapabilities?.summarizeSession && <button type="button" className="av-hover-control" onClick={() => { runSessionAction('summarize'); setActionsDropdownOpen(false) }} disabled={!!sessionActionLoading} style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--text-2)', fontSize: 12, textAlign: 'left', opacity: sessionActionLoading ? 0.55 : 1 }}>Summarize</button>}
                    {sessionCapabilities?.unrevertSession && <button type="button" className="av-hover-control" onClick={() => { runSessionAction('unrevert'); setActionsDropdownOpen(false) }} disabled={!!sessionActionLoading} style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--text-2)', fontSize: 12, textAlign: 'left', opacity: sessionActionLoading ? 0.55 : 1 }}>Unrevert</button>}
                  </>
                )}
                {sessionCapabilities?.deleteSession && (
                  <>
                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                    <button type="button" className="av-hover-control" onClick={() => { handleDeleteSession(); setActionsDropdownOpen(false) }} disabled={deleting}
                      style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: deleting ? 'not-allowed' : 'pointer', color: deleting ? 'var(--red, #f87171)' : 'rgba(248,113,113,0.8)', fontSize: 12, textAlign: 'left', opacity: deleting ? 0.55 : 1 }}>
                      {deleting ? 'Deleting…' : 'Delete session'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Live follow toggle — the dot is the live indicator, the button is the control */}
        <Button
          onClick={toggleLiveFollow}
          title={autoFollow ? 'Following new messages — click to pause' : 'Paused — click to follow new messages'}
          aria-pressed={autoFollow}
          variant="outline"
          size="sm"
          className="av-hover-control"
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 26,
            padding: '0 10px',
            borderRadius: 999,
            border: `1px solid ${autoFollow ? 'rgba(45,212,160,0.26)' : 'var(--border)'}`,
            background: autoFollow ? 'rgba(45,212,160,0.10)' : 'transparent',
            color: autoFollow ? 'var(--green)' : 'var(--text-3)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: autoFollow ? 'var(--green)' : 'var(--text-3)',
              display: 'inline-block',
              animation: autoFollow ? 'live-pulse 2.5s ease-in-out infinite' : undefined,
            }}
          />
          {autoFollow ? 'Live' : 'Paused'}
        </Button>
        </div>
  )
}
