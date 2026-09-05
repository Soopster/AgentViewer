'use client'

import { lazy, memo, Suspense, use, useEffect, useMemo, useSyncExternalStore, useState, createContext } from 'react'
import {
  DEFAULT_COLOR_TREATMENT,
  getCurrentColorTreatment,
  subscribeColorTreatment,
  type ColorTreatment,
} from '@/lib/colorTreatment'
import { pathBasename as basename } from '@/lib/projectPaths'
import { DEFAULT_DIFF_OPTIONS, DiffCommentComposerContext, LiveSubagentTextContext, TaskActiveFormsContext, type DiffOptions } from './messageItemShared'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { CircleHelp, PencilLine } from 'lucide-react'
import type { ThreadedMessage, ThreadedBlock, ToolThread, TaskNotificationBlock, SystemReminderBlock, SlashCommandBlock, LocalCommandStdoutBlock, BashInputBlock, BashOutputBlock, ClaudeSystemBlock } from '@/lib/threading'
import { computeTurnDurationsMs } from '@/lib/threading'
import type { TextBlock, ThinkingBlock, ToolResultBlock, ImageBlock, Session } from '@/lib/types'
import {
  extractClaudeReadFileSummary,
  formatClaudeReadKind,
  formatClaudeReadMetadata,
  formatClaudeReadRange,
  formatClaudeRuntimeCounts,
  formatClaudeRuntimeDetailLines,
  type ClaudeReadFileSummary,
} from '@/lib/claudeSdkFeatures'
import type {
  TaskCreateInput,
  TaskCreateOutput,
  TaskGetInput,
  TaskGetOutput,
  TaskUpdateInput,
  TaskUpdateOutput,
  TaskListOutput,
} from '@anthropic-ai/claude-agent-sdk/sdk-tools'
import { getAssistantLabel } from '@/lib/provider'
import { buildDiffCommentComposerPrompt } from '@/lib/diffCommentComposer'
import { Separator } from '@/components/ui/separator'
import { sanitizeProtocolEvent, type AgentProtocolEvent } from '@/lib/agentProtocol'
import { readJsonResponse } from '@/lib/httpResponse'
import type { SelectedLineRange } from '@pierre/diffs'
import type { PierreAnnotationMetadata, PierreDiffAnnotation, PierreDiffPresentation, PierreDiffStyle } from './PierreDiffView'
import { useDiffComments, type DiffComment } from './diffComments'

// ── Tool color palette ────────────────────────────────────────────────────────

const TOOL_COLORS: Record<string, string> = {
  Bash:      'var(--t-bash)',
  Edit:      'var(--t-edit)',
  MultiEdit: 'var(--t-edit)',
  FileChange: 'var(--t-edit)',
  Write:     'var(--t-write)',
  Read:      'var(--t-read)',
  Grep:      'var(--t-grep)',
  Glob:      'var(--t-glob)',
  Agent:     'var(--t-agent)',
  task:      'var(--t-agent)',
  task_status: 'var(--t-agent)',
  WebSearch: 'var(--cyan)',
  WebFetch:  'var(--t-read)',
  NotebookEdit: 'var(--t-edit)',
}

function canonicalToolName(name: string): string {
  const normalized = name.trim()
  const lower = normalized.toLowerCase().replace(/[-\s]/g, '_')
  if (['bash', 'shell', 'local_shell', 'powershell', 'run_in_terminal', 'command', 'command_execution'].includes(lower)) return 'Bash'
  if (['read', 'read_file', 'open_file', 'view_file', 'cat', 'ls', 'list_dir', 'fs_read'].includes(lower)) return 'Read'
  if (['grep', 'grep_search', 'search', 'semantic_search', 'find', 'find_text', 'rg'].includes(lower)) return 'Grep'
  if (['glob', 'find_files', 'file_search'].includes(lower)) return 'Glob'
  if (['edit', 'str_replace_editor', 'replace_string_in_file', 'insert_edit_into_file', 'update_file'].includes(lower)) return 'Edit'
  if (['multi_edit', 'multiedit'].includes(lower)) return 'MultiEdit'
  if (['write', 'write_file', 'create_file'].includes(lower)) return 'Write'
  if (['filechange', 'file_change'].includes(lower)) return 'FileChange'
  if (['notebook_edit', 'notebookedit'].includes(lower)) return 'NotebookEdit'
  if (['todowrite', 'todo_write', 'todo'].includes(lower)) return 'TodoWrite'
  if (['agent', 'task', 'subtask', 'task_create', 'taskcreate'].includes(lower)) return 'Agent'
  if (['task_status', 'taskstatus', 'task_get', 'taskget', 'task_update', 'taskupdate', 'task_list', 'tasklist', 'task_stop', 'taskstop'].includes(lower)) return 'task_status'
  if (['websearch', 'web_search'].includes(lower)) return 'WebSearch'
  if (['webfetch', 'web_fetch'].includes(lower)) return 'WebFetch'
  if (['toolsearch', 'tool_search'].includes(lower)) return 'ToolSearch'
  return normalized
}

function toolColor(name: string) {
  return TOOL_COLORS[canonicalToolName(name)] ?? 'var(--t-other)'
}

// Flat-vs-gradient color treatment, document-level. Same external-store pattern
// as MessageView/SessionList — reads [data-color-treatment="flat"] on <html>.
function useColorTreatment(): ColorTreatment {
  return useSyncExternalStore<ColorTreatment>(
    subscribeColorTreatment,
    getCurrentColorTreatment,
    () => DEFAULT_COLOR_TREATMENT,
  )
}

// Tool-card header background. In gradient treatment this is the soft
// tool-colored wash that fades into the surface; in flat treatment a plain
// surface so the tool left-border + label carry the identity instead.
function washBg(flat: boolean, gradient: string, flatBg = 'var(--surface-2)'): string {
  return flat ? flatBg : gradient
}

type McpToolId = { server: string; tool: string }

function parseMcpToolName(name: string): McpToolId | null {
  if (!name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const idx = rest.indexOf('__')
  if (idx <= 0) return null
  const server = rest.slice(0, idx)
  const tool = rest.slice(idx + 2)
  if (!server || !tool) return null
  return { server, tool }
}

function isMcpToolName(name: string): boolean {
  return parseMcpToolName(name) !== null
}

function formatStableMessageTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(11, 19) + ' UTC'
}

function formatLocalMessageTime(value?: string): string {
  if (!value) return ''
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// ── Markdown components ───────────────────────────────────────────────────────

type FencedCodeBlockProps = {
  language: string
  codeString: string
  margin?: string | number
}

type CodeViewerProps = {
  code: string
  filePath?: string
  language?: string
  maxHeight?: number
  showLineNumbers?: boolean
  startingLineNumber?: number
}

const LazyFencedCodeBlock = lazy(() => import('./CodeRenderers').then((mod) => ({ default: mod.FencedCodeBlock })))
const LazyMermaidDiagram = lazy(() => import('./CodeRenderers').then((mod) => ({ default: mod.MermaidDiagram })))
const LazyCodeViewer = lazy(() => import('./CodeRenderers').then((mod) => ({ default: mod.CodeViewer })))
const LazyDiffView = lazy(() => import('./CodeRenderers').then((mod) => ({ default: mod.DiffView })))
const LazyPierrePatchDiffView = lazy(() => import('./PierreDiffView').then((mod) => ({ default: mod.PierrePatchDiffView })))

function normalizeCode(code: string): string {
  return code.endsWith('\n') ? code.slice(0, -1) : code
}

function PlainCodeBlock({
  code,
  language,
  margin = 0,
  maxHeight,
}: {
  code: string
  language?: string
  margin?: string | number
  maxHeight?: number
}) {
  return (
    <div style={{ margin, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface)' }}>
      {language && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '3px 12px',
          background: 'var(--surface-2)',
          borderBottom: '1px solid var(--border)',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          color: 'var(--text-3)',
          letterSpacing: '0.06em',
        }}>
          {language}
        </div>
      )}
      <pre style={{
        margin: 0,
        padding: '10px 14px',
        maxHeight,
        overflow: 'auto',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 13,
        lineHeight: 1.6,
        color: 'var(--text-2)',
        whiteSpace: 'pre',
      }}>
        {normalizeCode(code)}
      </pre>
    </div>
  )
}

function FencedCodeBlock(props: FencedCodeBlockProps) {
  return (
    <Suspense fallback={<PlainCodeBlock code={props.codeString} language={props.language} margin={props.margin ?? '10px 0'} />}>
      <LazyFencedCodeBlock {...props} />
    </Suspense>
  )
}

function parseAgentProtocolCode(codeString: string): AgentProtocolEvent | null {
  try {
    return sanitizeProtocolEvent(JSON.parse(codeString))
  } catch {
    return null
  }
}

function agentProtocolTone(eventType: string): string {
  if (eventType === 'finding' || eventType === 'learning' || eventType === 'task.completed' || eventType === 'plan.approved') return 'var(--green)'
  if (eventType === 'message' || eventType === 'handoff' || eventType === 'review.requested') return 'var(--cyan)'
  if (eventType === 'agent.blocked' || eventType === 'task.failed' || eventType === 'lock.denied' || eventType === 'plan.rejected') return 'var(--red)'
  if (eventType.startsWith('lock.')) return 'var(--amber)'
  if (eventType.startsWith('task.') || eventType.startsWith('plan.')) return 'var(--violet)'
  return 'var(--text-3)'
}

function agentProtocolTitle(event: AgentProtocolEvent): string {
  const title = event.title ?? event.summary ?? event.detail ?? ''
  if (event.type === 'task.created' && title) return title
  if (event.type === 'message' && event.to) return `to ${event.to}`
  if (event.type.startsWith('lock.') && event.paths?.length) return event.paths.join(', ')
  return title
}

function AgentProtocolCard({ codeString }: { codeString: string }) {
  const [open, setOpen] = useState(false)
  const flat  = useColorTreatment() === 'flat'
  const event = useMemo(() => parseAgentProtocolCode(codeString), [codeString])
  if (!event) return <FencedCodeBlock language="a2a" codeString={codeString} />

  const tone = agentProtocolTone(event.type)
  const title = agentProtocolTitle(event)
  const badges = [
    event.taskId,
    event.to ? `to:${event.to}` : null,
    event.lockId ? `lock:${event.lockId.slice(0, 8)}` : null,
    event.paths && event.paths.length > 0 ? `${event.paths.length} path${event.paths.length === 1 ? '' : 's'}` : null,
    event.timestamp ? formatLocalMessageTime(event.timestamp) : null,
  ].filter((badge): badge is string => Boolean(badge))

  return (
    <div style={{
      margin: '10px 0',
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${tone}`,
      borderRadius: 7,
      overflow: 'hidden',
      background: 'var(--surface)',
    }}>
      <button
        type="button"
        className="av-hover-control"
        onClick={() => setOpen((value) => !value)}
        style={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          gap: 9,
          border: 0,
          borderBottom: open ? '1px solid var(--border)' : 0,
          background: washBg(flat, `linear-gradient(to right, ${tone}18, var(--surface-2))`),
          color: 'var(--text)',
          cursor: 'pointer',
          padding: '8px 12px',
          textAlign: 'left',
        }}
        aria-expanded={open}
      >
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          color: tone,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          AGENT PROTOCOL
        </span>
        <strong style={{
          minWidth: 0,
          color: 'var(--text)',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 12,
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {event.type}
        </strong>
        {title ? (
          <span style={{
            minWidth: 0,
            flex: 1,
            overflow: 'hidden',
            color: 'var(--text-2)',
            fontSize: 13,
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {title}
          </span>
        ) : <span style={{ flex: 1 }} />}
        <span style={{
          color: 'var(--text-3)',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          flexShrink: 0,
        }}>
          {open ? '▲' : '▼'}
        </span>
      </button>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        borderBottom: open ? '1px solid var(--border)' : 0,
        padding: '7px 12px',
        background: 'var(--surface)',
      }}>
        <span style={{ ...AGENT_PROTOCOL_BADGE_STYLE, color: tone, borderColor: `color-mix(in srgb, ${tone} 45%, var(--border))` }}>{event.agentId}</span>
        <span style={AGENT_PROTOCOL_BADGE_STYLE}>{event.runId.slice(0, 8)}</span>
        {badges.map((badge) => <span key={badge} style={AGENT_PROTOCOL_BADGE_STYLE}>{badge}</span>)}
      </div>
      {(event.summary || event.detail || event.paths?.length || event.dependsOn?.length) && (
        <div style={{
          display: 'grid',
          gap: 8,
          padding: '9px 12px 11px',
          color: 'var(--text-2)',
          fontSize: 13,
          lineHeight: 1.55,
        }}>
          {event.summary && <div>{event.summary}</div>}
          {event.detail && <div style={{ color: 'var(--text-3)', whiteSpace: 'pre-wrap' }}>{event.detail}</div>}
          {event.paths && event.paths.length > 0 && (
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
              paths: {event.paths.join(', ')}
            </div>
          )}
          {event.dependsOn && event.dependsOn.length > 0 && (
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
              depends on: {event.dependsOn.join(', ')}
            </div>
          )}
        </div>
      )}
      {open && (
        <pre style={{
          margin: 0,
          borderTop: '1px solid var(--border)',
          background: 'var(--surface-2)',
          color: 'var(--text-3)',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          lineHeight: 1.55,
          maxHeight: 260,
          overflow: 'auto',
          padding: '10px 12px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {normalizeCode(codeString)}
        </pre>
      )}
    </div>
  )
}

const AGENT_PROTOCOL_BADGE_STYLE: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 999,
  color: 'var(--text-3)',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 10,
  lineHeight: 1.4,
  padding: '1px 7px',
}

function formatClockShort(ms: number): string {
  const d = new Date(ms)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

function formatDurationShort(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000)
    const s = Math.floor((ms % 60_000) / 1000)
    return `${m}m ${s}s`
  }
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}h ${m}m`
}

const NOTEBOOK_EDIT_MODE_COLOR: Record<string, string> = {
  replace: 'var(--t-edit)',
  insert: 'var(--green)',
  delete: 'var(--red)',
}

const GENERIC_RESULT_PRE_STYLE: React.CSSProperties = {
  padding: '8px 14px',
  margin: 0,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 13,
  color: 'var(--text-2)',
  background: 'var(--surface)',
  overflowX: 'auto',
  whiteSpace: 'pre',
  lineHeight: 1.6,
}

function MermaidDiagram({ codeString }: { codeString: string }) {
  return (
    <Suspense fallback={<PlainCodeBlock code={codeString} language="mermaid" margin="10px 0" />}>
      <LazyMermaidDiagram codeString={codeString} />
    </Suspense>
  )
}

function MarkdownCodeBlock({ className, children, ...rest }: React.ComponentPropsWithoutRef<'code'>) {
  const language = className?.replace('language-', '').toLowerCase() ?? ''
  const isFenced = !!className
  if (isFenced) {
    const codeString = String(children).replace(/\n$/, '')
    if (language === 'a2a' || language === 'agent-protocol') return <AgentProtocolCard codeString={codeString} />
    if (language === 'mermaid' || language === 'mmd') return <MermaidDiagram codeString={codeString} />
    return <FencedCodeBlock language={language} codeString={codeString} />
  }
  return (
    <code style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, background: 'var(--surface-3)', color: 'var(--violet)', padding: '2px 6px', borderRadius: 3 }} {...rest}>
      {children}
    </code>
  )
}

const mdComponents: Components = {
  p:          ({ children }) => (
    <p style={{ margin: '0 0 12px', lineHeight: 1.75, color: 'var(--text)' }}>{children}</p>
  ),
  h1: ({ children }) => (
    <h1 style={{
      margin: '20px 0 10px', fontSize: 19, fontWeight: 700,
      fontFamily: "'Oxanium', monospace", letterSpacing: '0.04em',
      color: 'var(--text)', borderBottom: '1px solid var(--border)', paddingBottom: 6,
    }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 style={{
      margin: '16px 0 8px', fontSize: 17, fontWeight: 600,
      fontFamily: "'Oxanium', monospace", letterSpacing: '0.03em',
      color: 'var(--text)',
    }}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ margin: '12px 0 6px', fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{children}</h3>
  ),
  strong:     ({ children }) => <strong style={{ fontWeight: 600, color: 'var(--text)' }}>{children}</strong>,
  em:         ({ children }) => <em style={{ fontStyle: 'italic', color: 'var(--text-2)' }}>{children}</em>,
  a:          ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--violet)', textDecoration: 'underline' }}>
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <span style={{ display: 'block', margin: '8px 0 12px' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={typeof src === 'string' ? src : ''}
        alt={alt ?? ''}
        style={{ maxWidth: '100%', maxHeight: 480, display: 'block', borderRadius: 6, border: '1px solid var(--border)' }}
      />
    </span>
  ),
  blockquote: ({ children }) => (
    <blockquote style={{ margin: '10px 0', paddingLeft: 14, borderLeft: '2px solid var(--border-2)', color: 'var(--text-2)' }}>
      {children}
    </blockquote>
  ),
  ul: ({ children }) => <ul style={{ margin: '6px 0 12px', paddingLeft: 22, color: 'var(--text)' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '6px 0 12px', paddingLeft: 22, color: 'var(--text)' }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 4, lineHeight: 1.7 }}>{children}</li>,
  hr: () => <Separator className="my-4 bg-[var(--border)]" />,
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', marginBottom: 12 }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 14, color: 'var(--text)', width: '100%' }}>
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{ padding: '6px 14px', borderBottom: '1px solid var(--border-2)', textAlign: 'left', fontWeight: 600, color: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)' }}>{children}</td>
  ),
  code: MarkdownCodeBlock,
  pre: ({ children }) => <>{children}</>,
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const LANGUAGE_BY_BASENAME: Record<string, string> = {
  dockerfile: 'docker',
  makefile: 'bash',
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cjs: 'javascript',
  cc: 'cpp',
  cs: 'csharp',
  csx: 'csharp',
  css: 'css',
  cpp: 'cpp',
  cxx: 'cpp',
  dart: 'dart',
  diff: 'diff',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  md: 'markdown',
  markdown: 'markdown',
  mjs: 'javascript',
  php: 'php',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svg: 'svg',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  txt: '',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
}

function detectLanguageFromPath(filePath?: string): string {
  if (!filePath) return ''

  const name = basename(filePath)
  const lowerName = name.toLowerCase()
  if (LANGUAGE_BY_BASENAME[lowerName]) return LANGUAGE_BY_BASENAME[lowerName]

  const dot = name.lastIndexOf('.')
  if (dot === -1) return ''

  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? ''
}

function inferStartingLineNumber(lines: Array<{ num: string }>): number | undefined {
  const first = lines.find(line => /^\d+$/.test(line.num))
  return first ? Number(first.num) : undefined
}

function shouldShowLineNumbers(lines: Array<{ num: string }>): boolean {
  const numbered = lines.filter(line => line.num !== '')
  return numbered.length > 0 && numbered.every(line => /^\d+$/.test(line.num))
}

const LARGE_DIFF_LINE_THRESHOLD = 200
const LARGE_DIFF_CHAR_THRESHOLD = 8_000

function countLines(value: string): number {
  if (!value) return 0
  let lines = 1
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) === 10) lines += 1
  }
  return lines
}

function isLargeTextList(values: Iterable<string>): boolean {
  let chars = 0
  let lines = 0
  for (const value of values) {
    chars += value.length
    lines += countLines(value)
    if (chars > LARGE_DIFF_CHAR_THRESHOLD || lines > LARGE_DIFF_LINE_THRESHOLD) return true
  }
  return false
}

function isLargeTextPayload(...values: string[]): boolean {
  return isLargeTextList(values)
}

function CodeViewer(props: CodeViewerProps) {
  const fallbackLanguage = props.language ?? detectLanguageFromPath(props.filePath)
  return (
    <Suspense fallback={<PlainCodeBlock code={props.code} language={fallbackLanguage} maxHeight={props.maxHeight} />}>
      <LazyCodeViewer {...props} />
    </Suspense>
  )
}

function CardShell({
  color = 'var(--t-other)',
  header,
  body,
  result,
  toolName = '',
  resultFilePath,
}: {
  color?: string
  header: React.ReactNode
  body?: React.ReactNode
  result: ToolResultBlock | null
  toolName?: string
  resultFilePath?: string
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderLeft: `2px solid ${color}`,
        borderRadius: 6,
        overflow: 'hidden',
        fontSize: 13,
        marginTop: 4,
      }}
    >
      {header}
      {body}
      {result && <ToolResultSection result={result} toolName={toolName} filePath={resultFilePath} />}
    </div>
  )
}

// ── Diff view ─────────────────────────────────────────────────────────────────

type DiffAnnotationProps = {
  selectedLines?: SelectedLineRange | null
  onSelectedLinesChange?: (selection: SelectedLineRange | null) => void
  lineAnnotations?: PierreDiffAnnotation<PierreAnnotationMetadata>[]
  renderAnnotation?: (annotation: PierreDiffAnnotation<PierreAnnotationMetadata>) => React.ReactNode
  onGutterUtilityClick?: (range: SelectedLineRange) => void
}

function DiffView(props: { oldStr: string; newStr: string; filePath?: string; presentation?: PierreDiffPresentation } & DiffAnnotationProps) {
  return (
    <Suspense fallback={<PlainCodeBlock code={props.newStr || props.oldStr} language={detectLanguageFromPath(props.filePath)} maxHeight={500} />}>
      <LazyDiffView {...props} />
    </Suspense>
  )
}

function DiffStyleToggle({ diffStyle, onToggle }: { diffStyle: PierreDiffStyle; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="av-hover-control"
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      aria-label={`Switch diff view to ${diffStyle === 'stacked' ? 'split' : 'stacked'}`}
      title={`Diff view: ${diffStyle}`}
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
        color: 'var(--text-3)',
        border: '1px solid var(--border)',
        borderRadius: 3,
        padding: '1px 5px',
        background: 'var(--surface-2)',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {diffStyle === 'stacked' ? 'STACKED' : 'SPLIT'}
    </button>
  )
}

function DiffCommentButton({
  selectedLines,
  currentSelectionNote,
  onOpenComment,
}: {
  selectedLines: SelectedLineRange | null
  currentSelectionNote: DiffComment | null
  onOpenComment: () => void
}) {
  if (!selectedLines) return null
  const active = Boolean(currentSelectionNote)
  return (
    <button
      type="button"
      className="av-hover-control"
      onClick={(event) => {
        event.stopPropagation()
        onOpenComment()
      }}
      title={active ? 'Edit comment for selected lines' : 'Add comment for selected lines'}
      style={{
        height: 30,
        padding: '0 10px',
        borderRadius: 999,
        border: `1px solid ${active ? 'color-mix(in srgb, var(--violet) 36%, var(--border))' : 'var(--border)'}`,
        background: active ? 'color-mix(in srgb, var(--violet) 10%, var(--surface-3))' : 'var(--surface-3)',
        color: active ? 'var(--violet)' : 'var(--text-2)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: "var(--render-font)",
        fontSize: 11,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      <PencilLine size={12} />
      {active ? 'Edit comment' : 'Add comment'}
    </button>
  )
}

function DiffThreadSummary({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <div style={{
      padding: '2px 12px 0',
      color: 'var(--text-3)',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 10,
      whiteSpace: 'nowrap',
    }}>
      {count} annotation thread{count === 1 ? '' : 's'}
    </div>
  )
}

function formatLinePrefixedBlock(prefix: string, text: string): string {
  if (!text) return `${prefix} `
  return text.split('\n').map((line) => `${prefix} ${line}`).join('\n')
}

function buildEditDiffContext(oldStr: string, newStr: string): string {
  return [
    '--- original',
    formatLinePrefixedBlock('-', oldStr),
    '+++ updated',
    formatLinePrefixedBlock('+', newStr),
  ].join('\n')
}

function useSendDiffCommentToComposer(filePath: string, context: string, source: string) {
  const sendToComposer = use(DiffCommentComposerContext)
  return useMemo(() => {
    if (!sendToComposer) return undefined
    return (comment: DiffComment) => {
      sendToComposer(buildDiffCommentComposerPrompt({
        filePath,
        range: comment.range,
        comment: comment.text,
        context,
        source,
      }))
    }
  }, [context, filePath, sendToComposer, source])
}

function toggleDiffStyle(current: PierreDiffStyle): PierreDiffStyle {
  return current === 'stacked' ? 'split' : 'stacked'
}

function PatchDiffView({
  patch,
  maxHeight = 420,
  presentation,
  selectedLines,
  onSelectedLinesChange,
  lineAnnotations,
  renderAnnotation,
  onGutterUtilityClick,
}: {
  patch: string
  maxHeight?: number
  presentation?: PierreDiffPresentation
} & DiffAnnotationProps) {
  return (
    <Suspense fallback={<PlainCodeBlock code={patch} language="diff" maxHeight={maxHeight} />}>
      <LazyPierrePatchDiffView
        patch={patch}
        maxHeight={maxHeight}
        presentation={presentation}
        selectedLines={selectedLines}
        onSelectedLinesChange={onSelectedLinesChange}
        lineAnnotations={lineAnnotations}
        renderAnnotation={renderAnnotation}
        onGutterUtilityClick={onGutterUtilityClick}
      />
    </Suspense>
  )
}

// ── Edit tool card ────────────────────────────────────────────────────────────

function EditToolCard({ thread }: { thread: ToolThread }) {
  const { toolUse, result } = thread
  const input = toolUse.input as { file_path?: string; old_string?: string; new_string?: string }
  const filePath = input.file_path ?? ''
  const oldStr   = input.old_string ?? ''
  const newStr   = input.new_string ?? ''
  const largeDiff = isLargeTextPayload(oldStr, newStr)
  const [open, setOpen] = useState(() => !largeDiff)
  const [presentation, diffStyle, toggleDiffStyleOverride] = useDiffPresentation()
  const diffContext = useMemo(() => buildEditDiffContext(oldStr, newStr), [oldStr, newStr])
  const sendDiffCommentToComposer = useSendDiffCommentToComposer(filePath, diffContext, 'Edit tool diff')
  const comments = useDiffComments(filePath, { onSendToComposer: sendDiffCommentToComposer })
  const [hovered, setHovered] = useState(false)
  const delta    = countLines(newStr) - countLines(oldStr)
  const sign     = delta > 0 ? `+${delta}` : String(delta)
  const c        = toolColor(toolUse.name)
  const flat     = useColorTreatment() === 'flat'

  return (
    <CardShell color={c} result={result} toolName={toolUse.name}
      header={
        <div
          onClick={() => setOpen(v => !v)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="av-tool-header"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px',
            background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
            userSelect: 'none',
          }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>EDIT</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
            {basename(filePath)}
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: delta > 0 ? 'var(--green)' : delta < 0 ? 'var(--red)' : 'var(--text-3)', flexShrink: 0 }}>
            {sign}
          </span>
          {largeDiff && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--amber)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
              LARGE
            </span>
          )}
          <DiffCommentButton
            selectedLines={comments.selectedLines}
            currentSelectionNote={comments.currentSelectionNote}
            onOpenComment={() => {
              if (!comments.selectedLines) return
              comments.onGutterUtilityClick(comments.selectedLines)
            }}
          />
          <DiffStyleToggle diffStyle={diffStyle} onToggle={toggleDiffStyleOverride} />
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
        </div>
      }
      body={open ? (
        <>
          <div style={{ padding: '2px 12px', background: 'var(--surface)', borderTop: '1px solid var(--border)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {filePath}
          </div>
          <DiffThreadSummary count={comments.commentCount} />
          <DiffView
            oldStr={oldStr}
            newStr={newStr}
            filePath={filePath}
            presentation={presentation}
            selectedLines={comments.selectedLines}
            onSelectedLinesChange={comments.onSelectedLinesChange}
            lineAnnotations={comments.lineAnnotations}
            renderAnnotation={comments.renderAnnotation}
            onGutterUtilityClick={comments.onGutterUtilityClick}
          />
        </>
      ) : undefined}
    />
  )
}

// ── Write tool card ───────────────────────────────────────────────────────────

function WriteToolCard({ thread }: { thread: ToolThread }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const { toolUse, result } = thread
  const input    = toolUse.input as { file_path?: string; content?: string }
  const filePath = input.file_path ?? ''
  const content  = input.content ?? ''
  const lines    = content.split('\n').length
  const c        = toolColor(toolUse.name)
  const flat     = useColorTreatment() === 'flat'

  return (
    <CardShell color={c} result={result} toolName={toolUse.name}
      header={
        <div
          onClick={() => setOpen(v => !v)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="av-tool-header"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px',
            background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
            userSelect: 'none',
          }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>WRITE</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
            {basename(filePath)}
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
            {lines} lines
          </span>
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
        </div>
      }
      body={open ? (
        <>
          <div style={{ padding: '2px 12px', background: 'var(--surface)', borderTop: '1px solid var(--border)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {filePath}
          </div>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <CodeViewer code={content} filePath={filePath} maxHeight={500} />
          </div>
        </>
      ) : undefined}
    />
  )
}

function FileChangeCard({ thread }: { thread: ToolThread }) {
  const { toolUse, result } = thread
  const input = toolUse.input as {
    status?: string
    changes?: Array<{ path?: string; kind?: unknown; diff?: string }>
  }
  const changes = input.changes ?? []
  const largeDiff = isLargeTextList(changes.map((change) => change.diff ?? ''))
  const [open, setOpen] = useState(() => !largeDiff)
  const [presentation, diffStyle, toggleDiffStyleOverride] = useDiffPresentation()
  const [hovered, setHovered] = useState(false)
  const c = toolColor('FileChange')
  const flat = useColorTreatment() === 'flat'
  const preview = changes.length === 1
    ? basename(changes[0]?.path ?? '')
    : `${changes.length} files`

  return (
    <CardShell
      color={c}
      result={result}
      toolName={toolUse.name}
      header={
        <div
          onClick={() => setOpen(v => !v)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="av-tool-header"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px',
            background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
            userSelect: 'none',
          }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
            FILE CHANGE
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
            {preview}
          </span>
          {typeof input.status === 'string' && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
              {input.status}
            </span>
          )}
          {largeDiff && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--amber)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
              LARGE
            </span>
          )}
          <DiffStyleToggle diffStyle={diffStyle} onToggle={toggleDiffStyleOverride} />
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
        </div>
      }
      body={open ? (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
          {changes.length === 0 ? (
            <div style={{
              padding: '10px 14px',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 13,
              color: 'var(--text-3)',
            }}>
              No file changes recorded.
            </div>
          ) : (
            changes.map((change, index) => {
              const filePath = change.path ?? ''
              const kind = typeof change.kind === 'string'
                ? change.kind
                : change.kind != null
                ? safeJson(change.kind)
                : ''
              return (
                <FileChangeDiffRegion
                  key={`${filePath}:${index}`}
                  index={index}
                  filePath={filePath}
                  kind={kind}
                  diffText={change.diff ?? ''}
                  accentColor={c}
                  presentation={presentation}
                />
              )
            })
          )}
        </div>
      ) : undefined}
    />
  )
}

function FileChangeDiffRegion({
  index,
  filePath,
  kind,
  diffText,
  accentColor,
  presentation,
}: {
  index: number
  filePath: string
  kind: string
  diffText: string
  accentColor: string
  presentation: PierreDiffPresentation
}) {
  const sendDiffCommentToComposer = useSendDiffCommentToComposer(filePath, diffText, 'FileChange tool diff')
  const comments = useDiffComments(filePath, { onSendToComposer: sendDiffCommentToComposer })
  return (
    <div style={{ borderTop: index > 0 ? '1px solid var(--border)' : undefined }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: accentColor,
          fontWeight: 500,
          letterSpacing: '0.06em',
          flexShrink: 0,
        }}>
          {kind || 'change'}
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 12,
          color: 'var(--text)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {filePath}
        </span>
        <DiffCommentButton
          selectedLines={comments.selectedLines}
          currentSelectionNote={comments.currentSelectionNote}
          onOpenComment={() => {
            if (!comments.selectedLines) return
            comments.onGutterUtilityClick(comments.selectedLines)
          }}
        />
      </div>
      <DiffThreadSummary count={comments.commentCount} />
      <PatchDiffView
        patch={diffText}
        maxHeight={420}
        presentation={presentation}
        selectedLines={comments.selectedLines}
        onSelectedLinesChange={comments.onSelectedLinesChange}
        lineAnnotations={comments.lineAnnotations}
        renderAnnotation={comments.renderAnnotation}
        onGutterUtilityClick={comments.onGutterUtilityClick}
      />
    </div>
  )
}

// ── Generic tool card ─────────────────────────────────────────────────────────

function GenericToolCard({ thread }: { thread: ToolThread }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const { toolUse, result } = thread
  const c = toolColor(toolUse.name)
  const flat = useColorTreatment() === 'flat'
  const firstVal = Object.values(toolUse.input)[0]
  const preview  = firstVal !== undefined ? String(firstVal).slice(0, 90) : null
  const inputJson = useMemo(
    () => (open ? JSON.stringify(toolUse.input, null, 2) : ''),
    [open, toolUse.input],
  )

  return (
    <CardShell color={c} result={result} toolName={toolUse.name}
      header={
        <div
          onClick={() => setOpen(v => !v)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="av-tool-header"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px',
            background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
            userSelect: 'none',
          }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
            {toolUse.name.toUpperCase()}
          </span>
          {!open && preview !== null && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-2)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {preview}
            </span>
          )}
          <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 'auto' }}>{open ? '▲' : '▼'}</span>
        </div>
      }
      body={open ? (
        <pre style={{
          padding: '10px 14px', fontSize: 13, margin: 0,
          fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-2)',
          background: 'var(--surface)', overflowX: 'auto', maxHeight: 280, overflowY: 'auto',
          borderTop: '1px solid var(--border)', lineHeight: 1.6,
        }}>
          {inputJson}
        </pre>
      ) : undefined}
    />
  )
}

// ── MCP tool card ─────────────────────────────────────────────────────────────

const MCP_CODE_LANG_KEYS: Record<string, string> = {
  function: 'javascript',
  script: 'javascript',
  code: 'javascript',
  js: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  python: 'python',
  py: 'python',
  sql: 'sql',
  html: 'html',
  css: 'css',
  shell: 'bash',
  bash: 'bash',
  command: 'bash',
  query: 'text',
}

function mcpFieldLanguage(key: string, value: string): string | null {
  const lc = key.toLowerCase()
  if (MCP_CODE_LANG_KEYS[lc]) return MCP_CODE_LANG_KEYS[lc]
  if (value.includes('\n')) return 'text'
  return null
}

function mcpPreviewText(input: Record<string, unknown>): string | null {
  const keys = Object.keys(input)
  if (keys.length === 0) return null
  const firstKey = keys[0]
  const firstVal = input[firstKey]
  let preview: string
  if (typeof firstVal === 'string') {
    const oneLine = firstVal.replace(/\s+/g, ' ').trim()
    preview = keys.length === 1 ? oneLine : `${firstKey}: ${oneLine}`
  } else if (firstVal == null) {
    preview = firstKey
  } else {
    const json = JSON.stringify(firstVal)
    preview = `${firstKey}: ${json}`
  }
  return preview.length > 0 ? preview : null
}

function McpToolCard({ thread }: { thread: ToolThread }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const { toolUse, result } = thread
  const id = parseMcpToolName(toolUse.name)!
  const c = toolColor(toolUse.name)
  const flat = useColorTreatment() === 'flat'
  const input = (toolUse.input ?? {}) as Record<string, unknown>
  const inputKeys = Object.keys(input)
  const preview = useMemo(() => mcpPreviewText(input), [input])

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderLeft: `2px solid ${c}`,
        borderRadius: 6,
        overflow: 'hidden',
        fontSize: 13,
        marginTop: 4,
      }}
    >
      <div
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="av-tool-header"
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px',
          background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
          userSelect: 'none',
          cursor: 'pointer',
        }}
      >
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
          color: c,
          background: 'var(--surface-3)',
          border: `1px solid ${c}33`,
          borderRadius: 3,
          padding: '1px 5px',
          flexShrink: 0,
        }}>
          MCP
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11, color: 'var(--text-3)',
          letterSpacing: '0.04em',
          flexShrink: 0,
        }}>
          {id.server}
        </span>
        <span style={{ color: 'var(--text-3)', fontSize: 11, flexShrink: 0 }}>·</span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 13, color: 'var(--text)', fontWeight: 500,
          flexShrink: 0,
        }}>
          {id.tool}
        </span>
        {!open && preview && (
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            color: 'var(--text-3)', fontSize: 11,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            flex: 1, marginLeft: 4,
          }}>
            {preview}
          </span>
        )}
        <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 'auto', flexShrink: 0 }}>
          {inputKeys.length === 0 ? '— no args' : open ? '▲' : '▼'}
        </span>
      </div>
      {open && inputKeys.length > 0 && (
        <div style={{
          padding: '8px 14px',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {inputKeys.map((key) => {
            const value = input[key]
            if (typeof value === 'string') {
              const lang = mcpFieldLanguage(key, value)
              const multiline = value.includes('\n') || value.length > 80
              if (lang && multiline) {
                return (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.04em',
                    }}>
                      {key}
                    </span>
                    <CodeViewer code={value} language={lang} maxHeight={320} />
                  </div>
                )
              }
              return (
                <div key={key} style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12, color: 'var(--text-2)',
                  lineHeight: 1.6,
                  display: 'flex', gap: 8,
                }}>
                  <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>{key}:</span>
                  <span style={{ color: 'var(--text)', wordBreak: 'break-all' }}>{value}</span>
                </div>
              )
            }
            if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
              return (
                <div key={key} style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12, color: 'var(--text-2)',
                  lineHeight: 1.6,
                  display: 'flex', gap: 8,
                }}>
                  <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>{key}:</span>
                  <span style={{ color: 'var(--text)' }}>{String(value)}</span>
                </div>
              )
            }
            const json = JSON.stringify(value, null, 2)
            return (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.04em',
                }}>
                  {key}
                </span>
                <CodeViewer code={json} language="json" maxHeight={240} />
              </div>
            )
          })}
        </div>
      )}
      {result && <McpResultSection result={result} />}
    </div>
  )
}

function prettifyFencedJson(text: string): string {
  return text.replace(/```json\s*\n([\s\S]*?)\n```/g, (match, body: string) => {
    const trimmed = body.trim()
    if (trimmed.includes('\n')) return match
    try {
      const parsed = JSON.parse(trimmed)
      return '```json\n' + JSON.stringify(parsed, null, 2) + '\n```'
    } catch {
      return match
    }
  })
}

function McpResultSection({ result }: { result: ToolResultBlock }) {
  const [expanded, setExpanded] = useState(false)
  const imageBlock = useMemo(() => (
    Array.isArray(result.content)
      ? result.content.find((b): b is ImageBlock => (b as ImageBlock).type === 'image') ?? null
      : null
  ), [result.content])
  const raw = useMemo(() => {
    if (imageBlock) return ''
    return prettifyFencedJson(resultToString(result.content))
  }, [imageBlock, result.content])
  const isError = result.is_error === true

  if (imageBlock) {
    return (
      <>
        <ResultStatusBar isError={false} />
        <ImageResultSection block={imageBlock} />
      </>
    )
  }

  if (isError) return <GenericResultSection raw={raw} isError />

  const trimmed = raw.trim()
  if (!trimmed) {
    return <ResultStatusBar isError={false} />
  }

  const nonEmpty = trimmed.split('\n').filter(l => l.trim())
  if (nonEmpty.length === 1 && trimmed.length < 140) {
    return (
      <div style={{
        padding: '4px 12px',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11, color: 'var(--green)',
        background: 'rgba(45,212,160,0.05)',
        borderTop: '1px solid rgba(45,212,160,0.15)',
        letterSpacing: '0.03em',
      }}>
        ✓ {trimmed}
      </div>
    )
  }

  const APPROX_LINE_LIMIT = 24
  const lineCount = trimmed.split('\n').length
  const collapsible = lineCount > APPROX_LINE_LIMIT
  let visible = collapsible && !expanded
    ? trimmed.split('\n').slice(0, APPROX_LINE_LIMIT).join('\n')
    : trimmed
  // Close any code fence the truncation may have orphaned, so ReactMarkdown still
  // renders the partial block as code rather than leaking syntax into the rest of the page.
  if (collapsible && !expanded) {
    const fenceCount = (visible.match(/^```/gm) ?? []).length
    if (fenceCount % 2 === 1) visible += '\n```'
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <ResultStatusBar isError={false} />
      <div style={{
        padding: '6px 14px 2px',
        background: 'var(--surface)',
        fontSize: 13, color: 'var(--text)', lineHeight: 1.65,
      }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {visible}
        </ReactMarkdown>
      </div>
      {collapsible && (
        <button type="button" className="av-hover-control" onClick={() => setExpanded(v => !v)} style={EXPAND_BTN}>
          {expanded ? '▲ collapse' : `▼ ${lineCount - APPROX_LINE_LIMIT} more lines`}
        </button>
      )}
    </div>
  )
}

function ResultStatusBar({ isError }: { isError: boolean }) {
  return (
    <div style={{
      padding: '3px 12px', fontSize: 11,
      fontFamily: "'IBM Plex Mono', monospace",
      fontWeight: 500, letterSpacing: '0.06em',
      color: isError ? 'var(--red)' : 'var(--green)',
      background: isError ? 'rgba(240,96,96,0.06)' : 'rgba(45,212,160,0.05)',
      borderTop: `1px solid ${isError ? 'rgba(240,96,96,0.25)' : 'var(--border)'}`,
    }}>
      {isError ? '✗ ERROR' : '✓ OK'}
    </div>
  )
}

// ── AskUserQuestion card ──────────────────────────────────────────────────────

type AUQOption  = { label: string; description?: string; preview?: string }
type AUQQuestion = { question: string; header?: string; multiSelect?: boolean; options: AUQOption[] }

function AskUserQuestionCard({ thread }: { thread: ToolThread }) {
  const input = thread.toolUse.input as { questions?: Array<AUQQuestion | null | undefined> }
  // A streaming/partial tool call can omit fields; keep only well-formed objects
  // so downstream access (q.header, q.options.map) never throws.
  const questions = (input.questions ?? []).filter((q): q is AUQQuestion => !!q && typeof q === 'object')
  const resultStr = thread.result ? resultToString(thread.result.content) : ''
  const answered  = !!resultStr
  const flat      = useColorTreatment() === 'flat'

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: '2px solid var(--violet)',
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 13,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px',
        background: washBg(flat, 'linear-gradient(to right, var(--violet-glow), transparent)'),
      }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
          color: 'var(--violet)',
          background: 'rgba(139,128,240,0.1)',
          border: '1px solid rgba(139,128,240,0.22)',
          borderRadius: 3,
          padding: '1px 5px',
          flexShrink: 0,
        }}>
          ASK USER
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: answered ? 'var(--green)' : 'var(--amber)',
          marginLeft: 'auto', flexShrink: 0,
        }}>
          {answered ? '✓ answered' : '◌ pending'}
        </span>
      </div>

      {/* Questions */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {questions.map((q, qi) => (
          <AUQQuestionBlock key={qi} q={q} resultStr={resultStr} />
        ))}
      </div>
    </div>
  )
}

function AUQQuestionBlock({ q, resultStr }: { q: AUQQuestion; resultStr: string }) {
  const [expandedPreview, setExpandedPreview] = useState<number | null>(null)
  const flat = useColorTreatment() === 'flat'

  return (
    <div>
      {/* Question text */}
      <div style={{
        fontFamily: "var(--render-font)",
        fontSize: 13, fontWeight: 500,
        color: 'var(--text)',
        marginBottom: 8,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {q.header && (
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
            color: 'var(--text-3)',
            background: 'var(--surface-3)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            padding: '1px 5px',
            flexShrink: 0,
          }}>
            {q.header.toUpperCase()}
          </span>
        )}
        {q.question}
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(Array.isArray(q.options) ? q.options : []).map((opt, oi) => {
          const selected = resultStr.includes(`"${opt.label}"`) || resultStr.includes(`=${opt.label}`)
          const previewOpen = expandedPreview === oi

          return (
            <div key={oi}>
              <div
                onClick={() => opt.preview ? setExpandedPreview(previewOpen ? null : oi) : undefined}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '6px 10px',
                  borderRadius: 4,
                  border: `1px solid ${selected ? 'rgba(139,128,240,0.35)' : 'var(--border)'}`,
                  background: selected
                    ? washBg(flat, 'linear-gradient(to right, rgba(139,128,240,0.10), rgba(139,128,240,0.04))', 'rgba(139,128,240,0.10)')
                    : 'var(--surface)',
                  cursor: opt.preview ? 'pointer' : 'default',
                  transition: 'border-color 0.14s ease, background 0.14s ease',
                }}
              >
                {/* Selection indicator */}
                <span style={{
                  width: 14, height: 14,
                  borderRadius: q.multiSelect ? 3 : '50%',
                  border: `1.5px solid ${selected ? 'var(--violet)' : 'var(--border-2)'}`,
                  background: selected ? 'var(--violet)' : 'transparent',
                  flexShrink: 0,
                  marginTop: 2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.14s ease, border-color 0.14s ease',
                }}>
                  {selected && (
                    <span style={{ fontSize: 8, color: 'var(--bg)', lineHeight: 1, fontWeight: 700 }}>✓</span>
                  )}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: "var(--render-font)",
                    fontSize: 13, fontWeight: selected ? 600 : 400,
                    color: selected ? 'var(--text)' : 'var(--text-2)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {opt.label}
                    {opt.preview && (
                      <span style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11, color: 'var(--text-3)',
                        border: '1px solid var(--border)',
                        borderRadius: 3,
                        padding: '0 4px',
                      }}>
                        {previewOpen ? '▲ preview' : '▼ preview'}
                      </span>
                    )}
                  </div>
                  {opt.description && (
                    <div style={{
                      fontFamily: "var(--render-font)",
                      fontSize: 11, color: 'var(--text-3)',
                      marginTop: 2, lineHeight: 1.5,
                    }}>
                      {opt.description}
                    </div>
                  )}
                </div>
              </div>

              {/* Inline preview pane */}
              {opt.preview && previewOpen && (
                <pre style={{
                  margin: '2px 0 0',
                  padding: '8px 12px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11, lineHeight: 1.6,
                  color: 'var(--text-2)',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderTop: 'none',
                  borderRadius: '0 0 4px 4px',
                  overflowX: 'auto',
                  whiteSpace: 'pre',
                }}>
                  {opt.preview}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── ToolSearch card ───────────────────────────────────────────────────────────

/** Extract every unique tool_name mentioned in a ToolSearch result string. */
function parseToolRefs(raw: string): string[] {
  const seen = new Set<string>()
  const re = /"tool_name"\s*:\s*"([^"]+)"/g
  let m
  while ((m = re.exec(raw)) !== null) seen.add(m[1])
  return [...seen]
}

function ToolRefChips({ names }: { names: string[] }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 6,
      padding: '8px 12px',
      borderTop: '1px solid var(--border)',
      background: 'var(--surface)',
    }}>
      {names.map(name => {
        const color = TOOL_COLORS[name] ?? 'var(--t-other)'
        return (
          <span key={name} style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color,
            background: 'var(--surface-3)',
            border: `1px solid var(--border-2)`,
            borderLeft: `2px solid ${color}`,
            borderRadius: 4,
            padding: '2px 8px',
            letterSpacing: '0.02em',
          }}>
            {name}
          </span>
        )
      })}
    </div>
  )
}

function ToolSearchCard({ thread }: { thread: ToolThread }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const input    = thread.toolUse.input as { query?: string; max_results?: number }
  const query    = input.query ?? ''
  const c        = 'var(--cyan)'
  const flat     = useColorTreatment() === 'flat'
  const raw      = thread.result ? resultToString(thread.result.content) : ''
  const toolRefs = parseToolRefs(raw)
  const isError  = thread.result?.is_error ?? false

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `2px solid ${c}`,
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 13,
      marginTop: 4,
    }}>
      {/* Header */}
      <div
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px',
          background: washBg(flat, `linear-gradient(to right, rgba(56,217,245,${hovered ? '0.14' : '0.08'}) 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
          cursor: 'pointer', userSelect: 'none',
          transition: 'background 0.15s ease',
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
          TOOLSEARCH
        </span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
          {query}
        </span>
        {toolRefs.length > 0 && (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--green)', flexShrink: 0 }}>
            {toolRefs.length} tool{toolRefs.length !== 1 ? 's' : ''}
          </span>
        )}
        {isError && (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--red)', flexShrink: 0 }}>error</span>
        )}
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </div>

      {/* Result */}
      {thread.result && (
        isError             ? <GenericResultSection raw={raw} isError />
        : toolRefs.length > 0 ? <ToolRefChips names={toolRefs} />
        : open              ? <GenericResultSection raw={raw} />
        : null
      )}
    </div>
  )
}

// ── Bash card ─────────────────────────────────────────────────────────────────

function BashCard({ thread }: { thread: ToolThread }) {
  const [hovered, setHovered] = useState(false)
  const input = thread.toolUse.input as { command?: string; description?: string }
  const command = input.command ?? ''
  const c = toolColor('Bash')
  const flat = useColorTreatment() === 'flat'
  return (
    <CardShell color={c} result={thread.result} toolName="Bash"
      header={
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 14px',
            background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
            transition: 'background 0.15s ease',
          }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0, marginTop: 2 }}>BASH</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', flex: 1, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.55 }}>
            {command}
          </span>
        </div>
      }
      body={input.description ? (
        <div style={{ padding: '2px 12px', borderTop: '1px solid var(--border)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', background: 'var(--surface)' }}>
          {input.description}
        </div>
      ) : undefined}
    />
  )
}

// ── Read card ─────────────────────────────────────────────────────────────────

function ReadCard({ thread }: { thread: ToolThread }) {
  const [hovered, setHovered] = useState(false)
  const input = thread.toolUse.input as { file_path?: string; offset?: number; limit?: number; pages?: string }
  const filePath = input.file_path ?? ''
  const c = toolColor('Read')
  const flat = useColorTreatment() === 'flat'
  const readSummary = useMemo(
    () => extractClaudeReadFileSummary(thread.result, filePath),
    [thread.result, filePath],
  )
  const readRangeLabel = readSummary?.structured ? formatClaudeReadRange(readSummary) : null
  const readKindLabel = readSummary ? formatClaudeReadKind(readSummary) : null
  const rangeLabel = [
    input.offset != null ? `@${input.offset}` : null,
    input.limit  != null ? `+${input.limit}`  : null,
    input.pages ? `pages ${input.pages}` : null,
  ].filter(Boolean).join(' ')
  return (
    <CardShell color={c} result={thread.result} toolName="Read" resultFilePath={filePath}
      header={
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
            transition: 'background 0.15s ease',
          }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>READ</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {basename(filePath)}
          </span>
          {rangeLabel && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>{rangeLabel}</span>
          )}
          {readRangeLabel && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>{readRangeLabel}</span>
          )}
          {readKindLabel && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--cyan)', flexShrink: 0 }}>{readKindLabel}</span>
          )}
          {readSummary?.truncatedByTokenCap && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--yellow)', flexShrink: 0 }}>token cap</span>
          )}
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
            {filePath}
          </span>
        </div>
      }
    />
  )
}

// ── Grep card ─────────────────────────────────────────────────────────────────

function GrepCard({ thread }: { thread: ToolThread }) {
  const [hovered, setHovered] = useState(false)
  const input = thread.toolUse.input as { pattern?: string; path?: string; glob?: string; output_mode?: string }
  const pattern  = input.pattern ?? ''
  const location = input.glob ?? input.path ?? ''
  const c        = toolColor('Grep')
  const flat     = useColorTreatment() === 'flat'
  const raw      = useMemo(
    () => (thread.result && !thread.result.is_error ? resultToString(thread.result.content) : ''),
    [thread.result],
  )
  const lineCount = useMemo(() => (raw ? raw.split('\n').filter(l => l.trim()).length : null), [raw])
  const countLabel = lineCount !== null
    ? (input.output_mode === 'files_with_matches' || !input.output_mode)
      ? `${lineCount} file${lineCount !== 1 ? 's' : ''}`
      : `${lineCount} lines`
    : null
  return (
    <CardShell color={c} result={thread.result} toolName="Grep"
      header={
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
            transition: 'background 0.15s ease',
          }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>GREP</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, flexShrink: 0 }}>
            /{pattern}/
          </span>
          {location && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-3)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {location}
            </span>
          )}
          {countLabel && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: lineCount! > 0 ? 'var(--green)' : 'var(--text-3)', flexShrink: 0 }}>
              {countLabel}
            </span>
          )}
        </div>
      }
    />
  )
}

// ── Glob card ─────────────────────────────────────────────────────────────────

function GlobCard({ thread }: { thread: ToolThread }) {
  const [hovered, setHovered] = useState(false)
  const input = thread.toolUse.input as { pattern?: string; path?: string }
  const pattern = input.pattern ?? ''
  const path    = input.path ?? ''
  const c       = toolColor('Glob')
  const flat    = useColorTreatment() === 'flat'
  const raw     = useMemo(
    () => (thread.result && !thread.result.is_error ? resultToString(thread.result.content) : ''),
    [thread.result],
  )
  const fileCount = useMemo(() => (raw ? raw.split('\n').filter(l => l.trim()).length : null), [raw])
  return (
    <CardShell color={c} result={thread.result} toolName="Glob"
      header={
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
            transition: 'background 0.15s ease',
          }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>GLOB</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pattern}
          </span>
          {path && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-3)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
              {path}
            </span>
          )}
          {fileCount !== null && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: fileCount > 0 ? 'var(--green)' : 'var(--text-3)', flexShrink: 0 }}>
              {fileCount} file{fileCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      }
    />
  )
}

// ── TodoWrite card ────────────────────────────────────────────────────────────

type TodoItem = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }

const TODO_ICON: Record<string, string>  = { completed: '✓', in_progress: '◐', pending: '○' }
const TODO_COLOR: Record<string, string> = { completed: 'var(--green)', in_progress: 'var(--amber)', pending: 'var(--text-3)' }

function TodoWriteCard({ thread }: { thread: ToolThread }) {
  const input = thread.toolUse.input as { todos?: unknown }
  // Tool input is provider data, not a validated type — a null or non-object
  // entry must not throw and blank the whole transcript.
  const todos: TodoItem[] = (Array.isArray(input.todos) ? input.todos : [])
    .filter((todo): todo is TodoItem => Boolean(todo) && typeof todo === 'object' && !Array.isArray(todo))
  const counts = { completed: 0, in_progress: 0, pending: 0 }
  for (const t of todos) {
    if (t.status === 'completed' || t.status === 'in_progress' || t.status === 'pending') counts[t.status] += 1
  }
  const flat = useColorTreatment() === 'flat'

  return (
    <div style={{ border: '1px solid var(--border)', borderLeft: '2px solid var(--violet)', borderRadius: 6, overflow: 'hidden', fontSize: 13, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: washBg(flat, 'linear-gradient(to right, var(--violet-glow), transparent)') }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--violet)', fontWeight: 500, letterSpacing: '0.06em' }}>TODOWRITE</span>
        <span style={{ flex: 1 }} />
        {counts.completed > 0  && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--green)'  }}>{counts.completed} done</span>}
        {counts.in_progress > 0 && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--amber)'  }}>{counts.in_progress} active</span>}
        {counts.pending > 0    && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>{counts.pending} pending</span>}
      </div>
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5, background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
        {todos.map((todo, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: TODO_COLOR[todo.status] ?? 'var(--text-3)', flexShrink: 0, marginTop: 1, width: 12, textAlign: 'center' }}>
              {TODO_ICON[todo.status] ?? '○'}
            </span>
            <span style={{ fontSize: 13, color: todo.status === 'completed' ? 'var(--text-3)' : 'var(--text)', textDecoration: todo.status === 'completed' ? 'line-through' : 'none', lineHeight: 1.5 }}>
              {typeof todo.content === 'string' && todo.content ? todo.content : todo.activeForm || '(untitled todo)'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Agent card ────────────────────────────────────────────────────────────────

type SubagentMessage = {
  type: string
  uuid: string
  message: {
    role: string
    content: string | Array<{ type: string; text?: string; name?: string }>
    usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }
  }
  timestamp?: string
}

function extractTextContent(content: SubagentMessage['message']['content']): string {
  if (typeof content === 'string') return content
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text ?? '')
    .join('\n')
    .trim()
}

function extractToolNames(content: SubagentMessage['message']['content']): string[] {
  if (typeof content === 'string') return []
  return content.filter((b) => b.type === 'tool_use' && b.name).map((b) => b.name ?? '')
}

const AGENT_STATUS_COLORS: Record<string, string> = {
  completed: 'var(--green)', async_launched: 'var(--cyan)',
  sub_agent_entered: 'var(--amber)', unknown: 'var(--text-3)', pending: 'var(--text-3)',
  failed: 'var(--red)',
}
const AGENT_STATUS_LABELS: Record<string, string> = {
  completed: 'done', async_launched: 'launched', sub_agent_entered: 'entered',
}

function AgentCard({ thread }: { thread: ToolThread }) {
  const sessionId = use(SessionContext)
  const hydrated = use(HydrationContext)
  // Read live text straight from context (changes every streamed token); keep
  // it OUT of the parse memo below so a sibling subagent's token doesn't
  // re-parse this card's completed-result JSON.
  const liveSubagentText = use(LiveSubagentTextContext)
  const liveText = liveSubagentText[thread.toolUse.id] ?? ''
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [transcriptMessages, setTranscriptMessages] = useState<SubagentMessage[] | null>(null)
  const [transcriptLoading, setTranscriptLoading] = useState(false)

  const input = thread.toolUse.input as {
    description?: string; prompt?: string; subagent_type?: string
    model?: string; run_in_background?: boolean; max_turns?: number
  }
  const c   = toolColor('Agent')
  const flat = useColorTreatment() === 'flat'

  // resultToString + JSON.parse over a completed subagent's (potentially
  // multi-KB) result is expensive; memoize on the result identity so the
  // per-token LiveSubagentTextContext fan-out re-render stays O(1).
  const parsedResult = useMemo(() => {
    const raw = thread.result ? resultToString(thread.result.content) : ''
    let parsed: Record<string, unknown> | null = null
    try { if (raw) parsed = JSON.parse(raw) } catch { /* not JSON */ }
    // Error results and plain-text async-launch receipts carry no JSON status.
    const fallbackStatus = !thread.result ? 'pending'
      : thread.result.is_error ? 'failed'
      : raw.includes('Async agent launched') ? 'async_launched'
      : 'unknown'
    return {
      status: (parsed?.status as string) ?? fallbackStatus,
      resultText: (parsed?.content as Array<{ text?: string }>)?.[0]?.text ?? (parsed?.message as string) ?? '',
      totalTokens: parsed?.totalTokens as number | undefined,
      totalToolUseCount: parsed?.totalToolUseCount as number | undefined,
      totalDurationMs: parsed?.totalDurationMs as number | undefined,
      outputFile: parsed?.outputFile as string | undefined,
      agentId: (parsed?.agentId as string | undefined) ?? raw.match(/agentId:\s*([a-z0-9-]+)/)?.[1],
      toolStats: parsed?.toolStats as { readCount?: number; searchCount?: number; bashCount?: number; editFileCount?: number; linesAdded?: number; linesRemoved?: number } | undefined,
    }
  }, [thread.result])

  const { status, resultText, totalTokens, totalToolUseCount, totalDurationMs, outputFile, agentId, toolStats } = parsedResult
  const statusColors = AGENT_STATUS_COLORS
  const statusLabels = AGENT_STATUS_LABELS

  const canViewTranscript = !!agentId && !!sessionId && (status === 'completed' || status === 'async_launched')

  const loadTranscript = async () => {
    if (transcriptMessages || !agentId || !sessionId) return
    setTranscriptLoading(true)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/subagents/${agentId}/messages`)
      const data = await readJsonResponse<{ messages?: SubagentMessage[] }>(res)
      setTranscriptMessages(data.messages ?? [])
    } catch {
      setTranscriptMessages([])
    } finally {
      setTranscriptLoading(false)
    }
  }

  const handleTranscriptToggle = () => {
    const next = !transcriptOpen
    setTranscriptOpen(next)
    if (next) loadTranscript()
  }

  const lifecycle = useMemo(() => {
    if (!transcriptMessages || transcriptMessages.length === 0) return null
    const timestamped = transcriptMessages.filter((m) => typeof m.timestamp === 'string') as Array<SubagentMessage & { timestamp: string }>
    const firstTs = timestamped[0]?.timestamp
    const lastTs = timestamped.at(-1)?.timestamp
    let startedAtMs: number | null = null
    let endedAtMs: number | null = null
    if (firstTs) { const t = new Date(firstTs).getTime(); if (Number.isFinite(t)) startedAtMs = t }
    if (lastTs)  { const t = new Date(lastTs).getTime();  if (Number.isFinite(t)) endedAtMs = t }
    const lastAssistant = [...transcriptMessages].reverse().find((m) => m.message.role === 'assistant')
    const lastAssistantText = lastAssistant ? extractTextContent(lastAssistant.message.content) : ''
    let contextInTokens = 0
    let contextOutTokens = 0
    for (const msg of transcriptMessages) {
      const usage = msg.message.usage
      if (usage) {
        contextInTokens += usage.input_tokens ?? 0
        contextOutTokens += usage.output_tokens ?? 0
      }
    }
    return { startedAtMs, endedAtMs, lastAssistantText, contextInTokens, contextOutTokens }
  }, [transcriptMessages])

  // Elapsed wall-clock per exchange within the subagent's own transcript —
  // same "turn = user message through the next user message" definition
  // used for top-level messages, so nested rows read consistently.
  const turnDurations = useMemo(() => {
    if (!transcriptMessages) return null
    return computeTurnDurationsMs(transcriptMessages.map((m) => ({
      role: m.message.role,
      uuid: m.uuid,
      timestamp: m.timestamp,
    })))
  }, [transcriptMessages])

  return (
    <div style={{ border: '1px solid var(--border)', borderLeft: `2px solid ${c}`, borderRadius: 6, overflow: 'hidden', fontSize: 13, marginTop: 4 }}>
      {/* Header */}
      <div
        onClick={() => resultText ? setOpen(v => !v) : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
          background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
          cursor: resultText ? 'pointer' : 'default', userSelect: 'none',
          transition: 'background 0.15s ease',
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
          {input.run_in_background ? 'AGENT ⟳' : 'AGENT'}
        </span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
          {input.description ?? ''}
        </span>
        {input.subagent_type && (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
            {input.subagent_type}
          </span>
        )}
        {thread.result && (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: statusColors[status] ?? 'var(--text-3)', flexShrink: 0 }}>
            {statusLabels[status] ?? status}
          </span>
        )}
        {resultText && <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>}
      </div>

      {/* Live streaming subagent text (forwardSubagentText) */}
      {!thread.result && liveText.trim() && (
        <div
          style={{
            padding: '8px 14px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg)',
            fontFamily: "var(--render-font)",
            fontSize: 12,
            color: 'var(--text-2)',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 200,
            overflowY: 'auto',
            position: 'relative',
          }}
        >
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 9,
            color: c,
            letterSpacing: '0.1em',
            marginBottom: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%',
              background: c,
              boxShadow: flat ? 'none' : `0 0 6px ${c}`,
              animation: 'pulse 1.2s ease-in-out infinite',
            }} />
            LIVE
          </div>
          {liveText.length > 1200 ? `…${liveText.slice(-1200)}` : liveText}
        </div>
      )}

      {/* Stats row for completed synchronous agents */}
      {status === 'completed' && (totalTokens != null || totalToolUseCount != null || totalDurationMs != null) && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '3px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
          {totalTokens       != null && <span>⬡ {totalTokens.toLocaleString()} tok</span>}
          {totalToolUseCount != null && <span>⚙ {totalToolUseCount} tools</span>}
          {totalDurationMs   != null && <span>⏱ {(totalDurationMs / 1000).toFixed(1)}s</span>}
          {input.model && <span>{input.model}</span>}
          {toolStats && toolStats.bashCount != null && toolStats.bashCount > 0 && <span style={{ color: 'var(--t-bash)' }}>bash×{toolStats.bashCount}</span>}
          {toolStats && toolStats.editFileCount != null && toolStats.editFileCount > 0 && <span style={{ color: 'var(--t-edit)' }}>edit×{toolStats.editFileCount}</span>}
          {toolStats && toolStats.readCount != null && toolStats.readCount > 0 && <span style={{ color: 'var(--t-read)' }}>read×{toolStats.readCount}</span>}
          {toolStats && toolStats.searchCount != null && toolStats.searchCount > 0 && <span style={{ color: 'var(--t-grep)' }}>search×{toolStats.searchCount}</span>}
          {toolStats && toolStats.linesAdded != null && toolStats.linesAdded > 0 && <span style={{ color: 'var(--t-edit)' }}>+{toolStats.linesAdded}</span>}
          {toolStats && toolStats.linesRemoved != null && toolStats.linesRemoved > 0 && <span style={{ color: 'var(--red)' }}>-{toolStats.linesRemoved}</span>}
        </div>
      )}

      {/* Output file path for async agents */}
      {status === 'async_launched' && outputFile && (
        <div style={{ padding: '3px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
          {outputFile}
        </div>
      )}

      {/* Subagent transcript toggle */}
      {canViewTranscript && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
          <button
            type="button"
            className="av-hover-control"
            onClick={handleTranscriptToggle}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              width: '100%', padding: '4px 12px',
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
              color: transcriptOpen ? c : 'var(--text-3)',
              textAlign: 'left',
            }}
          >
            <span style={{ opacity: 0.7 }}>↪</span>
            <span>{transcriptOpen ? 'HIDE TRANSCRIPT' : 'VIEW TRANSCRIPT'}</span>
            {transcriptLoading && <span style={{ opacity: 0.5 }}>…</span>}
            {!transcriptLoading && transcriptMessages && (
              <span style={{ opacity: 0.5 }}>
                ({transcriptMessages.length} msgs
                {lifecycle && (lifecycle.contextInTokens > 0 || lifecycle.contextOutTokens > 0) && (
                  <> · {fmtTokens(lifecycle.contextInTokens)} ctx / {fmtTokens(lifecycle.contextOutTokens)} out</>
                )}
                {input.model && <> · {input.model}</>})
              </span>
            )}
            {lifecycle && lifecycle.startedAtMs && lifecycle.endedAtMs && lifecycle.endedAtMs > lifecycle.startedAtMs && (
              <span style={{ opacity: 0.5 }}>
                · {formatClockShort(lifecycle.startedAtMs)} → {formatClockShort(lifecycle.endedAtMs)} ({formatDurationShort(lifecycle.endedAtMs - lifecycle.startedAtMs)})
              </span>
            )}
          </button>
          {lifecycle && lifecycle.lastAssistantText && !transcriptOpen && (
            <div
              title={lifecycle.lastAssistantText}
              style={{
                padding: '0 12px 6px 24px',
                fontFamily: "var(--render-font)",
                fontSize: 11,
                color: 'var(--text-3)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontStyle: 'italic',
              }}
            >
              ↳ {lifecycle.lastAssistantText.replace(/\s+/g, ' ').trim().slice(0, 200)}
            </div>
          )}
          {transcriptOpen && transcriptMessages && (
            <div style={{ borderTop: '1px solid var(--border)', maxHeight: 420, overflowY: 'auto', background: 'var(--bg)' }}>
              {transcriptMessages.length === 0
                ? <div style={{ padding: '10px 14px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>No messages</div>
                : transcriptMessages.map((msg) => {
                    const text  = extractTextContent(msg.message.content)
                    const tools = extractToolNames(msg.message.content)
                    const isAssistant = msg.message.role === 'assistant'
                    if (!text && tools.length === 0) return null
                    const rowUsage = msg.message.usage
                    const rowDurationMs = turnDurations?.get(msg.uuid)
                    return (
                      <div key={msg.uuid} style={{ borderBottom: '1px solid var(--border)', padding: '6px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: isAssistant ? c : 'var(--text-3)', letterSpacing: '0.06em' }}>
                            {isAssistant ? 'CLAUDE' : 'USER'}
                          </span>
                          {tools.length > 0 && (
                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)' }}>
                              {tools.join(', ')}
                            </span>
                          )}
                          <span style={{ flex: 1 }} />
                          {msg.timestamp && (
                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)' }}>
                              {hydrated ? formatLocalMessageTime(msg.timestamp) : formatStableMessageTime(msg.timestamp)}
                            </span>
                          )}
                          {rowDurationMs != null && rowDurationMs > 0 && (
                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)' }}>
                              ⏱ {formatDurationShort(rowDurationMs)}
                            </span>
                          )}
                          {rowUsage && (
                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)' }}>
                              {fmtTokens(rowUsage.input_tokens)}↑ {fmtTokens(rowUsage.output_tokens)}↓
                            </span>
                          )}
                        </div>
                        {text && (
                          <div style={{ fontFamily: "var(--render-font)", fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflowY: 'auto' }}>
                            {text.length > 500 ? text.slice(0, 500) + '…' : text}
                          </div>
                        )}
                      </div>
                    )
                  })
              }
            </div>
          )}
        </div>
      )}

      {/* Result text (collapsible) */}
      {open && resultText && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface)', fontFamily: "var(--render-font)", fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65, maxHeight: 320, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {resultText}
        </div>
      )}
    </div>
  )
}

// ── OpenCode task / task_status card ──────────────────────────────────────────

type OpenCodeTaskInput = {
  description?: string
  prompt?: string
  subagent_type?: string
  task_id?: string
  background?: boolean
  wait?: boolean
}

type OpenCodeTaskParsed = {
  taskId: string | null
  state: 'pending' | 'running' | 'completed' | 'error' | 'cancelled' | null
  bodyText: string
  isErrorBody: boolean
}

/**
 * The `task` tool result envelope follows OpenCode's `format()` / `output()` in
 * `packages/opencode/src/tool/task.ts`:
 *   task_id: <id>
 *   [state: <state>]   ← only for background / task_status
 *
 *   <task_result>…</task_result>     or   <task_error>…</task_error>
 */
function parseOpenCodeTaskResult(raw: string): OpenCodeTaskParsed {
  if (!raw) return { taskId: null, state: null, bodyText: '', isErrorBody: false }
  const idMatch = raw.match(/^task_id:\s*(\S+)/m)
  const stateMatch = raw.match(/^state:\s*(\w+)/m)
  const bodyMatch = raw.match(/<task_(result|error)>([\s\S]*?)<\/task_\1>/)
  const state = stateMatch?.[1] as OpenCodeTaskParsed['state'] | undefined
  return {
    taskId: idMatch?.[1] ?? null,
    state: state ?? null,
    bodyText: (bodyMatch?.[2] ?? '').trim(),
    isErrorBody: bodyMatch?.[1] === 'error',
  }
}

const OPENCODE_TASK_STATE_COLOR: Record<NonNullable<OpenCodeTaskParsed['state']>, string> = {
  pending: 'var(--text-3)',
  running: 'var(--amber)',
  completed: 'var(--green)',
  error: 'var(--red)',
  cancelled: 'var(--text-3)',
}

function OpenCodeTaskCard({ thread }: { thread: ToolThread }) {
  const sessionId = use(SessionContext)
  const hydrated = use(HydrationContext)
  const onOpenSession = use(NavigateSessionContext)
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [transcriptMessages, setTranscriptMessages] = useState<SubagentMessage[] | null>(null)
  const [transcriptLoading, setTranscriptLoading] = useState(false)

  const name = thread.toolUse.name
  const input = thread.toolUse.input as OpenCodeTaskInput
  const c = toolColor(name)
  const flat = useColorTreatment() === 'flat'
  const raw = thread.result ? resultToString(thread.result.content) : ''
  const isStatus = name === 'task_status'
  const isResultError = thread.result?.is_error === true

  const parsed = useMemo(() => parseOpenCodeTaskResult(raw), [raw])
  // The sync task tool result omits the state line — if we got a result and it
  // isn't an error, treat it as completed.
  const inferredState: OpenCodeTaskParsed['state'] = parsed.state
    ?? (parsed.isErrorBody || isResultError
      ? 'error'
      : thread.result
        ? 'completed'
        : 'running')

  // task_status takes task_id in input; the regular `task` tool returns it in
  // the result body. Either path lands us on the child sessionId.
  const taskId = parsed.taskId ?? input.task_id ?? null
  const shortTaskId = taskId ? taskId.slice(-8) : null
  const description = (input.description ?? '').trim() || (isStatus ? 'task status' : 'subagent task')
  const stateColor = inferredState ? OPENCODE_TASK_STATE_COLOR[inferredState] : 'var(--text-3)'
  const stateLabel = inferredState ?? '…'
  const isBackground = input.background === true || (isStatus && inferredState === 'running')

  const canViewTranscript = !!taskId && !!sessionId

  const loadTranscript = async () => {
    if (transcriptMessages || !taskId || !sessionId) return
    setTranscriptLoading(true)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/subagents/${taskId}/messages?provider=opencode`)
      const data = await readJsonResponse<{ messages?: SubagentMessage[] }>(res)
      setTranscriptMessages(data.messages ?? [])
    } catch {
      setTranscriptMessages([])
    } finally {
      setTranscriptLoading(false)
    }
  }

  const handleTranscriptToggle = () => {
    const next = !transcriptOpen
    setTranscriptOpen(next)
    if (next) loadTranscript()
  }

  const headerLabel = isStatus
    ? (isBackground ? 'TASK_STATUS ⟳' : 'TASK_STATUS')
    : (isBackground ? 'TASK ⟳' : 'TASK')

  const transcriptStats = useMemo(() => {
    if (!transcriptMessages) return null
    let inputTokens = 0
    let outputTokens = 0
    for (const msg of transcriptMessages) {
      const usage = msg.message.usage
      if (usage) {
        inputTokens += usage.input_tokens ?? 0
        outputTokens += usage.output_tokens ?? 0
      }
    }
    return { inputTokens, outputTokens }
  }, [transcriptMessages])

  const turnDurations = useMemo(() => {
    if (!transcriptMessages) return null
    return computeTurnDurationsMs(transcriptMessages.map((m) => ({
      role: m.message.role,
      uuid: m.uuid,
      timestamp: m.timestamp,
    })))
  }, [transcriptMessages])

  const openChildSession = taskId
    ? () => onOpenSession?.({ sessionId: taskId, provider: 'opencode' })
    : undefined

  return (
    <div style={{ border: '1px solid var(--border)', borderLeft: `2px solid ${c}`, borderRadius: 6, overflow: 'hidden', fontSize: 13, marginTop: 4 }}>
      <div
        onClick={() => parsed.bodyText ? setOpen(v => !v) : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
          background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
          cursor: parsed.bodyText ? 'pointer' : 'default', userSelect: 'none',
          transition: 'background 0.15s ease',
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
          {headerLabel}
        </span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
          {description}
        </span>
        {input.subagent_type && (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
            @{input.subagent_type}
          </span>
        )}
        {shortTaskId && (
          <span title={taskId ?? undefined} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>
            #{shortTaskId}
          </span>
        )}
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: stateColor, flexShrink: 0 }}>
          {stateLabel}
        </span>
        {parsed.bodyText && <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>}
      </div>

      {canViewTranscript && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
          <button
            type="button"
            className="av-hover-control"
            onClick={handleTranscriptToggle}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              width: '100%', padding: '4px 12px',
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
              color: transcriptOpen ? c : 'var(--text-3)',
              textAlign: 'left',
            }}
          >
            <span style={{ opacity: 0.7 }}>↪</span>
            <span>{transcriptOpen ? 'HIDE TRANSCRIPT' : 'VIEW TRANSCRIPT'}</span>
            {transcriptLoading && <span style={{ opacity: 0.5 }}>…</span>}
            {!transcriptLoading && transcriptMessages && (
              <span style={{ opacity: 0.5 }}>
                ({transcriptMessages.length} msgs
                {transcriptStats && (transcriptStats.inputTokens > 0 || transcriptStats.outputTokens > 0) && (
                  <> · {fmtTokens(transcriptStats.inputTokens)} ctx / {fmtTokens(transcriptStats.outputTokens)} out</>
                )})
              </span>
            )}
            {openChildSession && (
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); openChildSession() }}
                title="Open this subagent's own session"
                style={{ marginLeft: 'auto', opacity: 0.75 }}
              >
                Open session ⤢
              </span>
            )}
          </button>
          {transcriptOpen && transcriptMessages && (
            <div style={{ borderTop: '1px solid var(--border)', maxHeight: 420, overflowY: 'auto', background: 'var(--bg)' }}>
              {transcriptMessages.length === 0
                ? <div style={{ padding: '10px 14px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>No messages</div>
                : transcriptMessages.map((msg) => {
                    const text  = extractTextContent(msg.message.content)
                    const tools = extractToolNames(msg.message.content)
                    const isAssistant = msg.message.role === 'assistant'
                    if (!text && tools.length === 0) return null
                    const rowUsage = msg.message.usage
                    const rowDurationMs = turnDurations?.get(msg.uuid)
                    return (
                      <div key={msg.uuid} style={{ borderBottom: '1px solid var(--border)', padding: '6px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: isAssistant ? c : 'var(--text-3)', letterSpacing: '0.06em' }}>
                            {isAssistant ? 'AGENT' : 'USER'}
                          </span>
                          {tools.length > 0 && (
                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)' }}>
                              {tools.join(', ')}
                            </span>
                          )}
                          <span style={{ flex: 1 }} />
                          {msg.timestamp && (
                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)' }}>
                              {hydrated ? formatLocalMessageTime(msg.timestamp) : formatStableMessageTime(msg.timestamp)}
                            </span>
                          )}
                          {rowDurationMs != null && rowDurationMs > 0 && (
                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)' }}>
                              ⏱ {formatDurationShort(rowDurationMs)}
                            </span>
                          )}
                          {rowUsage && (
                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)' }}>
                              {fmtTokens(rowUsage.input_tokens)}↑ {fmtTokens(rowUsage.output_tokens)}↓
                            </span>
                          )}
                        </div>
                        {text && (
                          <div style={{ fontFamily: "var(--render-font)", fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflowY: 'auto' }}>
                            {text.length > 500 ? text.slice(0, 500) + '…' : text}
                          </div>
                        )}
                      </div>
                    )
                  })
              }
            </div>
          )}
        </div>
      )}

      {open && parsed.bodyText && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface)', fontFamily: "var(--render-font)", fontSize: 13, color: parsed.isErrorBody ? 'var(--red)' : 'var(--text-2)', lineHeight: 1.65, maxHeight: 320, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {parsed.bodyText}
        </div>
      )}
    </div>
  )
}

// ── Plan mode card ────────────────────────────────────────────────────────────

function PlanModeCard({ thread }: { thread: ToolThread }) {
  const isEnter = thread.toolUse.name === 'EnterPlanMode'
  const input   = thread.toolUse.input as { allowedPrompts?: unknown[] }
  const color   = isEnter ? 'var(--violet)' : 'var(--green)'
  const label   = isEnter ? '⊞ PLAN MODE' : '✓ PLAN APPROVED'
  const sub     = !isEnter && input.allowedPrompts?.length
    ? `${input.allowedPrompts.length} cmd${input.allowedPrompts.length !== 1 ? 's' : ''} approved`
    : isEnter ? 'entering' : 'exiting'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${color}44)` }} />
      <div style={{ fontFamily: "'Oxanium', monospace", fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', color, display: 'flex', alignItems: 'center', gap: 6 }}>
        {label}
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400, fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.04em' }}>
          {sub}
        </span>
      </div>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${color}44)` }} />
    </div>
  )
}

// ── Skill card ────────────────────────────────────────────────────────────────

function SkillCard({ thread }: { thread: ToolThread }) {
  const [hovered, setHovered] = useState(false)
  const input = thread.toolUse.input as { skill?: string; args?: string; name?: string }
  const skillName = input.skill ?? input.name ?? (Object.values(input)[0] as string) ?? ''
  const args      = input.args ?? ''
  const c         = 'var(--violet)'
  const flat      = useColorTreatment() === 'flat'

  return (
    <CardShell color={c} result={thread.result} toolName="Skill"
      header={
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            background: washBg(flat, `linear-gradient(to right, rgba(139,128,240,${hovered ? '0.14' : '0.08'}) 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
            transition: 'background 0.15s ease',
          }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>SKILL</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, fontWeight: 500, flexShrink: 0 }}>
            {skillName}
          </span>
          {args && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-2)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {args}
            </span>
          )}
        </div>
      }
    />
  )
}

// ── MultiEdit card ────────────────────────────────────────────────────────────

function MultiEditCard({ thread }: { thread: ToolThread }) {
  const { toolUse, result } = thread
  const flat  = useColorTreatment() === 'flat'
  const input = toolUse.input as {
    file_path?: string
    edits?: { old_string?: string; new_string?: string; replace_all?: boolean }[]
  }
  const filePath = input.file_path ?? ''
  const edits = input.edits ?? []
  const largeDiff = isLargeTextList(edits.flatMap((edit) => [edit.old_string ?? '', edit.new_string ?? '']))
  const [open, setOpen] = useState(() => !largeDiff)
  const [presentation, diffStyle, toggleDiffStyleOverride] = useDiffPresentation()
  const [hovered, setHovered] = useState(false)
  const c = toolColor('MultiEdit')

  const totalDelta = edits.reduce((acc, e) => {
    const oldLines = countLines(e.old_string ?? '')
    const newLines = countLines(e.new_string ?? '')
    return acc + (newLines - oldLines)
  }, 0)
  const deltaLabel = totalDelta > 0 ? `+${totalDelta}` : totalDelta < 0 ? String(totalDelta) : '±0'
  const deltaColor = totalDelta > 0 ? 'var(--green)' : totalDelta < 0 ? 'var(--red)' : 'var(--text-3)'

  return (
    <CardShell color={c} result={result} toolName="MultiEdit"
      header={
        <div
          onClick={() => setOpen(v => !v)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="av-tool-header"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px',
            background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
            userSelect: 'none',
          }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
            EDIT
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {basename(filePath)}
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', flexShrink: 0, border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px' }}>
            {edits.length} edit{edits.length !== 1 ? 's' : ''}
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: deltaColor, flexShrink: 0 }}>
            {deltaLabel}
          </span>
          {largeDiff && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--amber)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
              LARGE
            </span>
          )}
          <DiffStyleToggle diffStyle={diffStyle} onToggle={toggleDiffStyleOverride} />
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
        </div>
      }
      body={open ? (
        <>
          <div style={{
            padding: '2px 12px',
            background: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11, color: 'var(--text-3)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {filePath}
          </div>
          {edits.map((edit, i) => (
            <MultiEditDiffRegion
              key={i}
              index={i}
              total={edits.length}
              replaceAll={!!edit.replace_all}
              oldStr={edit.old_string ?? ''}
              newStr={edit.new_string ?? ''}
              filePath={filePath}
              presentation={presentation}
            />
          ))}
        </>
      ) : undefined}
    />
  )
}

function MultiEditDiffRegion({
  index,
  total,
  replaceAll,
  oldStr,
  newStr,
  filePath,
  presentation,
}: {
  index: number
  total: number
  replaceAll: boolean
  oldStr: string
  newStr: string
  filePath: string
  presentation: PierreDiffPresentation
}) {
  const diffContext = useMemo(() => buildEditDiffContext(oldStr, newStr), [oldStr, newStr])
  const sendDiffCommentToComposer = useSendDiffCommentToComposer(filePath, diffContext, 'MultiEdit tool diff')
  const comments = useDiffComments(filePath, { onSendToComposer: sendDiffCommentToComposer })
  return (
    <div>
      {total > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '2px 12px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11, color: 'var(--text-3)',
          userSelect: 'none',
        }}>
          <span>{index + 1} / {total}</span>
          {replaceAll && (
            <span style={{ color: 'var(--amber)', border: '1px solid var(--border)', borderRadius: 3, padding: '0 4px' }}>replace_all</span>
          )}
        </div>
      )}
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        padding: '2px 12px 0',
      }}>
        <DiffCommentButton
          selectedLines={comments.selectedLines}
          currentSelectionNote={comments.currentSelectionNote}
          onOpenComment={() => {
            if (!comments.selectedLines) return
            comments.onGutterUtilityClick(comments.selectedLines)
          }}
        />
      </div>
      <DiffThreadSummary count={comments.commentCount} />
      <DiffView
        oldStr={oldStr}
        newStr={newStr}
        filePath={filePath}
        presentation={presentation}
        selectedLines={comments.selectedLines}
        onSelectedLinesChange={comments.onSelectedLinesChange}
        lineAnnotations={comments.lineAnnotations}
        renderAnnotation={comments.renderAnnotation}
        onGutterUtilityClick={comments.onGutterUtilityClick}
      />
    </div>
  )
}

// ── WebSearch card ────────────────────────────────────────────────────────────

type WebSearchResult = { url?: string; title?: string; page_age?: string }

function parseWebSearchResults(raw: string): WebSearchResult[] | null {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as WebSearchResult[]
    if (parsed && typeof parsed === 'object') {
      const sub = (parsed as Record<string, unknown>).results ?? (parsed as Record<string, unknown>).data
      if (Array.isArray(sub)) return sub as WebSearchResult[]
    }
  } catch { /* not JSON */ }
  return null
}

function WebSearchCard({ thread }: { thread: ToolThread }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const input = thread.toolUse.input as { query?: string; max_uses?: number }
  const query = input.query ?? ''
  const c = 'var(--cyan)'
  const flat = useColorTreatment() === 'flat'
  const raw = thread.result ? resultToString(thread.result.content) : ''
  const isError = thread.result?.is_error ?? false
  const results = raw ? parseWebSearchResults(raw) : null
  const PREVIEW = 3

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `2px solid ${c}`,
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 13,
      marginTop: 4,
    }}>
      {/* Header */}
      <div
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px',
          background: washBg(flat, `linear-gradient(to right, rgba(56,217,245,${hovered ? '0.14' : '0.08'}) 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
          cursor: 'pointer', userSelect: 'none',
          transition: 'background 0.15s ease',
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
          WEBSEARCH
        </span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
          {query}
        </span>
        {results !== null && (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: results.length > 0 ? 'var(--green)' : 'var(--text-3)', flexShrink: 0 }}>
            {results.length} result{results.length !== 1 ? 's' : ''}
          </span>
        )}
        {isError && (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--red)', flexShrink: 0 }}>error</span>
        )}
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </div>

      {/* Body */}
      {open && thread.result && (
        results !== null ? (
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {(expanded ? results : results.slice(0, PREVIEW)).map((r, i) => (
                <div key={i} style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', flexDirection: 'column', gap: 2,
                  background: i % 2 === 0 ? 'var(--surface)' : 'transparent',
                }}>
                  {r.title && (
                    <div style={{ fontFamily: "var(--render-font)", fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>
                      {r.title}
                    </div>
                  )}
                  {r.url && (
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.url}
                    </div>
                  )}
                  {r.page_age && (
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
                      {r.page_age}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {results.length > PREVIEW && (
              <button type="button" className="av-hover-control" onClick={() => setExpanded(v => !v)} style={EXPAND_BTN}>
                {expanded ? '▲ collapse' : `▼ ${results.length - PREVIEW} more result${results.length - PREVIEW !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        ) : (
          <GenericResultSection raw={raw} isError={isError} />
        )
      )}
    </div>
  )
}

// ── WebFetch card ─────────────────────────────────────────────────────────────

function WebFetchCard({ thread }: { thread: ToolThread }) {
  const [hovered, setHovered] = useState(false)
  const input = thread.toolUse.input as { url?: string; max_content_tokens?: number }
  const url = input.url ?? ''
  const c = toolColor('WebFetch')
  const flat = useColorTreatment() === 'flat'

  let hostname = url
  try { hostname = new URL(url).hostname } catch { /* use full url as fallback */ }

  return (
    <CardShell color={c} result={thread.result} toolName="WebFetch"
      header={
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px',
            background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
            transition: 'background 0.15s ease',
          }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
            WEBFETCH
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, fontWeight: 500, flexShrink: 0 }}>
            {hostname}
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-3)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {url}
          </span>
        </div>
      }
    />
  )
}

// ── NotebookEdit card ─────────────────────────────────────────────────────────

function NotebookEditCard({ thread }: { thread: ToolThread }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const { toolUse, result } = thread
  const input = toolUse.input as {
    notebook_path?: string
    cell_number?: number
    new_source?: string
    cell_type?: string
    edit_mode?: string
  }
  const notebookPath = input.notebook_path ?? ''
  const cellNumber   = input.cell_number
  const newSource    = input.new_source
  const editMode     = input.edit_mode ?? 'replace'
  const c            = toolColor('NotebookEdit')
  const flat         = useColorTreatment() === 'flat'
  const hasBody      = !!newSource

  const chipColor = NOTEBOOK_EDIT_MODE_COLOR[editMode] ?? 'var(--text-3)'

  return (
    <CardShell color={c} result={result} toolName={toolUse.name}
      header={
        <div
          onClick={() => hasBody && setOpen(v => !v)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px',
            background: washBg(flat, `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
            cursor: hasBody ? 'pointer' : 'default',
            userSelect: 'none',
            transition: 'background 0.15s ease',
          }}
        >
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11, color: c, fontWeight: 500,
            letterSpacing: '0.06em', flexShrink: 0,
          }}>
            NOTEBOOK
          </span>
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            color: 'var(--text)', flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: 13,
          }}>
            {basename(notebookPath)}
          </span>
          {cellNumber !== undefined && (
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11, color: 'var(--text-2)',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: '1px 5px',
              flexShrink: 0,
            }}>
              cell {cellNumber}
            </span>
          )}
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11, color: chipColor,
            background: 'var(--surface-2)',
            border: `1px solid ${chipColor}44`,
            borderRadius: 3,
            padding: '1px 5px',
            flexShrink: 0,
            letterSpacing: '0.04em',
          }}>
            {editMode}
          </span>
          {hasBody && (
            <span style={{ color: 'var(--text-3)', fontSize: 11, flexShrink: 0 }}>
              {open ? '▲' : '▼'}
            </span>
          )}
        </div>
      }
      body={open && hasBody ? (
        <>
          <div style={{
            padding: '2px 12px',
            background: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11, color: 'var(--text-3)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {notebookPath}
          </div>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <CodeViewer
              code={newSource ?? ''}
              filePath={notebookPath}
              language={input.cell_type === 'markdown' ? 'markdown' : undefined}
              maxHeight={300}
            />
          </div>
        </>
      ) : undefined}
    />
  )
}

// ── Worktree card ─────────────────────────────────────────────────────────────

function WorktreeCard({ thread }: { thread: ToolThread }) {
  const isEnter = thread.toolUse.name === 'EnterWorktree'
  const input   = thread.toolUse.input as { name?: string }
  const color   = 'var(--cyan)'

  const label = isEnter ? '⊙ WORKTREE' : '⊙ WORKTREE EXIT'

  let sub = ''
  if (isEnter) {
    sub = input.name ?? ''
  } else {
    const raw = thread.result ? resultToString(thread.result.content) : ''
    sub = raw.split('\n')[0]?.trim() ?? ''
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${color}44)` }} />
      <div style={{
        fontFamily: "'Oxanium', monospace",
        fontSize: 11, fontWeight: 600, letterSpacing: '0.14em',
        color,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {label}
        {sub && (
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 400, fontSize: 11,
            color: 'var(--text-3)',
            letterSpacing: '0.04em',
          }}>
            {sub}
          </span>
        )}
      </div>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${color}44)` }} />
    </div>
  )
}

// ── Task card ─────────────────────────────────────────────────────────────────

// The TaskList tool reports an array (older agents) or `{ tasks: [...] }` (per
// the SDK's TaskListOutput). We keep the rendered record loose since the
// stop-tool variant (no SDK type) shares this shape.
type TaskRecord = Partial<Omit<TaskListOutput['tasks'][number], 'status'>> & { status?: string }
type TaskInput = Partial<TaskCreateInput & TaskGetInput & TaskUpdateInput & { _stopReason?: string }>
type TaskListGroupKey = 'in_progress' | 'blocked' | 'paused' | 'pending' | 'failed' | 'stopped' | 'completed' | 'other'

const TASK_ICON: Record<string, string>  = {
  completed: '✓',
  in_progress: '◐',
  running: '◐',
  pending: '○',
  paused: 'Ⅱ',
  failed: '×',
  stopped: '■',
  killed: '■',
  deleted: '✗',
}
const TASK_COLOR: Record<string, string> = {
  completed: 'var(--green)',
  in_progress: 'var(--amber)',
  running: 'var(--amber)',
  pending: 'var(--text-3)',
  paused: 'var(--yellow)',
  failed: 'var(--red)',
  stopped: 'var(--text-3)',
  killed: 'var(--text-3)',
  deleted: 'var(--red)',
}
const TASK_LIST_GROUP_ORDER: TaskListGroupKey[] = [
  'in_progress',
  'blocked',
  'paused',
  'pending',
  'failed',
  'stopped',
  'completed',
  'other',
]
const TASK_LIST_GROUP_LABEL: Record<TaskListGroupKey, string> = {
  in_progress: 'IN PROGRESS',
  blocked: 'BLOCKED',
  paused: 'PAUSED',
  pending: 'PENDING',
  failed: 'FAILED',
  stopped: 'STOPPED',
  completed: 'COMPLETED',
  other: 'OTHER',
}

function taskListGroupFor(task: TaskRecord, completedSet: Set<string>): TaskListGroupKey {
  const status = task.status ?? 'pending'
  const blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy : []
  const openBlockers = blockedBy.filter((id) => !completedSet.has(id))
  if ((status === 'pending' || status === '') && openBlockers.length > 0) return 'blocked'
  if (status === 'in_progress' || status === 'running') return 'in_progress'
  if (status === 'paused') return 'paused'
  if (status === 'pending' || status === '') return 'pending'
  if (status === 'failed') return 'failed'
  if (status === 'stopped' || status === 'killed') return 'stopped'
  if (status === 'completed') return 'completed'
  return 'other'
}

function groupTaskRecords(tasks: TaskRecord[], completedSet: Set<string>): Array<{ group: TaskListGroupKey; tasks: TaskRecord[] }> {
  const grouped: Record<TaskListGroupKey, TaskRecord[]> = {
    in_progress: [],
    blocked: [],
    paused: [],
    pending: [],
    failed: [],
    stopped: [],
    completed: [],
    other: [],
  }
  for (const task of tasks) grouped[taskListGroupFor(task, completedSet)].push(task)
  return TASK_LIST_GROUP_ORDER
    .map((group) => ({ group, tasks: grouped[group] }))
    .filter((entry) => entry.tasks.length > 0)
}

function TaskCard({ thread }: { thread: ToolThread }) {
  const [hovered, setHovered] = useState(false)
  const { toolUse, result } = thread
  const name  = toolUse.name
  const c     = 'var(--amber)'
  const flat  = useColorTreatment() === 'flat'
  const input = toolUse.input as TaskInput
  const raw = result ? resultToString(result.content) : ''
  const isError = result?.is_error === true
  const activeForms = use(TaskActiveFormsContext)

  const parsed = useMemo<unknown>(() => {
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }, [raw])

  let tasks: TaskRecord[] | null = null
  if (name === 'TaskList' && parsed) {
    if (Array.isArray(parsed)) tasks = parsed as TaskRecord[]
    else if (typeof parsed === 'object' && Array.isArray((parsed as TaskListOutput).tasks)) {
      tasks = (parsed as TaskListOutput).tasks
    }
  }

  const createdId = name === 'TaskCreate' && parsed && typeof parsed === 'object'
    ? (parsed as TaskCreateOutput).task?.id ?? null
    : null
  const gotTask = name === 'TaskGet' && parsed && typeof parsed === 'object'
    ? ((parsed as TaskGetOutput).task ?? null)
    : null
  const updateOut = (name === 'TaskUpdate' && parsed && typeof parsed === 'object'
    ? (parsed as TaskUpdateOutput)
    : null)

  // TaskStop SDK input field is `task_id` (snake) for the background-process
  // tool; older agents used `taskId`. Accept either.
  const stopId = name === 'TaskStop'
    ? (input.taskId ?? (toolUse.input as { task_id?: string }).task_id ?? '')
    : ''
  const taskUpdateInput = input as Partial<TaskUpdateInput>
  const addBlocks = name === 'TaskUpdate' && Array.isArray(taskUpdateInput.addBlocks)
    ? taskUpdateInput.addBlocks : []
  const addBlockedBy = name === 'TaskUpdate' && Array.isArray(taskUpdateInput.addBlockedBy)
    ? taskUpdateInput.addBlockedBy : []
  const statusChange = updateOut?.statusChange ?? null

  const headerContent = (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', flexWrap: 'wrap',
        background: washBg(flat, `linear-gradient(to right, rgba(245,158,11,${hovered ? '0.14' : '0.08'}) 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
        transition: 'background 0.15s ease',
      }}
    >
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
        TASK
      </span>
      {name === 'TaskCreate' && (
        <>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {input.subject ?? ''}
          </span>
          {createdId && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
              #{createdId}
            </span>
          )}
        </>
      )}
      {name === 'TaskList' && (
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-2)', fontSize: 11, flex: 1 }}>
          {tasks !== null ? `${tasks.length} task${tasks.length !== 1 ? 's' : ''}` : 'list'}
        </span>
      )}
      {(name === 'TaskGet' || name === 'TaskUpdate') && (
        <>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, flexShrink: 0 }}>
            #{input.taskId ?? ''}
          </span>
          {name === 'TaskUpdate' && statusChange && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: TASK_COLOR[statusChange.to] ?? 'var(--text-3)', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px', flexShrink: 0 }}>
              {statusChange.from} → {statusChange.to}
            </span>
          )}
          {name === 'TaskUpdate' && !statusChange && input.status && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: TASK_COLOR[input.status] ?? 'var(--text-3)', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px', flexShrink: 0 }}>
              {input.status}
            </span>
          )}
          {name === 'TaskUpdate' && addBlockedBy.length > 0 && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px', flexShrink: 0 }}>
              +blocked by {addBlockedBy.map((id) => `#${id}`).join(', ')}
            </span>
          )}
          {name === 'TaskUpdate' && addBlocks.length > 0 && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px', flexShrink: 0 }}>
              +blocks {addBlocks.map((id) => `#${id}`).join(', ')}
            </span>
          )}
          <span style={{ flex: 1 }} />
        </>
      )}
      {name === 'TaskStop' && (
        <>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, flexShrink: 0 }}>
            #{stopId}
          </span>
          <span style={{ flex: 1 }} />
        </>
      )}
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.04em', flexShrink: 0 }}>
        {name === 'TaskCreate' ? 'create'
          : name === 'TaskList'   ? 'list'
          : name === 'TaskGet'    ? 'get'
          : name === 'TaskUpdate' ? 'update'
          : name === 'TaskStop'   ? 'stop'
          : name}
      </span>
    </div>
  )

  const bodyContent = (() => {
    if (name === 'TaskCreate') {
      const description = (input.description ?? '').trim()
      const activeForm = (input.activeForm ?? '').trim()
      if (!description && !activeForm) return null
      return (
        <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          {description && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45 }}>
              {description}
            </div>
          )}
          {activeForm && (
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
              active: {activeForm}
            </div>
          )}
        </div>
      )
    }
    if (name === 'TaskGet' && gotTask) {
      const description = (gotTask.description ?? '').trim()
      const blockedBy = Array.isArray(gotTask.blockedBy) ? gotTask.blockedBy : []
      const blocks = Array.isArray(gotTask.blocks) ? gotTask.blocks : []
      return (
        <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: TASK_COLOR[gotTask.status] ?? 'var(--text-3)' }}>
              {TASK_ICON[gotTask.status] ?? '○'}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
              {gotTask.subject}
            </span>
          </div>
          {description && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45, paddingLeft: 20 }}>
              {description}
            </div>
          )}
          {blockedBy.length > 0 && (
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', paddingLeft: 20 }}>
              ↳ blocked by {blockedBy.map((id) => `#${id}`).join(', ')}
            </div>
          )}
          {blocks.length > 0 && (
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', paddingLeft: 20 }}>
              ⤴ blocks {blocks.map((id) => `#${id}`).join(', ')}
            </div>
          )}
        </div>
      )
    }
    if (name === 'TaskGet' && parsed && !gotTask && !isError) {
      return (
        <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          task not found
        </div>
      )
    }
    if (name === 'TaskUpdate' && updateOut && (updateOut.updatedFields?.length || updateOut.error)) {
      const fields = updateOut.updatedFields ?? []
      return (
        <div style={{ padding: '6px 14px', display: 'flex', flexDirection: 'column', gap: 3, background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          {fields.length > 0 && (
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
              changed: {fields.join(', ')}
            </div>
          )}
          {updateOut.error && (
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--red)' }}>
              {updateOut.error}
            </div>
          )}
        </div>
      )
    }
    return null
  })()

  // TaskList with parsed tasks: custom layout
  if (name === 'TaskList' && tasks !== null) {
    const completedSet = new Set(
      tasks.filter((t) => t.status === 'completed' && t.id).map((t) => t.id as string),
    )
    const groupedTasks = groupTaskRecords(tasks, completedSet)
    return (
      <div style={{ border: '1px solid var(--border)', borderLeft: `2px solid ${c}`, borderRadius: 6, overflow: 'hidden', fontSize: 13, marginTop: 4 }}>
        {headerContent}
        {tasks.length > 0 && (
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
            {groupedTasks.map(({ group, tasks: groupTasks }) => (
              <section key={group} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.08em',
                    lineHeight: 1.3,
                  }}
                >
                  {TASK_LIST_GROUP_LABEL[group]} · {groupTasks.length}
                </div>
                {groupTasks.map((t, i) => {
                  const st = t.status ?? 'pending'
                  const blockedBy = Array.isArray(t.blockedBy) ? t.blockedBy : []
                  const openBlockers = blockedBy.filter((id) => !completedSet.has(id))
                  const isBlocked = group === 'blocked'
                  const activeForm = (st === 'in_progress' || st === 'running') && t.id ? activeForms.get(t.id) : undefined
                  const subject = activeForm && activeForm.trim() ? activeForm.trim() : (t.subject ?? t.id ?? '—')
                  const subjectColor = st === 'completed'
                    ? 'var(--text-3)'
                    : isBlocked
                    ? 'var(--text-2)'
                    : 'var(--text)'
                  return (
                    <div key={`${group}-${t.id ?? i}`} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: TASK_COLOR[st] ?? 'var(--text-3)', flexShrink: 0, marginTop: 1, width: 12, textAlign: 'center' }}>
                          {TASK_ICON[st] ?? '○'}
                        </span>
                        <span
                          title={blockedBy.length > 0 ? `blocked by ${blockedBy.map((id) => `#${id}`).join(', ')}` : undefined}
                          style={{
                            fontSize: 13,
                            color: subjectColor,
                            lineHeight: 1.5,
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            textDecoration: st === 'completed' ? 'line-through' : 'none',
                            fontStyle: activeForm ? 'italic' : 'normal',
                          }}
                        >
                          {subject}
                        </span>
                        {t.owner && (
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--violet)', flexShrink: 0 }}>
                            @{t.owner}
                          </span>
                        )}
                        {t.id && (
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
                            #{t.id}
                          </span>
                        )}
                      </div>
                      {isBlocked && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 20 }}>
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>
                            ↳
                          </span>
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
                            blocked by {openBlockers.map((id) => `#${id}`).join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </section>
            ))}
          </div>
        )}
      </div>
    )
  }

  // All others: use CardShell
  return (
    <CardShell color={c} result={result} toolName={name} header={headerContent} body={bodyContent} />
  )
}

// ── Cron card ─────────────────────────────────────────────────────────────────

type CronRecord = { task_id?: string; cron_expression?: string; prompt?: string; next_run?: string }

function CronCard({ thread }: { thread: ToolThread }) {
  const [hovered, setHovered] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const { toolUse, result } = thread
  const name  = toolUse.name
  const c     = 'var(--t-glob)'
  const flat  = useColorTreatment() === 'flat'
  const input = toolUse.input as { cron_expression?: string; prompt?: string; task_id?: string }
  const raw   = result ? resultToString(result.content) : ''

  let crons: CronRecord[] | null = null
  if (name === 'CronList' && raw) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) crons = p as CronRecord[] } catch { /* not JSON */ }
  }

  const CRON_LIMIT = 3

  const headerContent = (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
        background: washBg(flat, `linear-gradient(to right, var(--t-glob)${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
        transition: 'background 0.15s ease',
      }}
    >
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
        CRON
      </span>
      {name === 'CronCreate' && (
        <>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, flexShrink: 0 }}>
            {input.cron_expression ?? ''}
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-2)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {(input.prompt ?? '').slice(0, 80)}
          </span>
        </>
      )}
      {name === 'CronList' && (
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-2)', fontSize: 11, flex: 1 }}>
          {crons !== null ? `${crons.length} job${crons.length !== 1 ? 's' : ''}` : 'list'}
        </span>
      )}
      {name === 'CronDelete' && (
        <>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {input.task_id ?? ''}
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--red)', letterSpacing: '0.04em', flexShrink: 0 }}>delete</span>
        </>
      )}
    </div>
  )

  // CronList with parsed jobs
  if (name === 'CronList' && crons !== null) {
    const visible = expanded ? crons : crons.slice(0, CRON_LIMIT)
    const hidden  = crons.length - visible.length
    return (
      <div style={{ border: '1px solid var(--border)', borderLeft: `2px solid ${c}`, borderRadius: 6, overflow: 'hidden', fontSize: 13, marginTop: 4 }}>
        {headerContent}
        {crons.length > 0 && (
          <div style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
            {visible.map((job, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 12px', borderBottom: i < visible.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, flexShrink: 0, minWidth: 110 }}>
                  {job.cron_expression ?? '—'}
                </span>
                <span style={{ fontFamily: "var(--render-font)", fontSize: 13, color: 'var(--text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {job.prompt ?? ''}
                </span>
              </div>
            ))}
            {(hidden > 0 || expanded) && (
              <button type="button" className="av-hover-control" onClick={() => setExpanded(v => !v)} style={EXPAND_BTN}>
                {expanded ? '▲ collapse' : `▼ ${hidden} more`}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <CardShell color={c} result={result} toolName={name} header={headerContent} />
  )
}

// ── MCP card ──────────────────────────────────────────────────────────────────

type McpResource = { uri?: string; name?: string; mimeType?: string }

function McpCard({ thread }: { thread: ToolThread }) {
  const [open, setOpen] = useState(true)
  const [hovered, setHovered] = useState(false)
  const { toolUse, result } = thread
  const name  = toolUse.name
  const c     = 'var(--t-other)'
  const flat  = useColorTreatment() === 'flat'
  const input = toolUse.input as { server?: string; uri?: string }
  const raw   = result ? resultToString(result.content) : ''

  let resources: McpResource[] | null = null
  if (name === 'ListMcpResourcesTool' && raw) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) resources = p as McpResource[] } catch { /* not JSON */ }
  }

  const serverLabel = input.server ?? 'all servers'
  const uri = input.uri ?? ''

  const header = (
    <div
      onClick={() => setOpen(v => !v)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
        background: washBg(flat, `linear-gradient(to right, var(--t-other)${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
        cursor: 'pointer', userSelect: 'none', transition: 'background 0.15s ease',
      }}
    >
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
        MCP
      </span>
      {name === 'ListMcpResourcesTool' && (
        <>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, flexShrink: 0 }}>
            {serverLabel}
          </span>
          {resources !== null && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--green)', background: 'rgba(45,212,160,0.08)', border: '1px solid rgba(45,212,160,0.2)', borderRadius: 3, padding: '1px 6px', flexShrink: 0 }}>
              {resources.length} resource{resources.length !== 1 ? 's' : ''}
            </span>
          )}
        </>
      )}
      {name === 'ReadMcpResourceTool' && (
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {uri.length > 72 ? '…' + uri.slice(-70) : uri}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
    </div>
  )

  // ListMcpResourcesTool: show resource chips when open
  if (name === 'ListMcpResourcesTool') {
    return (
      <div style={{ border: '1px solid var(--border)', borderLeft: `2px solid ${c}`, borderRadius: 6, overflow: 'hidden', fontSize: 13, marginTop: 4 }}>
        {header}
        {open && resources !== null && resources.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 12px', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
            {resources.map((r, i) => (
              <span key={i} style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11, color: c,
                background: 'var(--surface-3)',
                border: '1px solid var(--border-2)',
                borderLeft: `2px solid ${c}`,
                borderRadius: 4,
                padding: '2px 8px',
                letterSpacing: '0.02em',
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
                title={r.uri}
              >
                {r.name ?? r.uri ?? '—'}
              </span>
            ))}
          </div>
        )}
        {open && result?.is_error && (
          <GenericResultSection raw={raw} isError />
        )}
      </div>
    )
  }

  // ReadMcpResourceTool: use CardShell with collapse on header via body
  return (
    <CardShell color={c} result={open ? result : null} toolName={name} header={header} />
  )
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

function ToolThreadCard({ thread }: { thread: ToolThread }) {
  const nativeThread = normalizeToolThreadForNativeCard(thread)
  const name = nativeThread.toolUse.name
  if (name === 'Edit')                         return <EditToolCard thread={nativeThread} />
  if (name === 'MultiEdit')                    return <MultiEditCard thread={nativeThread} />
  if (name === 'FileChange')                   return <FileChangeCard thread={nativeThread} />
  if (name === 'Write')                        return <WriteToolCard thread={nativeThread} />
  if (name === 'Bash')                         return <BashCard thread={nativeThread} />
  if (name === 'Read')                         return <ReadCard thread={nativeThread} />
  if (name === 'Grep')                         return <GrepCard thread={nativeThread} />
  if (name === 'Glob')                         return <GlobCard thread={nativeThread} />
  if (name === 'TodoWrite')                    return <TodoWriteCard thread={nativeThread} />
  if (name === 'Agent')                        return <AgentCard thread={nativeThread} />
  if (name === 'task' || name === 'task_status') return <OpenCodeTaskCard thread={nativeThread} />
  if (name === 'EnterPlanMode' || name === 'ExitPlanMode') return <PlanModeCard thread={nativeThread} />
  if (name === 'Skill')                        return <SkillCard thread={nativeThread} />
  if (name === 'AskUserQuestion')              return <AskUserQuestionCard thread={nativeThread} />
  if (name === 'ToolSearch')                   return <ToolSearchCard thread={nativeThread} />
  if (name === 'WebSearch')                    return <WebSearchCard thread={nativeThread} />
  if (name === 'WebFetch')                     return <WebFetchCard thread={nativeThread} />
  if (name === 'NotebookEdit')                 return <NotebookEditCard thread={nativeThread} />
  if (name === 'EnterWorktree' || name === 'ExitWorktree') return <WorktreeCard thread={nativeThread} />
  if (name === 'TaskCreate' || name === 'TaskList' || name === 'TaskGet' || name === 'TaskUpdate' || name === 'TaskStop') return <TaskCard thread={nativeThread} />
  if (name === 'CronCreate' || name === 'CronList' || name === 'CronDelete') return <CronCard thread={nativeThread} />
  if (name === 'ListMcpResourcesTool' || name === 'ReadMcpResourceTool') return <McpCard thread={nativeThread} />
  if (isMcpToolName(name)) return <McpToolCard thread={nativeThread} />
  return <GenericToolCard thread={thread} />
}

// ── Tool result renderers ─────────────────────────────────────────────────────

function resultToString(content: ToolResultBlock['content']): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(b => {
        if ((b as { type: string }).type !== 'text') return JSON.stringify(b)
        const text = (b as { text?: unknown }).text
        if (typeof text === 'string') return text
        const file = (b as { file?: unknown }).file
        if (file && typeof file === 'object' && typeof (file as { content?: unknown }).content === 'string') {
          return (file as { content: string }).content
        }
        return JSON.stringify(b)
      })
      .join('\n')
  }
  return JSON.stringify(content, null, 2)
}

type ToolResultWhy = {
  headline: string
  details: string[]
}

function explainToolResult(result: ToolResultBlock, toolName: string, raw: string, hasImage: boolean, readSummary: ClaudeReadFileSummary | null): ToolResultWhy {
  const toolLabel = toolName || 'tool'
  const resultId = result.tool_use_id ? `tool_use_id ${result.tool_use_id.slice(0, 8)}` : 'the originating tool call'
  const outputShape = hasImage
    ? 'image output'
    : raw.trim()
      ? `${countLines(raw)} text line${countLines(raw) === 1 ? '' : 's'}`
      : 'no text output'
  const toolMeta = result.tool_result_meta
  const metaDetails = toolMeta && Object.keys(toolMeta).length > 0
    ? [`Claude classified this tool result as ${Object.entries(toolMeta)
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value)}`)
      .join(' · ') || 'having additional execution metadata'}.`]
    : []

  if (result.is_error) {
    return {
      headline: `${toolLabel} returned an error result.`,
      details: [
        `The provider paired this result with ${resultId} and marked it with is_error.`,
        raw.trim() ? 'The visible output is the error payload returned by the tool runtime.' : 'No additional error text was returned by the tool runtime.',
        ...metaDetails,
      ],
    }
  }

  if (toolName === 'Read' && readSummary) {
    return {
      headline: 'Read output was normalized into a file preview.',
      details: [
        `The result matched ${resultId} and contains ${outputShape}.`,
        `Read metadata identified ${formatClaudeReadKind(readSummary)} content, so the viewer renders it with file-oriented formatting instead of a generic log block.`,
        ...metaDetails,
      ],
    }
  }

  return {
    headline: `${toolLabel} completed successfully.`,
    details: [
      `The result matched ${resultId} and was not marked as an error.`,
      hasImage ? 'The payload includes an image content block, so the viewer renders media instead of text.' : `The payload contains ${outputShape}.`,
      ...metaDetails,
    ],
  }
}

function ToolResultWhyDisclosure({ why }: { why: ToolResultWhy }) {
  return (
    <details className="av-tool-result-why">
      <summary>
        <CircleHelp aria-hidden="true" />
        Why?
        <span>{why.headline}</span>
      </summary>
      <div>
        {why.details.map((detail) => (
          <p key={detail}>{detail}</p>
        ))}
      </div>
    </details>
  )
}

const EXPAND_BTN: React.CSSProperties = {
  display: 'block', width: '100%', padding: '6px 14px',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 12, color: 'var(--text-3)',
  background: 'var(--surface)', border: 'none',
  borderTop: '1px solid var(--border)',
  cursor: 'pointer', textAlign: 'left',
  letterSpacing: '0.04em',
}

function parseFileLines(text: string) {
  const lines = text.split('\n').map(line => {
    const tab = line.indexOf('\t')
    return tab === -1 ? { num: '', code: line } : { num: line.slice(0, tab), code: line.slice(tab + 1) }
  })
  if (lines.length && lines[lines.length - 1].num === '' && lines[lines.length - 1].code === '') lines.pop()
  return lines
}

function ReadResultSection({ raw, filePath, summary }: { raw: string; filePath?: string; summary?: ClaudeReadFileSummary }) {
  const [expanded, setExpanded] = useState(false)
  const LIMIT = 25
  const displayFilePath = summary?.filePath ?? filePath
  const readMetadata = summary ? formatClaudeReadMetadata(summary) : []

  const parts = useMemo(() => splitResultParts(raw), [raw])
  const textPartLines = useMemo(
    () => parts.map((part) => part.kind === 'text' ? parseFileLines(part.text) : null),
    [parts],
  )
  const processedParts = useMemo(() => {
    let budget = expanded ? Number.POSITIVE_INFINITY : LIMIT
    return parts.map((part, index) => {
      if (part.kind === 'system_reminder') return { ...part, visibleLines: [] as ReturnType<typeof parseFileLines> }
      const lines = textPartLines[index] ?? []
      const visibleLines = budget > 0 ? lines.slice(0, budget) : []
      budget = Math.max(0, budget - lines.length)
      return { ...part, visibleLines }
    })
  }, [expanded, parts, textPartLines])
  const totalLines = useMemo(
    () => textPartLines.reduce((count, lines) => count + (lines?.length ?? 0), 0),
    [textPartLines],
  )
  const hidden = Math.max(0, totalLines - LIMIT)

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      {readMetadata.length > 0 && (
        <div style={{
          padding: '4px 12px',
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: 'var(--text-3)',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
        }}>
          {readMetadata.map((entry) => (
            <span key={entry} style={{ color: entry === 'token cap' ? 'var(--yellow)' : undefined }}>
              {entry === 'token cap' ? 'Partial read: token cap reached' : entry}
            </span>
          ))}
        </div>
      )}
      {processedParts.map((part, i) =>
        part.kind === 'system_reminder'
          ? <SystemReminderCard key={i} block={{ type: 'system_reminder', content: part.content }} />
          : part.visibleLines.length > 0
            ? (
              <div key={i}>
                <CodeViewer
                  code={part.visibleLines.map(line => line.code).join('\n')}
                  filePath={displayFilePath}
                  showLineNumbers={summary?.structured && summary.startLine != null ? true : shouldShowLineNumbers(part.visibleLines)}
                  startingLineNumber={summary?.structured && summary.startLine != null ? summary.startLine : inferStartingLineNumber(part.visibleLines)}
                  maxHeight={500}
                />
              </div>
            )
            : null
      )}
      {totalLines > LIMIT && (
        <button type="button" className="av-hover-control" onClick={() => setExpanded(v => !v)} style={EXPAND_BTN}>
          {expanded ? '▲ collapse' : `▼ ${hidden} more lines`}
        </button>
      )}
    </div>
  )
}

type ResultPart =
  | { kind: 'text'; text: string }
  | { kind: 'system_reminder'; content: string }

function splitResultParts(raw: string): ResultPart[] {
  const matches = [...raw.matchAll(/<system-reminder>([\s\S]*?)<\/system-reminder>/g)]
  if (matches.length === 0) return [{ kind: 'text', text: raw }]
  const parts: ResultPart[] = []
  let lastIndex = 0
  for (const match of matches) {
    const before = raw.slice(lastIndex, match.index)
    if (before.trim()) parts.push({ kind: 'text', text: before })
    const content = match[1].trim()
    if (content) parts.push({ kind: 'system_reminder', content })
    lastIndex = (match.index ?? 0) + match[0].length
  }
  const after = raw.slice(lastIndex)
  if (after.trim()) parts.push({ kind: 'text', text: after })
  return parts
}

function GenericResultSection({ raw, isError = false, note }: { raw: string; isError?: boolean; note?: string }) {
  const [expanded, setExpanded] = useState(false)
  const LIMIT = 20

  const { parts, hasReminders, partLines, totalTextLines } = useMemo(() => {
    const parts = splitResultParts(raw)
    const hasReminders = parts.some(p => p.kind === 'system_reminder')
    const partLines = parts.map(p => (p.kind === 'system_reminder' ? null : p.text.split('\n')))
    const totalTextLines = partLines.reduce<number>((n, lines) => n + (lines ? lines.length : 0), 0)
    return { parts, hasReminders, partLines, totalTextLines }
  }, [raw])

  // Pre-compute visible lines across text parts (system-reminder parts don't count toward limit)
  let budget = expanded ? Infinity : LIMIT
  const processedParts = parts.map((part, i) => {
    if (part.kind === 'system_reminder') return { ...part, visibleLines: [] as string[] }
    const lines = partLines[i]!
    const visibleLines = budget > 0 ? lines.slice(0, budget) : []
    budget = Math.max(0, budget - lines.length)
    return { ...part, visibleLines }
  })

  const hidden = Math.max(0, totalTextLines - LIMIT)

  return (
    <div style={{ borderTop: `1px solid ${isError ? 'rgba(240,96,96,0.25)' : 'var(--border)'}` }}>
      <div style={{
        padding: '3px 12px', fontSize: 11,
        fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: 500, letterSpacing: '0.06em',
        color: isError ? 'var(--red)' : 'var(--green)',
        background: isError ? 'rgba(240,96,96,0.06)' : 'rgba(45,212,160,0.05)',
        display: 'flex', gap: 8,
      }}>
        <span>{isError ? '✗ ERROR' : '✓ OK'}</span>
        {note && <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{note}</span>}
      </div>

      {!hasReminders ? (
        <pre style={GENERIC_RESULT_PRE_STYLE}>{processedParts[0]?.kind === 'text' ? processedParts[0].visibleLines.join('\n') : ''}</pre>
      ) : (
        processedParts.map((part, i) =>
          part.kind === 'system_reminder'
            ? <SystemReminderCard key={i} block={{ type: 'system_reminder', content: part.content }} />
            : part.visibleLines.length > 0
              ? <pre key={i} style={GENERIC_RESULT_PRE_STYLE}>{part.visibleLines.join('\n')}</pre>
              : null
        )
      )}

      {totalTextLines > LIMIT && (
        <button type="button" className="av-hover-control" onClick={() => setExpanded(v => !v)} style={EXPAND_BTN}>
          {expanded ? '▲ collapse' : `▼ ${hidden} more lines`}
        </button>
      )}
    </div>
  )
}

function ImageResultSection({ block }: { block: ImageBlock }) {
  let src = ''
  let mediaType = ''
  let w: number | undefined, h: number | undefined

  if (block.source?.type === 'base64') {
    src = `data:${block.source.media_type};base64,${block.source.data}`
    mediaType = block.source.media_type
  } else if (block.file?.base64) {
    src = `data:${block.file.type};base64,${block.file.base64}`
    mediaType = block.file.type
    w = block.file.dimensions?.displayWidth ?? block.file.dimensions?.originalWidth
    h = block.file.dimensions?.displayHeight ?? block.file.dimensions?.originalHeight
  }

  if (!src) return null

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)', padding: 12 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: 480, display: 'block', borderRadius: 4, border: '1px solid var(--border)' }} />
      <div style={{ marginTop: 4, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
        {[mediaType, w && h ? `${w} × ${h}` : null].filter(Boolean).join(' · ')}
      </div>
    </div>
  )
}

function ToolResultSection({ result, toolName, filePath }: { result: ToolResultBlock; toolName: string; filePath?: string }) {
  const imageBlock = useMemo(() => (
    Array.isArray(result.content)
      ? result.content.find((b): b is ImageBlock => (b as ImageBlock).type === 'image') ?? null
      : null
  ), [result.content])
  const readSummary = useMemo(
    () => toolName === 'Read' ? extractClaudeReadFileSummary(result, filePath) : null,
    [filePath, result, toolName],
  )
  const raw = useMemo(
    () => imageBlock ? '' : toolName === 'Read' && readSummary?.content ? readSummary.content : resultToString(result.content),
    [imageBlock, readSummary?.content, result.content, toolName],
  )
  const nonEmpty = useMemo(() => raw.split('\n').filter(l => l.trim()), [raw])
  const why = useMemo(
    () => explainToolResult(result, toolName, raw, Boolean(imageBlock), readSummary),
    [imageBlock, raw, readSummary, result, toolName],
  )
  const whyNode = <ToolResultWhyDisclosure why={why} />

  if (imageBlock) return <>{whyNode}<ImageResultSection block={imageBlock} /></>

  if (result.is_error) return <>{whyNode}<GenericResultSection raw={readSummary?.content ?? raw} isError /></>

  if (toolName === 'Read' && readSummary && readSummary.kind !== 'text') {
    const metadata = formatClaudeReadMetadata(readSummary).filter((entry) => entry !== 'token cap')
    return <>{whyNode}<GenericResultSection raw={readSummary.content} note={metadata.length > 0 ? `· ${metadata.join(' · ')}` : undefined} /></>
  }

  if (toolName === 'Read') return <>{whyNode}<ReadResultSection raw={readSummary?.content ?? raw} filePath={filePath} summary={readSummary ?? undefined} /></>

  if (nonEmpty.length === 1 && raw.length < 140) {
    return (
      <>
        {whyNode}
        <div style={{
          padding: '4px 12px',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11, color: 'var(--green)',
          background: 'rgba(45,212,160,0.05)',
          borderTop: '1px solid rgba(45,212,160,0.15)',
          letterSpacing: '0.03em',
        }}>
          ✓ {raw.trim()}
        </div>
      </>
    )
  }

  const persistedMatch = raw.match(/<persisted-output>[\s\S]*?Preview[^\n]*:\n([\s\S]*)/)
  if (persistedMatch) return <>{whyNode}<GenericResultSection raw={persistedMatch[1].trim()} note="· preview" /></>

  return <>{whyNode}<GenericResultSection raw={raw} /></>
}

// ── Block renderers ───────────────────────────────────────────────────────────

type InsightPart = { kind: 'insight'; content: string } | { kind: 'text'; text: string }
type TextMediaPart = { kind: 'text'; text: string } | { kind: 'data_image'; src: string; mediaType: string }

const STANDALONE_DATA_IMAGE_RE = /^(?:\[image\]\s*)?(data:(image\/[a-zA-Z0-9.+-]+);base64,[A-Za-z0-9+/=]+)\s*$/

function splitStandaloneDataImages(text: string): TextMediaPart[] {
  const parts: TextMediaPart[] = []
  const textLines: string[] = []

  for (const line of text.split('\n')) {
    const match = line.trim().match(STANDALONE_DATA_IMAGE_RE)
    if (!match) {
      textLines.push(line)
      continue
    }

    const textBeforeImage = textLines.join('\n').trimEnd()
    if (textBeforeImage) parts.push({ kind: 'text', text: textBeforeImage })
    textLines.length = 0
    parts.push({ kind: 'data_image', src: match[1], mediaType: match[2] })
  }

  const remainingText = textLines.join('\n').trimEnd()
  if (remainingText) parts.push({ kind: 'text', text: remainingText })
  return parts.length > 0 ? parts : [{ kind: 'text', text }]
}

function splitInsights(text: string): InsightPart[] {
  const matches = [...text.matchAll(/`★ Insight[^`]*`\n([\s\S]*?)\n`[─]+`/g)]
  if (matches.length === 0) return [{ kind: 'text', text }]

  const parts: InsightPart[] = []
  let lastIndex = 0
  for (const match of matches) {
    const before = text.slice(lastIndex, match.index)
    if (before.trim()) parts.push({ kind: 'text', text: before })
    parts.push({ kind: 'insight', content: match[1].trim() })
    lastIndex = (match.index ?? 0) + match[0].length
  }
  const after = text.slice(lastIndex)
  if (after.trim()) parts.push({ kind: 'text', text: after })
  return parts
}

function InsightCard({ content }: { content: string }) {
  return (
    <div style={{
      border: '1px solid var(--amber)',
      borderLeft: '3px solid var(--amber)',
      borderRadius: 6,
      overflow: 'hidden',
      margin: '8px 0',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 10px',
        background: 'var(--amber)14',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 13, color: 'var(--amber)' }}>★</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--amber)', fontWeight: 600, letterSpacing: '0.08em' }}>
          INSIGHT
        </span>
      </div>
      <div style={{ padding: '8px 14px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}

function DataImageBlock({ src, mediaType }: { src: string; mediaType: string }) {
  return (
    <div style={{ margin: '8px 0 12px' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        style={{ maxWidth: '100%', maxHeight: 480, display: 'block', borderRadius: 6, border: '1px solid var(--border)' }}
      />
      <div style={{ marginTop: 4, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
        {mediaType}
      </div>
    </div>
  )
}

function RenderMarkdownText({ text }: { text: string }) {
  const parts = useMemo(() => splitInsights(text), [text])
  if (parts.length === 1 && parts[0].kind === 'text') {
    return (
      <div style={{ fontSize: 15, wordBreak: 'break-word', lineHeight: 1.75 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {text}
        </ReactMarkdown>
      </div>
    )
  }
  return (
    <>
      {parts.map((part, i) =>
        part.kind === 'insight'
          ? <InsightCard key={i} content={part.content} />
          : (
            <div key={i} style={{ fontSize: 15, wordBreak: 'break-word', lineHeight: 1.75 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {part.text}
              </ReactMarkdown>
            </div>
          )
      )}
    </>
  )
}

function RenderText({ block }: { block: TextBlock }) {
  const parts = useMemo(() => splitStandaloneDataImages(block.text), [block.text])
  return (
    <>
      {parts.map((part, i) =>
        part.kind === 'data_image'
          ? <DataImageBlock key={i} src={part.src} mediaType={part.mediaType} />
          : <RenderMarkdownText key={i} text={part.text} />
      )}
    </>
  )
}

function RenderThinking({ block }: { block: ThinkingBlock }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const flat = useColorTreatment() === 'flat'
  const text      = block.thinking
  const firstLine = text.split('\n')[0].slice(0, 110)
  const teaser    = firstLine.length < text.length ? firstLine + '…' : firstLine
  const words     = text.split(/\s+/).length

  return (
    <div style={{
      border: '1px solid rgba(139,128,240,0.2)',
      borderLeft: '2px solid var(--violet)',
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 13,
    }}>
      <div
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '7px 12px',
          background: washBg(flat, hovered
            ? 'linear-gradient(to right, rgba(139,128,240,0.14), rgba(139,128,240,0.04))'
            : 'linear-gradient(to right, var(--violet-glow), transparent)'),
          cursor: 'pointer', userSelect: 'none',
          transition: 'background 0.15s ease',
        }}
      >
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: 'var(--violet)',
          fontWeight: 600,
          letterSpacing: '0.1em',
          flexShrink: 0,
          marginTop: 2,
          background: 'rgba(139,128,240,0.1)',
          border: '1px solid rgba(139,128,240,0.22)',
          borderRadius: 3,
          padding: '1px 5px',
        }}>
          THINK
        </span>
        {!open && (
          <span style={{
            fontFamily: "var(--render-font)",
            color: 'var(--text-2)',
            fontSize: 13,
            fontStyle: 'italic',
            flex: 1,
            lineHeight: 1.45,
          }}>
            {teaser}
          </span>
        )}
        {open && <span style={{ flex: 1 }} />}
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          color: 'var(--text-3)',
          fontSize: 11,
          flexShrink: 0,
          marginLeft: 'auto',
        }}>
          {words.toLocaleString()} words
        </span>
        <span style={{ color: 'var(--text-3)', fontSize: 11, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{
          padding: '12px 14px',
          background: washBg(flat, 'linear-gradient(180deg, rgba(139,128,240,0.04) 0%, var(--surface) 40px)'),
          borderTop: '1px solid rgba(139,128,240,0.15)',
          maxHeight: 420,
          overflowY: 'auto',
        }}>
          <p style={{
            fontFamily: "var(--render-font)",
            fontSize: 14,
            color: 'rgba(180,170,255,0.75)',
            lineHeight: 1.75,
            fontStyle: 'italic',
            whiteSpace: 'pre-wrap',
            margin: 0,
          }}>
            {text}
          </p>
        </div>
      )}
    </div>
  )
}

// ── System reminder card ──────────────────────────────────────────────────────

function SystemReminderCard({ block }: { block: SystemReminderBlock }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const c = 'var(--text-3)'

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `2px solid ${c}`,
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 13,
      marginTop: 4,
      opacity: 0.7,
    }}>
      <div
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px',
          background: hovered ? 'var(--surface-2)' : 'var(--surface)',
          cursor: 'pointer', userSelect: 'none', transition: 'background 0.12s ease',
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', fontWeight: 500, letterSpacing: '0.08em', flexShrink: 0 }}>
          SYSTEM
        </span>
        {!open && (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-3)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {block.content.split('\n')[0]}
          </span>
        )}
        {open && <span style={{ flex: 1 }} />}
        <span style={{ color: 'var(--text-3)', fontSize: 9 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <pre style={{
          margin: 0, padding: '8px 12px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 13, lineHeight: 1.6, color: 'var(--text-3)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 300, overflowY: 'auto',
        }}>
          {block.content}
        </pre>
      )}
    </div>
  )
}

// ── Task notification card ────────────────────────────────────────────────────

function TaskNotificationCard({ block }: { block: TaskNotificationBlock }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const c = 'var(--violet)'
  const flat = useColorTreatment() === 'flat'
  const { summary, result, usage, status } = block
  const hasResult = result.trim().length > 0

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `2px solid ${c}`,
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 13,
      marginTop: 4,
    }}>
      {/* Header */}
      <div
        onClick={() => hasResult && setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
          background: washBg(flat, `linear-gradient(to right, var(--violet)${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`),
          cursor: hasResult ? 'pointer' : 'default',
          userSelect: 'none', transition: 'background 0.15s ease',
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
          TASK
        </span>
        <span style={{ fontFamily: "var(--render-font)", color: 'var(--text)', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary}
        </span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--green)', flexShrink: 0 }}>
          {status}
        </span>
        {hasResult && <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>}
      </div>

      {/* Stats row */}
      {(usage.totalTokens != null || usage.toolUses != null || usage.durationMs != null) && (
        <div style={{ display: 'flex', gap: 16, padding: '3px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
          {usage.totalTokens != null && <span>⬡ {usage.totalTokens.toLocaleString()} tok</span>}
          {usage.toolUses    != null && <span>⚙ {usage.toolUses} tools</span>}
          {usage.durationMs  != null && <span>⏱ {(usage.durationMs / 1000).toFixed(1)}s</span>}
        </div>
      )}

      {/* Result body */}
      {open && hasResult && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: "'IBM Plex Mono', monospace", maxHeight: 400, overflowY: 'auto' }}>
          {result}
        </div>
      )}
    </div>
  )
}

// ── Slash command card ────────────────────────────────────────────────────────

function SlashCommandCard({ block }: { block: SlashCommandBlock }) {
  const c    = 'var(--cyan)'
  const flat = useColorTreatment() === 'flat'
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `2px solid ${c}`,
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 13,
      marginTop: 4,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 14px',
        background: washBg(flat, 'linear-gradient(to right, rgba(34,211,238,0.10), var(--surface))'),
      }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: c,
          fontWeight: 600,
          letterSpacing: '0.08em',
          flexShrink: 0,
          background: 'rgba(34,211,238,0.10)',
          border: '1px solid rgba(34,211,238,0.22)',
          borderRadius: 3,
          padding: '1px 6px',
        }}>
          CMD
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 13,
          color: c,
          fontWeight: 600,
          flexShrink: 0,
        }}>
          {block.command}
        </span>
        {block.args && (
          <span style={{
            fontFamily: "var(--render-font)",
            fontSize: 13,
            color: 'var(--text-2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {block.args}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Local command stdout card ─────────────────────────────────────────────────

function LocalCommandStdoutCard({ block }: { block: LocalCommandStdoutBlock }) {
  const c = 'var(--text-3)'
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `2px solid ${c}`,
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 13,
      marginTop: 4,
      opacity: 0.85,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 10px',
        background: 'var(--surface)',
      }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: 'var(--text-3)',
          fontWeight: 500,
          letterSpacing: '0.08em',
          flexShrink: 0,
        }}>
          STDOUT
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 13,
          color: 'var(--text-2)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {block.stdout}
        </span>
      </div>
    </div>
  )
}

// ── Bash-mode cards (input-box `!command` + its output) ──────────────────────

function BashInputCard({ block }: { block: BashInputBlock }) {
  const c = 'var(--t-bash, var(--green))'
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `2px solid ${c}`,
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 13,
      marginTop: 4,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 14px',
        background: 'var(--surface)',
      }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 13,
          color: c,
          fontWeight: 700,
          flexShrink: 0,
        }}>
          !
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 13,
          color: 'var(--text-1)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {block.command}
        </span>
      </div>
    </div>
  )
}

function BashOutputCard({ block }: { block: BashOutputBlock }) {
  const c = 'var(--text-3)'
  const hasStdout = block.stdout.length > 0
  const hasStderr = block.stderr.length > 0
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `2px solid ${c}`,
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 12.5,
      marginTop: 4,
      opacity: 0.9,
    }}>
      <div style={{ padding: '6px 12px', background: 'var(--surface)' }}>
        {!hasStdout && !hasStderr && (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-3)', fontStyle: 'italic' }}>
            (no output)
          </span>
        )}
        {hasStdout && (
          <pre style={{
            margin: 0,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12.5,
            color: 'var(--text-2)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 320,
            overflowY: 'auto',
          }}>
            {block.stdout}
          </pre>
        )}
        {hasStderr && (
          <pre style={{
            margin: hasStdout ? '6px 0 0' : 0,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12.5,
            color: 'var(--red, #f87171)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 320,
            overflowY: 'auto',
          }}>
            {block.stderr}
          </pre>
        )}
      </div>
    </div>
  )
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatClaudeTimestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const ms = value > 10_000_000_000 ? value : value * 1000
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function ClaudeSystemCard({ block }: { block: ClaudeSystemBlock }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const flat = useColorTreatment() === 'flat'
  const { subtype, payload } = block
  const content = typeof payload.content === 'string' ? payload.content : ''
  const stopReason = typeof payload.stop_reason === 'string' ? payload.stop_reason : ''
  const isRefusal = subtype === 'result' && stopReason === 'refusal'
  const additionalContext = typeof payload.additionalContext === 'string' && payload.additionalContext.trim()
    ? payload.additionalContext.trim()
    : payload.hookSpecificOutput
      && typeof payload.hookSpecificOutput === 'object'
      && typeof (payload.hookSpecificOutput as Record<string, unknown>).additionalContext === 'string'
    ? String((payload.hookSpecificOutput as Record<string, unknown>).additionalContext).trim()
    : ''
  const headerLabel = subtype.replace(/_/g, ' ').toUpperCase()
  const errorCode = typeof payload.error === 'string' ? payload.error : ''
  const apiErrorStatus = typeof payload.api_error_status === 'number' ? payload.api_error_status : null
  const errorSummary = useMemo(() => {
    if (!errorCode) return ''
    switch (errorCode) {
      case 'model_not_found': return 'Model not available — pick a different model'
      case 'authentication_failed': return 'Authentication failed'
      case 'oauth_org_not_allowed': return 'OAuth org not allowed'
      case 'billing_error': return 'Billing error'
      case 'rate_limit': return 'Rate limited'
      case 'invalid_request': return 'Invalid request'
      case 'server_error': return 'Server error'
      case 'max_output_tokens': return 'Max output tokens reached'
      default: return errorCode.replace(/_/g, ' ')
    }
  }, [errorCode])
  const runtimeCountText = useMemo(() => formatClaudeRuntimeCounts(payload).join(' · '), [payload])
  const runtimeDetailBody = useMemo(() => formatClaudeRuntimeDetailLines(payload).join('\n'), [payload])
  const detailPreview = useMemo(() => {
    const withRuntime = (value: string) => runtimeCountText ? `${value} · ${runtimeCountText}` : value
    if (errorSummary) return apiErrorStatus ? `${errorSummary} (HTTP ${apiErrorStatus})` : errorSummary
    if (subtype === 'model_refusal_fallback') {
      const from = typeof payload.original_model === 'string' ? payload.original_model : '?'
      const to = typeof payload.fallback_model === 'string' ? payload.fallback_model : '?'
      const category = typeof payload.api_refusal_category === 'string' ? payload.api_refusal_category : ''
      const verb = payload.direction === 'revert' ? 'Reverted' : 'Fell back'
      // scope 'local' (subagent/side-question/background fork) doesn't touch
      // the session model — say so, or "fell back" reads as a session-wide
      // swap that didn't happen. Absent on older CLIs; treat as session-wide.
      const scopeNote = payload.scope === 'local' ? ' (this response only)' : ''
      return withRuntime(`${verb} ${from} → ${to}${scopeNote}${category ? ` · refusal: ${category}` : ' · refusal'}`)
    }
    if (subtype === 'informational' && content.trim()) {
      const stopped = payload.prevent_continuation === true ? ' · stopped' : ''
      return withRuntime(`${content.replace(/\s+/g, ' ').trim()}${stopped}`)
    }
    if (content.trim()) return withRuntime(content.replace(/\s+/g, ' ').trim())
    if (subtype === 'compact_boundary') return withRuntime('Conversation compacted')
    if (subtype === 'task_started' && typeof payload.description === 'string') return withRuntime(payload.description)
    if (subtype === 'task_progress' && typeof payload.summary === 'string') return withRuntime(payload.summary)
    if (subtype === 'task_updated') {
      if (typeof payload.summary === 'string') return withRuntime(payload.summary)
      const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch as Record<string, unknown> : null
      if (typeof patch?.description === 'string') return withRuntime(patch.description)
      if (typeof patch?.status === 'string') return withRuntime(`Task ${patch.status}`)
    }
    if (subtype === 'task_notification' && typeof payload.summary === 'string') return withRuntime(payload.summary)
    if (subtype === 'tool_progress' && typeof payload.tool_name === 'string') {
      const retry = payload.subagent_retry && typeof payload.subagent_retry === 'object'
        ? payload.subagent_retry as Record<string, unknown>
        : null
      const retryText = retry && typeof retry.attempt === 'number' && typeof retry.max_retries === 'number'
        ? ` · retry ${retry.attempt}/${retry.max_retries}`
        : ''
      return withRuntime(`${payload.tool_name} · ${typeof payload.elapsed_time_seconds === 'number' ? `${payload.elapsed_time_seconds}s` : 'running'}${retryText}`)
    }
    if (subtype === 'tool_use_summary' && typeof payload.summary === 'string') return withRuntime(payload.summary)
    if (subtype === 'status' && typeof payload.status === 'string') return withRuntime(payload.status)
    if (subtype === 'hook_started') {
      const hookName = typeof payload.hook_name === 'string' ? payload.hook_name : 'hook'
      const event = typeof payload.hook_event === 'string' ? payload.hook_event : ''
      return withRuntime(event ? `${hookName} ▸ ${event}` : hookName)
    }
    if (subtype === 'hook_progress') {
      const hookName = typeof payload.hook_name === 'string' ? payload.hook_name : 'hook'
      const output = typeof payload.output === 'string' && payload.output ? payload.output
        : typeof payload.stdout === 'string' ? payload.stdout : ''
      return withRuntime(output ? `${hookName} · ${output.replace(/\s+/g, ' ').trim().slice(0, 120)}` : hookName)
    }
    if (subtype === 'hook_response') {
      const hookName = typeof payload.hook_name === 'string' ? payload.hook_name : 'hook'
      const outcome = typeof payload.outcome === 'string' ? payload.outcome : ''
      return withRuntime(outcome ? `${hookName} ${outcome}` : hookName)
    }
    if (subtype === 'memory_recall') {
      const memories = Array.isArray(payload.memories) ? payload.memories : []
      const mode = typeof payload.mode === 'string' ? payload.mode : ''
      const count = memories.length
      return withRuntime(`${count} memor${count === 1 ? 'y' : 'ies'}${mode ? ` · ${mode}` : ''}`)
    }
    if (subtype === 'rate_limit_event') {
      const info = payload.rate_limit_info && typeof payload.rate_limit_info === 'object'
        ? payload.rate_limit_info as Record<string, unknown>
        : null
      const status = typeof info?.status === 'string' ? info.status : 'updated'
      const utilization = typeof info?.utilization === 'number' ? ` · ${Math.round(info.utilization * 100)}%` : ''
      return `Rate limit ${status}${utilization}`
    }
    if (subtype === 'prompt_suggestion' && typeof payload.suggestion === 'string') return payload.suggestion
    if (subtype === 'auth_status') {
      if (typeof payload.error === 'string') return payload.error
      if (payload.isAuthenticating === true) return 'Authenticating'
      return 'Authentication status'
    }
    if (subtype === 'files_persisted') {
      const files = Array.isArray(payload.files) ? payload.files.length : 0
      const failed = Array.isArray(payload.failed) ? payload.failed.length : 0
      return `${files} file${files === 1 ? '' : 's'} persisted${failed ? ` · ${failed} failed` : ''}`
    }
    if (subtype === 'permission_denied') {
      const tool = typeof payload.tool_name === 'string' ? payload.tool_name : 'tool'
      const reason = typeof payload.decision_reason === 'string' ? payload.decision_reason : ''
      return reason ? `${tool} denied · ${reason}` : `${tool} denied`
    }
    if (subtype === 'notification' && typeof payload.text === 'string') return payload.text
    if (subtype === 'plugin_install') {
      const name = typeof payload.name === 'string' ? payload.name : 'plugin'
      const status = typeof payload.status === 'string' ? payload.status : 'updated'
      return `${name} ${status}`
    }
    if (subtype === 'elicitation_complete' && typeof payload.mcp_server_name === 'string') return `${payload.mcp_server_name} elicitation complete`
    if (subtype === 'mirror_error' && typeof payload.error === 'string') return payload.error
    if (subtype === 'api_retry') {
      const attempt = typeof payload.attempt === 'number' ? payload.attempt : undefined
      const max = typeof payload.max_retries === 'number' ? payload.max_retries : undefined
      const delayMs = typeof payload.retry_delay_ms === 'number' ? payload.retry_delay_ms : undefined
      const status = typeof payload.error_status === 'number' ? payload.error_status : null
      const parts: string[] = []
      if (attempt != null && max != null) parts.push(`attempt ${attempt}/${max}`)
      else if (attempt != null) parts.push(`attempt ${attempt}`)
      if (delayMs != null) parts.push(`retry in ${(delayMs / 1000).toFixed(1)}s`)
      if (status != null) parts.push(`HTTP ${status}`)
      // SDK 0.3.261: a first-byte timeout retries with error_status null, so
      // without this the card reads as a bare "attempt 1/1" with no cause.
      const noResponse = payload.no_response && typeof payload.no_response === 'object'
        ? payload.no_response as { waited_ms?: unknown }
        : null
      if (noResponse) {
        parts.push(typeof noResponse.waited_ms === 'number'
          ? `no response in ${(noResponse.waited_ms / 1000).toFixed(1)}s`
          : 'no response')
      }
      return parts.length > 0 ? parts.join(' · ') : 'API retry'
    }
    if (subtype === 'session_state_changed') {
      const state = typeof payload.state === 'string' ? payload.state : 'changed'
      return `Session ${state}`
    }
    if (subtype === 'local_command_output') {
      if (content) return content.replace(/\s+/g, ' ').trim()
      return 'Local command output'
    }
    if (subtype === 'result') {
      const resultSubtype = typeof payload.result_subtype === 'string' ? payload.result_subtype : null
      const durationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : null
      const turns = typeof payload.num_turns === 'number' ? payload.num_turns : null
      const errors = Array.isArray(payload.errors) ? payload.errors : []
      const head = isRefusal
        ? 'Run refused'
        : resultSubtype && resultSubtype !== 'success'
        ? resultSubtype.replace(/_/g, ' ')
        : 'Run completed'
      const parts: string[] = [head]
      if (turns != null) parts.push(`${turns} turn${turns === 1 ? '' : 's'}`)
      if (durationMs != null) parts.push(`${(durationMs / 1000).toFixed(1)}s`)
      if (errors.length > 0 && typeof errors[0] === 'string') parts.push(errors[0])
      return parts.join(' · ')
    }
    // Surface a useful string field on unknown subtypes instead of "Claude system event"
    for (const key of ['message', 'text', 'summary', 'description', 'error', 'content'] as const) {
      const value = payload[key]
      if (typeof value === 'string' && value.trim()) {
        return withRuntime(value.replace(/\s+/g, ' ').trim())
      }
    }
    return withRuntime('Claude system event')
  }, [apiErrorStatus, content, errorSummary, isRefusal, payload, runtimeCountText, subtype])
  const hookOutcome = typeof payload.outcome === 'string' ? payload.outcome : ''
  const isHardError = errorCode === 'model_not_found'
    || errorCode === 'authentication_failed'
    || errorCode === 'oauth_org_not_allowed'
    || errorCode === 'billing_error'
  const tone = isHardError
    ? 'var(--red)'
    : payload.level === 'warning'
    ? 'var(--yellow)'
    : subtype === 'hook_response' && (hookOutcome === 'error' || hookOutcome === 'cancelled')
    ? 'var(--yellow)'
    : subtype === 'compact_boundary'
    ? 'var(--violet)'
    : subtype.startsWith('task_')
    ? 'var(--violet)'
    : subtype.startsWith('hook_')
    ? 'var(--cyan)'
    : subtype === 'tool_progress' || subtype === 'tool_use_summary'
    ? 'var(--cyan)'
    : subtype === 'memory_recall'
    ? 'var(--cyan)'
    : subtype === 'rate_limit_event'
    ? 'var(--yellow)'
    : subtype === 'permission_denied'
    ? 'var(--red)'
    : subtype === 'prompt_suggestion'
    ? 'var(--green)'
    : subtype === 'api_retry'
    ? 'var(--yellow)'
    : subtype === 'session_state_changed'
    ? 'var(--violet)'
    : subtype === 'model_refusal_fallback'
    ? 'var(--yellow)'
    // A refusal with no fallback ends the turn — red, not the fallback's yellow.
    : subtype === 'model_refusal_no_fallback'
    ? 'var(--red)'
    : subtype === 'worker_shutting_down'
    ? 'var(--yellow)'
    : subtype === 'conversation_reset'
    ? 'var(--violet)'
    : subtype === 'informational'
    ? (payload.level === 'suggestion' ? 'var(--green)' : payload.level === 'notice' ? 'var(--text-3)' : 'var(--cyan)')
    : subtype === 'local_command_output'
    ? 'var(--cyan)'
    : subtype === 'result'
    ? (isRefusal || (typeof payload.result_subtype === 'string' && payload.result_subtype !== 'success') ? 'var(--red)' : 'var(--green)')
    : 'var(--text-3)'
  const badges = useMemo(() => {
    const nextBadges: string[] = []
    if (errorCode) nextBadges.push(errorCode)
    if (apiErrorStatus != null) nextBadges.push(`HTTP ${apiErrorStatus}`)
    if (typeof payload.status === 'string') nextBadges.push(payload.status)
    if (typeof payload.task_id === 'string') nextBadges.push(payload.task_id.slice(0, 8))
    if (subtype === 'model_refusal_no_fallback' && typeof payload.api_refusal_category === 'string') {
      nextBadges.push(payload.api_refusal_category)
    }
    if (subtype === 'conversation_reset' && typeof payload.new_conversation_id === 'string') {
      nextBadges.push(payload.new_conversation_id.slice(0, 8))
    }
    if (typeof payload.tool_use_id === 'string') nextBadges.push(payload.tool_use_id.slice(0, 8))
    if (typeof payload.tool_name === 'string') nextBadges.push(payload.tool_name)
    if (typeof payload.hook_name === 'string') nextBadges.push(payload.hook_name)
    if (typeof payload.hook_event === 'string') nextBadges.push(payload.hook_event)
    if (typeof payload.outcome === 'string') nextBadges.push(payload.outcome)
    if (stopReason) nextBadges.push(`stop ${stopReason}`)
    if (typeof payload.mcp_server_name === 'string') nextBadges.push(payload.mcp_server_name)
    if (typeof payload.subagent_type === 'string') nextBadges.push(payload.subagent_type)
    if (payload.subagent_retry && typeof payload.subagent_retry === 'object') {
      const retry = payload.subagent_retry as Record<string, unknown>
      if (typeof retry.attempt === 'number' && typeof retry.max_retries === 'number') nextBadges.push(`retry ${retry.attempt}/${retry.max_retries}`)
      if (typeof retry.error_status === 'number') nextBadges.push(`HTTP ${retry.error_status}`)
      if (typeof retry.error_category === 'string') nextBadges.push(retry.error_category)
    }
    if (typeof payload.task_type === 'string' && payload.task_type !== payload.subagent_type) nextBadges.push(payload.task_type)
    if (subtype === 'rate_limit_event' && payload.rate_limit_info && typeof payload.rate_limit_info === 'object') {
      const info = payload.rate_limit_info as Record<string, unknown>
      if (typeof info.rateLimitType === 'string') nextBadges.push(info.rateLimitType)
      if (typeof info.overageStatus === 'string') nextBadges.push(`overage ${info.overageStatus}`)
      if (info.isUsingOverage === true) nextBadges.push('using overage')
    }
    if (subtype === 'notification' && typeof payload.priority === 'string') nextBadges.push(payload.priority)
    if (subtype === 'plugin_install' && typeof payload.name === 'string') nextBadges.push(payload.name)
    if (subtype === 'model_refusal_fallback') {
      if (typeof payload.original_model === 'string') nextBadges.push(payload.original_model)
      if (typeof payload.fallback_model === 'string') nextBadges.push(`→ ${payload.fallback_model}`)
      if (typeof payload.api_refusal_category === 'string') nextBadges.push(payload.api_refusal_category)
      if (typeof payload.direction === 'string') nextBadges.push(payload.direction)
      if (payload.scope === 'local') nextBadges.push('local')
    }
    if (subtype === 'informational') {
      if (typeof payload.level === 'string' && payload.level !== 'info') nextBadges.push(payload.level)
      if (payload.prevent_continuation === true) nextBadges.push('stopped')
    }
    nextBadges.push(...formatClaudeRuntimeCounts(payload))
    if (subtype === 'memory_recall' && typeof payload.mode === 'string') nextBadges.push(payload.mode)
    if (subtype === 'compact_boundary' && payload.compact_metadata && typeof payload.compact_metadata === 'object') {
      const compact = payload.compact_metadata as { trigger?: unknown; pre_tokens?: unknown }
      if (typeof compact.trigger === 'string') nextBadges.push(compact.trigger)
      if (typeof compact.pre_tokens === 'number') nextBadges.push(`${fmtTokens(compact.pre_tokens)} pre`)
    }
    return [...new Set(nextBadges)]
  }, [apiErrorStatus, errorCode, payload, stopReason, subtype])

  const body = useMemo(() => {
    let main = ''
    if (subtype === 'task_notification') {
      main = content || (typeof payload.result === 'string' ? payload.result : '')
    }
    else if (subtype === 'task_progress') {
      main = [content, typeof payload.last_tool_name === 'string' ? `Last tool: ${payload.last_tool_name}` : ''].filter(Boolean).join('\n')
    }
    else if (subtype === 'task_updated') {
      const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch as Record<string, unknown> : null
      const lines = [
        content,
        typeof patch?.description === 'string' ? `Description: ${patch.description}` : '',
        typeof patch?.status === 'string' ? `Status: ${patch.status}` : '',
        typeof patch?.error === 'string' ? `Error: ${patch.error}` : '',
        typeof patch?.total_paused_ms === 'number' ? `Paused: ${(patch.total_paused_ms / 1000).toFixed(1)}s` : '',
      ].filter(Boolean)
      main = lines.join('\n')
    }
    else if (subtype === 'hook_started' || subtype === 'hook_progress' || subtype === 'hook_response') {
      main = [
        content,
        typeof payload.output === 'string' ? payload.output : '',
        typeof payload.stdout === 'string' ? payload.stdout : '',
        typeof payload.stderr === 'string' ? payload.stderr : '',
        additionalContext ? `Additional context:\n${additionalContext}` : '',
      ].filter(Boolean).join('\n\n')
    }
    else if (subtype === 'memory_recall') {
      const memories = Array.isArray(payload.memories) ? payload.memories as Array<Record<string, unknown>> : []
      const lines = memories.map((m) => {
        const scope = typeof m.scope === 'string' ? m.scope : ''
        const path = typeof m.path === 'string' ? m.path : ''
        const memContent = typeof m.content === 'string' ? m.content : ''
        const header = scope ? `[${scope}] ${path}` : path
        return memContent ? `${header}\n${memContent}` : header
      })
      main = lines.join('\n\n')
    }
    else if (subtype === 'rate_limit_event') {
      const info = payload.rate_limit_info && typeof payload.rate_limit_info === 'object'
        ? payload.rate_limit_info as Record<string, unknown>
        : null
      const lines = [
        typeof info?.status === 'string' ? `Status: ${info.status}` : '',
        typeof info?.rateLimitType === 'string' ? `Limit: ${info.rateLimitType}` : '',
        typeof info?.utilization === 'number' ? `Utilization: ${Math.round(info.utilization * 100)}%` : '',
        formatClaudeTimestamp(info?.resetsAt) ? `Resets: ${formatClaudeTimestamp(info?.resetsAt)}` : '',
        typeof info?.overageStatus === 'string' ? `Overage: ${info.overageStatus}` : '',
        formatClaudeTimestamp(info?.overageResetsAt) ? `Overage resets: ${formatClaudeTimestamp(info?.overageResetsAt)}` : '',
        typeof info?.overageDisabledReason === 'string' ? `Overage disabled: ${info.overageDisabledReason}` : '',
      ].filter(Boolean)
      main = lines.join('\n')
    }
    else if (subtype === 'auth_status') {
      const output = Array.isArray(payload.output)
        ? payload.output.filter((entry): entry is string => typeof entry === 'string').join('\n')
        : ''
      main = [content, output, typeof payload.error === 'string' ? payload.error : ''].filter(Boolean).join('\n')
    }
    else if (subtype === 'files_persisted') {
      const files = Array.isArray(payload.files) ? payload.files as Array<Record<string, unknown>> : []
      const failed = Array.isArray(payload.failed) ? payload.failed as Array<Record<string, unknown>> : []
      main = [
        ...files.map((file) => {
          const name = typeof file.filename === 'string' ? file.filename : 'file'
          const id = typeof file.file_id === 'string' ? file.file_id : ''
          return id ? `${name} (${id})` : name
        }),
        ...failed.map((file) => {
          const name = typeof file.filename === 'string' ? file.filename : 'file'
          const err = typeof file.error === 'string' ? file.error : 'failed'
          return `${name}: ${err}`
        }),
      ].join('\n')
    }
    else if (subtype === 'permission_denied') {
      main = [
        content,
        typeof payload.message === 'string' ? payload.message : '',
        typeof payload.decision_reason === 'string' ? `Reason: ${payload.decision_reason}` : '',
      ].filter(Boolean).join('\n')
    }
    else if (subtype === 'plugin_install') {
      main = [content, typeof payload.error === 'string' ? payload.error : ''].filter(Boolean).join('\n')
    }
    else if (subtype === 'api_retry') {
      const err = payload.error && typeof payload.error === 'object' ? payload.error as Record<string, unknown> : null
      const noResponse = payload.no_response && typeof payload.no_response === 'object'
        ? payload.no_response as { waited_ms?: unknown; retry_wait_ms?: unknown }
        : null
      const lines = [
        typeof payload.attempt === 'number' && typeof payload.max_retries === 'number'
          ? `Attempt ${payload.attempt} of ${payload.max_retries}`
          : '',
        typeof payload.retry_delay_ms === 'number' ? `Retry delay: ${(payload.retry_delay_ms / 1000).toFixed(1)}s` : '',
        typeof payload.error_status === 'number' ? `HTTP ${payload.error_status}` : '',
        typeof noResponse?.waited_ms === 'number'
          ? `No response headers after ${(noResponse.waited_ms / 1000).toFixed(1)}s`
            + (typeof noResponse.retry_wait_ms === 'number'
              ? ` · retry waits ${(noResponse.retry_wait_ms / 1000).toFixed(1)}s`
              : '')
          : '',
        typeof err?.message === 'string' ? err.message : '',
      ].filter(Boolean)
      main = lines.join('\n')
    }
    else if (subtype === 'session_state_changed') {
      main = typeof payload.state === 'string' ? `state: ${payload.state}` : ''
    }
    else if (subtype === 'local_command_output') {
      main = content
    }
    else if (subtype === 'result') {
      const errors = Array.isArray(payload.errors) ? payload.errors.filter((e): e is string => typeof e === 'string') : []
      const lines = [
        isRefusal ? 'Outcome: refused' : typeof payload.result_subtype === 'string' ? `Outcome: ${payload.result_subtype}` : '',
        typeof payload.num_turns === 'number' ? `Turns: ${payload.num_turns}` : '',
        typeof payload.duration_ms === 'number' ? `Duration: ${(payload.duration_ms / 1000).toFixed(1)}s` : '',
        typeof payload.duration_api_ms === 'number' ? `API time: ${(payload.duration_api_ms / 1000).toFixed(1)}s` : '',
        typeof payload.total_cost_usd === 'number' ? `Cost: $${payload.total_cost_usd.toFixed(4)}` : '',
        stopReason ? `Stop: ${stopReason}` : '',
        ...errors,
      ].filter(Boolean)
      main = lines.join('\n')
    } else {
      main = content
    }
    return [main, runtimeDetailBody].filter(Boolean).join('\n\n')
  }, [additionalContext, content, isRefusal, payload, runtimeDetailBody, stopReason, subtype])
  const payloadJson = useMemo(() => safeJson(payload), [payload])

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `2px solid ${tone}`,
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 13,
      marginTop: 4,
      opacity: 0.92,
    }}>
      <div
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: washBg(flat, hovered
            ? `linear-gradient(to right, ${tone}22, var(--surface))`
            : `linear-gradient(to right, ${tone}14, var(--surface))`),
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'background 0.12s ease',
        }}
      >
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: tone,
          fontWeight: 600,
          letterSpacing: '0.08em',
          flexShrink: 0,
        }}>
          SYSTEM
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: tone,
          fontWeight: 500,
          letterSpacing: '0.04em',
          flexShrink: 0,
        }}>
          {headerLabel}
        </span>
        <span style={{
          fontFamily: "var(--render-font)",
          fontSize: 13,
          color: 'var(--text)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {detailPreview}
        </span>
        {badges.map((badge) => (
          <span
            key={badge}
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: tone,
              background: 'var(--surface-2)',
              border: `1px solid ${tone}33`,
              borderRadius: 999,
              padding: '1px 7px',
              flexShrink: 0,
            }}
          >
            {badge}
          </span>
        ))}
        <span style={{ color: 'var(--text-3)', fontSize: 11, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
          padding: '10px 12px',
          display: 'grid',
          gap: 10,
        }}>
          {body && (
            <pre style={{
              margin: 0,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--text-2)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 260,
              overflowY: 'auto',
            }}>
              {body}
            </pre>
          )}
          <pre style={{
            margin: 0,
            padding: '10px 12px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            lineHeight: 1.55,
            color: 'var(--text-3)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 260,
            overflowY: 'auto',
          }}>
            {payloadJson}
          </pre>
        </div>
      )}
    </div>
  )
}

function renderBlock(block: ThreadedBlock, i: number): React.ReactNode {
  if (block.type === 'tool_thread')           return <ToolThreadCard          key={i} thread={block} />
  if (block.type === 'text')                  return <RenderText              key={i} block={block} />
  if (block.type === 'thinking')              return <RenderThinking          key={i} block={block} />
  if (block.type === 'image')                 return <ImageResultSection      key={i} block={block as ImageBlock} />
  if (block.type === 'task_notification')     return <TaskNotificationCard    key={i} block={block as TaskNotificationBlock} />
  if (block.type === 'system_reminder')       return <SystemReminderCard      key={i} block={block as SystemReminderBlock} />
  if (block.type === 'claude_system')         return <ClaudeSystemCard        key={i} block={block as ClaudeSystemBlock} />
  if (block.type === 'slash_command')         return <SlashCommandCard        key={i} block={block as SlashCommandBlock} />
  if (block.type === 'local_command_stdout')  return <LocalCommandStdoutCard  key={i} block={block as LocalCommandStdoutBlock} />
  if (block.type === 'bash_input')            return <BashInputCard           key={i} block={block as BashInputBlock} />
  if (block.type === 'bash_output')           return <BashOutputCard          key={i} block={block as BashOutputBlock} />
  return null
}

// ── Token usage formatting ────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function toolInputRecord(thread: ToolThread): Record<string, unknown> {
  return thread.toolUse.input && typeof thread.toolUse.input === 'object' && !Array.isArray(thread.toolUse.input)
    ? thread.toolUse.input
    : {}
}

function toolStringParam(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function toolNumberParam(input: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function agentsCompactOneLine(value: string, max = 120): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function agentsFormatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

type AgentsFileChange = {
  path?: string
  kind?: unknown
  diff?: string
}

function agentsFileChanges(input: Record<string, unknown>): AgentsFileChange[] {
  const changes = input.changes
  if (!Array.isArray(changes)) return []
  return changes.flatMap((change): AgentsFileChange[] => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) return []
    const record = change as Record<string, unknown>
    return [{
      path: typeof record.path === 'string' && record.path.trim() ? record.path.trim() : undefined,
      kind: record.kind,
      diff: typeof record.diff === 'string' ? record.diff : undefined,
    }]
  })
}

function agentsCompactPathTail(value: string | null | undefined, segmentCount: number): string {
  const cleaned = value?.trim().replace(/\\/g, '/') ?? ''
  if (!cleaned) return ''
  const parts = cleaned.split('/').filter(Boolean)
  if (parts.length <= segmentCount) return parts.join('/') || cleaned
  return parts.slice(-segmentCount).join('/')
}

function summarizeAgentsFileChangeKind(kind: unknown): string {
  if (typeof kind === 'string' && kind.trim()) return kind.trim()
  if (kind && typeof kind === 'object' && !Array.isArray(kind)) {
    const record = kind as Record<string, unknown>
    if (typeof record.type === 'string' && record.type.trim()) return record.type.trim()
    if (typeof record.kind === 'string' && record.kind.trim()) return record.kind.trim()
  }
  return ''
}

function agentsFirstDiffHunkLabel(diffText: string | null | undefined): string {
  if (!diffText) return ''
  const hunk = diffText.split('\n').find((line) => line.startsWith('@@ '))
  const match = hunk?.match(/\+(\d+)/)
  return match?.[1] ? `@${match[1]}` : ''
}

function agentsDiffStats(diffText: string | null | undefined): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  if (!diffText) return { additions, deletions }
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions += 1
    else if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}

function agentsFileChangeStatsLabel(changes: AgentsFileChange[]): string {
  let additions = 0
  let deletions = 0
  for (const change of changes) {
    const stats = agentsDiffStats(change.diff)
    additions += stats.additions
    deletions += stats.deletions
  }
  return additions > 0 || deletions > 0 ? `+${additions} -${deletions}` : ''
}

function summarizeAgentsFileChange(input: Record<string, unknown>): string {
  const changes = agentsFileChanges(input)
  if (changes.length === 0) return toolStringParam(input, ['status']) ?? 'file change'

  const first = changes[0]
  const pathLabel = agentsCompactPathTail(first.path, 2) || basename(first.path ?? '') || 'file change'
  const kind = summarizeAgentsFileChangeKind(first.kind)
  const hunk = agentsFirstDiffHunkLabel(first.diff)
  const parts = [pathLabel]
  if (changes.length > 1) parts.push(`+${changes.length - 1} more`)
  if (kind) parts.push(kind)
  if (hunk) parts.push(hunk)
  return parts.join(' · ')
}

function agentsOutputText(thread: ToolThread): string {
  return thread.result ? resultToString(thread.result.content).trim() : ''
}

function agentsResultLineCount(raw: string): number {
  if (!raw) return 0
  return raw.split('\n').filter((line) => line.trim().length > 0).length
}

function agentsBashResultMeta(raw: string): { outputLineCount: number; exitCode: number | null; durationMs: number | null } {
  let exitCode: number | null = null
  let durationMs: number | null = null
  let outputLineCount = 0
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const exitMatch = trimmed.match(/^exit_code:\s*(-?\d+)$/i)
    if (exitMatch?.[1]) {
      exitCode = Number(exitMatch[1])
      continue
    }
    const parenExitMatch = trimmed.match(/\(exit\s+(-?\d+)\)$/i)
    if (parenExitMatch?.[1]) {
      exitCode = Number(parenExitMatch[1])
      const withoutExit = trimmed.replace(/\s*\(exit\s+-?\d+\)$/i, '').trim()
      if (withoutExit && !withoutExit.startsWith('$ ')) outputLineCount += 1
      continue
    }
    const durationMatch = trimmed.match(/^duration_ms:\s*([0-9.]+)$/i)
    if (durationMatch?.[1]) {
      durationMs = Number(durationMatch[1])
      continue
    }
    if (trimmed.startsWith('$ ')) continue
    outputLineCount += 1
  }
  return { outputLineCount, exitCode, durationMs }
}

function agentsTodoCounts(input: Record<string, unknown>): { completed: number; active: number; pending: number; total: number } {
  const todos = Array.isArray(input.todos) ? input.todos : []
  const counts = { completed: 0, active: 0, pending: 0, total: 0 }
  for (const todo of todos) {
    if (!todo || typeof todo !== 'object' || Array.isArray(todo)) continue
    counts.total += 1
    const status = (todo as Record<string, unknown>).status
    if (status === 'completed') counts.completed += 1
    else if (status === 'in_progress') counts.active += 1
    else counts.pending += 1
  }
  return counts
}

function agentsEditStats(input: Record<string, unknown>): { additions: number; deletions: number } | null {
  if (Array.isArray(input.edits)) {
    let additions = 0
    let deletions = 0
    for (const edit of input.edits) {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit)) continue
      const record = edit as Record<string, unknown>
      const oldText = typeof record.oldText === 'string' ? record.oldText : typeof record.old_string === 'string' ? record.old_string : ''
      const newText = typeof record.newText === 'string' ? record.newText : typeof record.new_string === 'string' ? record.new_string : ''
      if (oldText) deletions += lineCount(oldText)
      if (newText) additions += lineCount(newText)
    }
    return additions > 0 || deletions > 0 ? { additions, deletions } : null
  }
  const oldText = toolStringParam(input, ['oldText', 'old_string'])
  const newText = toolStringParam(input, ['newText', 'new_string'])
  if (!oldText && !newText) return null
  return {
    additions: newText ? lineCount(newText) : 0,
    deletions: oldText ? lineCount(oldText) : 0,
  }
}

function summarizeAgentsTool(thread: ToolThread): string {
  const originalName = thread.toolUse.name
  const name = canonicalToolName(originalName)
  const input = toolInputRecord(thread)
  if (name === 'Bash') {
    const command = toolStringParam(input, ['command', 'cmd'])
    return command ? `$ ${agentsCompactOneLine(command, 150)}` : 'shell command'
  }
  if (name === 'Read') {
    const filePath = toolStringParam(input, ['file_path', 'path'])
    const range = [
      toolNumberParam(input, ['offset']) != null ? `@${toolNumberParam(input, ['offset'])}` : null,
      toolNumberParam(input, ['limit']) != null ? `+${toolNumberParam(input, ['limit'])}` : null,
      toolStringParam(input, ['pages']) ? `pages ${toolStringParam(input, ['pages'])}` : null,
    ].filter(Boolean).join(' ')
    return [filePath ?? 'read file', range].filter(Boolean).join(' · ')
  }
  if (name === 'FileChange') return summarizeAgentsFileChange(input)
  if (name === 'Edit' || name === 'MultiEdit' || name === 'Write') {
    const path = toolStringParam(input, ['file_path', 'path'])
    const stats = name === 'Write'
      ? (toolStringParam(input, ['content']) ? { additions: lineCount(toolStringParam(input, ['content']) ?? ''), deletions: 0 } : null)
      : agentsEditStats(input)
    const editSize = stats ? ` (-${stats.deletions} +${stats.additions})` : ''
    return `${path ?? 'file change'}${editSize}`
  }
  if (name === 'Grep') {
    const pattern = toolStringParam(input, ['pattern', 'query'])
    const path = toolStringParam(input, ['path', 'include', 'glob'])
    const mode = toolStringParam(input, ['output_mode'])
    const label = pattern ? `/${agentsCompactOneLine(pattern, 80)}/` : 'search'
    return [label, path ? `in ${path}` : null, mode].filter(Boolean).join(' · ')
  }
  if (name === 'Glob') {
    const pattern = toolStringParam(input, ['pattern']) ?? 'glob'
    const path = toolStringParam(input, ['path'])
    return [pattern, path ? `in ${path}` : null].filter(Boolean).join(' · ')
  }
  if (name === 'TodoWrite') {
    const counts = agentsTodoCounts(input)
    return counts.total > 0 ? `${counts.total} todos` : 'todo update'
  }
  if (name === 'WebSearch') return toolStringParam(input, ['query']) ?? 'web search'
  if (name === 'WebFetch') return toolStringParam(input, ['url', 'uri']) ?? 'web fetch'
  if (name === 'ToolSearch') return toolStringParam(input, ['query']) ?? 'tool search'
  if (originalName === 'AgentSwitch') return toolStringParam(input, ['name']) ?? 'agent switch'
  if (isMcpToolName(originalName)) {
    const server = toolStringParam(input, ['server'])
    const summary = Object.keys(input).slice(0, 2).join(', ')
    return [server, summary].filter(Boolean).join(' · ') || 'mcp tool'
  }
  if (name === 'Agent' || name === 'task' || name.startsWith('Task')) {
    return toolStringParam(input, ['description', 'prompt', 'task', 'subject']) ?? 'agent task'
  }
  try {
    return JSON.stringify(input)
  } catch {
    return originalName
  }
}

function streamToolOutputSummary(thread: ToolThread): string | null {
  const name = canonicalToolName(thread.toolUse.name)
  const raw = agentsOutputText(thread)
  if (!raw) return null
  for (const line of raw.split('\n')) {
    const text = line.trim()
    if (!text || text === 'No visible content') continue
    if (/^[└├│─\s]+$/.test(text) || /^[✓✔]️?\s*(?:OK|done)?$/i.test(text)) continue
    if (/^(?:exit_code|duration_ms):/i.test(text)) continue
    if (name === 'Bash' && text.startsWith('$ ')) continue
    return agentsCompactOneLine(text, 180)
  }
  return null
}

function formatAgentsCount(value: number, unit: string): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k ${unit}`
  return `${value} ${unit}`
}

function lineCount(value: string): number {
  if (!value) return 0
  return value.split('\n').length
}

function agentsToolMetaBadges(thread: ToolThread): string[] {
  const originalName = thread.toolUse.name
  const name = canonicalToolName(originalName)
  const input = toolInputRecord(thread)
  const badges: string[] = []
  const status = toolStringParam(input, ['status'])
  if (name === 'FileChange') {
    const changes = agentsFileChanges(input)
    if (changes.length > 0) {
      badges.push(`${changes.length} file${changes.length === 1 ? '' : 's'}`)
      const stats = agentsFileChangeStatsLabel(changes)
      if (stats) badges.push(stats)
    }
    if (!thread.result) badges.push('running')
    else if (thread.result.is_error) badges.push('error')
    else if (badges.length === 0) badges.push(status ?? 'ok')
    return badges.slice(0, 3)
  }

  if (name === 'TodoWrite') {
    const counts = agentsTodoCounts(input)
    if (counts.active > 0) badges.push(`${counts.active} active`)
    if (counts.pending > 0) badges.push(`${counts.pending} pending`)
    if (counts.completed > 0) badges.push(`${counts.completed} done`)
    if (!thread.result) badges.push('running')
    else if (thread.result.is_error) badges.push('error')
    else if (badges.length === 0) badges.push('ok')
    return badges.slice(0, 3)
  }

  const oldText = toolStringParam(input, ['old_string'])
  const newText = toolStringParam(input, ['new_string'])
  const content = toolStringParam(input, ['content'])
  const editStats = name === 'Edit' || name === 'MultiEdit' ? agentsEditStats(input) : null

  if (editStats) {
    badges.push(`+${editStats.additions} -${editStats.deletions}`)
  } else if (oldText || newText) {
    const del = oldText ? lineCount(oldText) : 0
    const add = newText ? lineCount(newText) : 0
    badges.push(`+${add} -${del}`)
  } else if (content && (name === 'Write' || name === 'FileChange')) {
    badges.push(formatAgentsCount(lineCount(content), 'lines'))
  }

  if (!thread.result) {
    badges.push('running')
    return badges
  }

  const output = agentsOutputText(thread)

  if (name === 'Bash') {
    const meta = agentsBashResultMeta(output)
    if (thread.result.is_error) badges.push('error')
    if (status && !/^(completed|success|succeeded)$/i.test(status)) badges.push(status)
    if (meta.exitCode != null && (meta.exitCode !== 0 || thread.result.is_error)) badges.push(`exit ${meta.exitCode}`)
    if (meta.durationMs != null) badges.push(agentsFormatDuration(meta.durationMs))
    if (meta.outputLineCount > 0) badges.push(formatAgentsCount(meta.outputLineCount, 'lines'))
    if (badges.length === 0) badges.push('ok')
    return badges.slice(0, 3)
  }

  if (thread.result.is_error) {
    badges.push('error')
    return badges
  }

  if (name === 'Read') {
    const filePath = toolStringParam(input, ['file_path', 'path']) ?? ''
    const summary = extractClaudeReadFileSummary(thread.result, filePath)
    const range = summary ? formatClaudeReadRange(summary) : null
    const kind = summary ? formatClaudeReadKind(summary) : null
    if (range) badges.push(range)
    if (kind) badges.push(kind)
    if (summary?.truncatedByTokenCap) badges.push('partial')
    if (badges.length === 0) badges.push('ok')
    return badges.slice(0, 3)
  }

  if (name === 'Grep') {
    const count = agentsResultLineCount(output)
    const mode = toolStringParam(input, ['output_mode'])
    badges.push(mode === 'content' || mode === 'count' ? `${count} lines` : `${count} file${count === 1 ? '' : 's'}`)
    return badges.slice(0, 2)
  }

  if (name === 'Glob') {
    const count = agentsResultLineCount(output)
    badges.push(`${count} file${count === 1 ? '' : 's'}`)
    return badges.slice(0, 2)
  }

  if (originalName === 'AgentSwitch') {
    badges.push(status ?? 'done')
    return badges.slice(0, 2)
  }

  if (name === 'WebSearch' || name === 'WebFetch' || name === 'ToolSearch' || isMcpToolName(originalName)) {
    if (status && !/^(completed|success|succeeded)$/i.test(status)) badges.push(status)
    const lines = agentsResultLineCount(output)
    if (lines > 1) badges.push(formatAgentsCount(lines, 'lines'))
    else if (output) badges.push(`${output.length.toLocaleString()} chars`)
    if (badges.length === 0) badges.push('ok')
    return badges.slice(0, 2)
  }

  if (!output) {
    badges.push('ok')
    return badges
  }

  const lines = lineCount(output)
  if (lines > 1) badges.push(formatAgentsCount(lines, 'lines'))
  else badges.push(`${output.length.toLocaleString()} chars`)
  return badges.slice(0, 2)
}

function normalizeToolThreadForNativeCard(thread: ToolThread): ToolThread {
  const originalName = thread.toolUse.name
  const canonicalName = canonicalToolName(originalName)
  const input = toolInputRecord(thread)
  const withInput = (name: string, nextInput: Record<string, unknown>): ToolThread => ({
    ...thread,
    toolUse: {
      ...thread.toolUse,
      name,
      input: nextInput,
    },
  })

  if (canonicalName === 'Write' && typeof input.path === 'string' && typeof input.file_path !== 'string') {
    return withInput('Write', { ...input, file_path: input.path })
  }

  if ((canonicalName === 'Edit' || canonicalName === 'MultiEdit') && typeof input.path === 'string' && Array.isArray(input.edits)) {
    const edits = input.edits.flatMap((edit): Array<{ old_string?: string; new_string?: string; replace_all?: boolean }> => {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return []
      const record = edit as Record<string, unknown>
      const oldText = typeof record.oldText === 'string' ? record.oldText : typeof record.old_string === 'string' ? record.old_string : undefined
      const newText = typeof record.newText === 'string' ? record.newText : typeof record.new_string === 'string' ? record.new_string : undefined
      const replaceAll = typeof record.replace_all === 'boolean' ? record.replace_all : undefined
      return [{ old_string: oldText, new_string: newText, replace_all: replaceAll }]
    })
    return withInput('MultiEdit', { ...input, file_path: input.path, edits })
  }

  if (canonicalName === 'Edit' && typeof input.path === 'string' && typeof input.file_path !== 'string') {
    const oldText = toolStringParam(input, ['oldText', 'old_string'])
    const newText = toolStringParam(input, ['newText', 'new_string'])
    if (oldText != null || newText != null) {
      return withInput('Edit', { ...input, file_path: input.path, old_string: oldText ?? '', new_string: newText ?? '' })
    }
  }

  if (canonicalName === 'Read' && typeof input.path === 'string' && typeof input.file_path !== 'string') {
    return withInput('Read', { ...input, file_path: input.path })
  }

  if (canonicalName !== originalName) {
    return withInput(canonicalName, input)
  }

  return thread
}

function agentsDensitySpacing(dc: DensityConfig) {
  const isDense = dc.msgGap <= 12
  const isComfortable = dc.msgGap >= 52
  return {
    cardMargin: Math.max(8, Math.round(dc.msgGap * 0.35)),
    cardPaddingY: Math.max(7, Math.round(dc.labelGap + dc.blockGap * 0.25)),
    cardPaddingX: Math.max(12, dc.dotGap),
    toolCardPaddingY: Math.max(5, dc.blockGap),
    toolCardPaddingX: Math.max(8, Math.round(dc.dotGap * 0.65)),
    headerGap: Math.max(6, Math.round(dc.labelGap * 0.8)),
    headerMargin: dc.labelGap,
    headerLabelFontSize: isDense ? 11 : isComfortable ? 13 : 12,
    headerMetaFontSize: isDense ? 11 : 12,
    bodyGap: dc.blockGap,
    bodyFontSize: isDense ? 13 : isComfortable ? 15 : 14,
    bodyLineHeight: isDense ? 1.5 : isComfortable ? 1.75 : 1.62,
    toolGap: Math.max(1, Math.round(dc.blockGap / 3)),
    toolMarginTop: Math.max(6, Math.round(dc.msgGap * 0.33)),
    toolRowGap: Math.max(4, Math.round(dc.labelGap * 0.6)),
    toolRowPaddingY: Math.max(4, Math.round(dc.blockGap * 0.75)),
    toolRowPaddingX: Math.max(8, Math.round(dc.dotGap * 0.55)),
    toolDetailPaddingY: Math.max(4, Math.round(dc.blockGap * 0.75)),
    toolDetailPaddingX: Math.max(7, Math.round(dc.dotGap * 0.45)),
    toolNameFontSize: isDense ? 10 : isComfortable ? 12 : 11,
    toolSummaryFontSize: isDense ? 11 : isComfortable ? 13 : 12,
    toolBadgeFontSize: isDense ? 9 : 10,
    badgePadding: isDense ? '1px 5px' : isComfortable ? '2px 8px' : '2px 7px',
  }
}

function AgentsToolRow({ thread }: { thread: ToolThread }) {
  const [open, setOpen] = useState(false)
  const dc = use(MessageDensityContext)
  const spacing = agentsDensitySpacing(dc)
  const name = thread.toolUse.name
  const color = toolColor(name)
  const metaBadges = agentsToolMetaBadges(thread)
  return (
    <div style={{
      borderLeft: `2px solid ${color}`,
      background: `color-mix(in srgb, ${color} 8%, transparent)`,
      borderRadius: '0 4px 4px 0',
      margin: 0,
    }}>
<button
            type="button"
            className="av-hover-control"
            onClick={() => setOpen((value) => !value)}
            style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: spacing.toolRowGap,
          minWidth: 0,
          padding: `${spacing.toolRowPaddingY}px ${spacing.toolRowPaddingX}px`,
          border: 0,
          borderRadius: 0,
          background: 'transparent',
          color: 'var(--text-2)',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: "'IBM Plex Mono', monospace",
          userSelect: 'text',
        }}
      >
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          color: 'var(--text-3)',
          transform: open ? 'rotate(90deg)' : undefined,
          transition: 'transform 150ms ease',
          flexShrink: 0,
        }}>›</span>
        <span style={{ color, fontSize: spacing.toolNameFontSize, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>{name}</span>
        <span style={{ color: 'var(--text-3)', fontSize: spacing.toolSummaryFontSize, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {summarizeAgentsTool(thread)}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {metaBadges.map((badge) => (
          <span style={{
            color: badge === 'error' || /^exit\s+(?!0$)/.test(badge) ? 'var(--red)' : 'var(--text-3)',
            background: 'color-mix(in srgb, var(--text) 5%, transparent)',
            border: '1px solid color-mix(in srgb, var(--text) 7%, transparent)',
            borderRadius: 4,
            padding: spacing.badgePadding,
            fontSize: spacing.toolBadgeFontSize,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }} key={badge}>
            {badge}
          </span>
          ))}
        </span>
      </button>
      {open && (
        <div style={{
          borderTop: '1px solid var(--border)',
          background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
          padding: `${spacing.toolDetailPaddingY}px ${spacing.toolDetailPaddingX}px ${spacing.toolDetailPaddingY + 2}px`,
        }}>
          <ToolThreadCard thread={thread} />
        </div>
      )}
    </div>
  )
}

function streamDensitySpacing(dc: DensityConfig) {
  const isDense = dc.msgGap <= 12
  const isComfortable = dc.msgGap >= 52
  return {
    userMarginBottom: isDense ? 8 : isComfortable ? 24 : 14,
    otherMarginBottom: isDense ? 1 : isComfortable ? 6 : 2,
    userPaddingY: isDense ? 4 : isComfortable ? 10 : 6,
    otherPaddingY: isDense ? 1 : isComfortable ? 5 : 2,
    paddingX: isComfortable ? 10 : 8,
    blockGap: isDense ? 1 : isComfortable ? 5 : 2,
    toolListMarginTop: isDense ? 2 : isComfortable ? 8 : 4,
    toolRowPaddingY: isDense ? 2 : isComfortable ? 6 : 3,
  }
}

function streamToolStatus(thread: ToolThread): { marker: '•' | '✓' | '×' | '▲'; color: string; rank: number } {
  if (thread.result?.is_error) return { marker: '×', color: 'var(--red)', rank: 3 }
  const status = typeof thread.toolUse.input.status === 'string' ? thread.toolUse.input.status.toLowerCase() : ''
  if (/denied|blocked|warning|approval/.test(status)) return { marker: '▲', color: 'var(--amber)', rank: 2 }
  if (thread.result) return { marker: '✓', color: 'var(--green)', rank: 1 }
  return { marker: '•', color: 'var(--text-3)', rank: 0 }
}

function isStreamActivityThread(thread: ToolThread): boolean {
  return ['Bash', 'Read', 'Grep', 'Glob'].includes(canonicalToolName(thread.toolUse.name))
}

function streamActivitySummary(threads: ToolThread[]): string {
  let readCount = 0
  let searchCount = 0
  let shellCount = 0
  for (const thread of threads) {
    const name = canonicalToolName(thread.toolUse.name)
    if (name === 'Read') readCount += 1
    else if (name === 'Grep' || name === 'Glob') searchCount += 1
    else if (name === 'Bash') shellCount += 1
  }
  const parts: string[] = []
  if (readCount > 0) parts.push(`${readCount} ${readCount === 1 ? 'file' : 'files'}`)
  if (searchCount > 0) parts.push(`${searchCount} ${searchCount === 1 ? 'search' : 'searches'}`)
  if (shellCount > 0) parts.push(`${shellCount} shell ${shellCount === 1 ? 'command' : 'commands'}`)
  return parts.join('  ·  ')
}

function isStreamFileUpdateThread(thread: ToolThread): boolean {
  return ['Edit', 'MultiEdit', 'Write', 'FileChange'].includes(canonicalToolName(thread.toolUse.name))
}

type StreamDiffPreviewLine = {
  key: string
  tone: 'context' | 'addition' | 'deletion'
  oldLine?: number
  newLine?: number
  text: string
}

type StreamFileUpdateData = {
  operation: 'Create' | 'Update' | 'Delete'
  path: string
  additions: number
  deletions: number
  preview: StreamDiffPreviewLine[]
  hiddenLines: number
}

const STREAM_WEB_DIFF_PREVIEW_LINES = 7

function streamPatchPreview(patch: string): { lines: StreamDiffPreviewLine[]; hiddenLines: number } {
  const parsed: StreamDiffPreviewLine[] = []
  let oldLine = 0
  let newLine = 0
  let sequence = 0
  for (const line of patch.split('\n')) {
    const hunk = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
    if (hunk?.[1] && hunk[2]) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      continue
    }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) continue
    if (line.startsWith('+')) {
      parsed.push({ key: `a:${sequence}`, tone: 'addition', newLine, text: line.slice(1) })
      newLine += 1
      sequence += 1
    } else if (line.startsWith('-')) {
      parsed.push({ key: `d:${sequence}`, tone: 'deletion', oldLine, text: line.slice(1) })
      oldLine += 1
      sequence += 1
    } else if (line.startsWith(' ')) {
      parsed.push({ key: `c:${sequence}`, tone: 'context', oldLine, newLine, text: line.slice(1) })
      oldLine += 1
      newLine += 1
      sequence += 1
    }
  }
  const firstChange = parsed.findIndex((line) => line.tone !== 'context')
  const start = Math.max(firstChange - 2, 0)
  const lines = parsed.slice(start, start + STREAM_WEB_DIFF_PREVIEW_LINES)
  return { lines, hiddenLines: Math.max(parsed.length - lines.length, 0) }
}

function streamInlineEditPreview(input: Record<string, unknown>): StreamDiffPreviewLine[] {
  const edits = Array.isArray(input.edits) ? input.edits : [input]
  const lines: StreamDiffPreviewLine[] = []
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) continue
    const record = edit as Record<string, unknown>
    const oldText = toolStringParam(record, ['oldText', 'old_string']) ?? ''
    const newText = toolStringParam(record, ['newText', 'new_string']) ?? ''
    for (const text of oldText.split('\n').filter(Boolean)) {
      lines.push({ key: `d:${lines.length}`, tone: 'deletion', text })
    }
    for (const text of newText.split('\n').filter(Boolean)) {
      lines.push({ key: `a:${lines.length}`, tone: 'addition', text })
    }
  }
  return lines.slice(0, STREAM_WEB_DIFF_PREVIEW_LINES)
}

function streamFileUpdateData(thread: ToolThread): StreamFileUpdateData | null {
  const normalized = normalizeToolThreadForNativeCard(thread)
  const name = canonicalToolName(normalized.toolUse.name)
  if (!['Edit', 'MultiEdit', 'Write', 'FileChange'].includes(name)) return null
  const input = toolInputRecord(normalized)

  if (name === 'FileChange') {
    const changes = agentsFileChanges(input)
    if (changes.length === 0) return null
    const first = changes[0]
    const patch = first.diff ?? ''
    const stats = changes.reduce((total, change) => {
      const next = agentsDiffStats(change.diff)
      return { additions: total.additions + next.additions, deletions: total.deletions + next.deletions }
    }, { additions: 0, deletions: 0 })
    const kind = summarizeAgentsFileChangeKind(first.kind).toLowerCase()
    const operation = patch.includes('--- /dev/null') || /create|add/.test(kind)
      ? 'Create'
      : patch.includes('+++ /dev/null') || /delete|remove/.test(kind)
        ? 'Delete'
        : 'Update'
    const preview = streamPatchPreview(patch)
    const firstPath = first.path ?? 'file'
    return {
      operation,
      path: changes.length > 1 ? `${firstPath} (+${changes.length - 1} more)` : firstPath,
      additions: stats.additions,
      deletions: stats.deletions,
      preview: preview.lines,
      hiddenLines: preview.hiddenLines,
    }
  }

  const path = toolStringParam(input, ['file_path', 'path']) ?? 'file'
  if (name === 'Write') {
    const content = toolStringParam(input, ['content']) ?? ''
    const contentLines = content ? content.split('\n') : []
    return {
      operation: 'Create',
      path,
      additions: content ? lineCount(content) : 0,
      deletions: 0,
      preview: contentLines.slice(0, STREAM_WEB_DIFF_PREVIEW_LINES).map((text, index) => ({
        key: `a:${index}`,
        tone: 'addition',
        newLine: index + 1,
        text,
      })),
      hiddenLines: Math.max(contentLines.length - STREAM_WEB_DIFF_PREVIEW_LINES, 0),
    }
  }

  const stats = agentsEditStats(input) ?? { additions: 0, deletions: 0 }
  const preview = streamInlineEditPreview(input)
  return {
    operation: 'Update',
    path,
    additions: stats.additions,
    deletions: stats.deletions,
    preview,
    hiddenLines: Math.max(stats.additions + stats.deletions - preview.length, 0),
  }
}

function dedupeStreamToolThreads(threads: ToolThread[]): ToolThread[] {
  const unique: ToolThread[] = []
  const indexBySummary = new Map<string, number>()
  for (const thread of threads) {
    // Preserve every file mutation as its own chronological update. Repeated
    // edits to the same path are meaningful history, not duplicate status rows.
    if (isStreamFileUpdateThread(thread)) {
      unique.push(thread)
      continue
    }
    const key = `${canonicalToolName(thread.toolUse.name)} ${summarizeAgentsTool(thread)}`.replace(/\s+/g, ' ').trim().toLowerCase()
    const existingIndex = indexBySummary.get(key)
    if (existingIndex == null) {
      indexBySummary.set(key, unique.length)
      unique.push(thread)
      continue
    }
    const existing = unique[existingIndex]
    if (existing && streamToolStatus(thread).rank > streamToolStatus(existing).rank) unique[existingIndex] = thread
  }
  return unique
}

type StreamTreePosition = 'branch' | 'last'

function StreamToolRow({
  thread,
  treePosition,
  compactActivity = false,
}: {
  thread: ToolThread
  treePosition?: StreamTreePosition
  compactActivity?: boolean
}) {
  const [open, setOpen] = useState(false)
  const spacing = streamDensitySpacing(use(MessageDensityContext))
  const name = canonicalToolName(thread.toolUse.name)
  const status = streamToolStatus(thread)
  const color = toolColor(name)
  const label = name === 'Bash' ? 'Ran' : name
  const rawSummary = summarizeAgentsTool(thread)
  const summary = name === 'Bash' ? rawSummary.replace(/^\$\s*/, '') : rawSummary
  const outputSummary = compactActivity ? streamToolOutputSummary(thread) : null
  if (open) {
    return (
      <div className="av-stream-expanded-tool">
        <button type="button" className="av-stream-collapse av-hover-control" onClick={() => setOpen(false)}>‹ collapse details</button>
        <ToolThreadCard thread={thread} />
      </div>
    )
  }
  return (
    <div>
      <button
        type="button"
        className={`av-stream-tool-row av-hover-control${treePosition ? ` av-stream-tool-row--nested av-stream-tool-row--${treePosition}` : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'baseline',
          gap: 7,
          minWidth: 0,
          padding: `${spacing.toolRowPaddingY}px ${spacing.paddingX}px ${spacing.toolRowPaddingY}px ${treePosition ? spacing.paddingX + 10 : spacing.paddingX}px`,
          border: 0,
          borderRadius: 4,
          background: 'transparent',
          color: 'var(--text-2)',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        <span className="av-stream-tool-connector" style={{ color: treePosition ? 'var(--text-3)' : status.color }}>
          {treePosition ? '' : status.marker}
        </span>
        <span className="av-stream-tool-label" style={{ color }}>{label}</span>
        <span className="av-stream-tool-command">
          {summary}
        </span>
        <span className="av-stream-tool-disclosure" aria-hidden="true">›</span>
      </button>
      {outputSummary ? (
        <div className="av-stream-single-activity-output">
          <span aria-hidden="true">└</span>
          <span>{outputSummary}</span>
        </div>
      ) : null}
    </div>
  )
}

function StreamActivitySummaryRow({ threads }: { threads: ToolThread[] }) {
  const spacing = streamDensitySpacing(use(MessageDensityContext))
  const status = threads.reduce<ReturnType<typeof streamToolStatus>>((current, thread) => {
    const next = streamToolStatus(thread)
    return next.rank > current.rank ? next : current
  }, { marker: '•' as const, color: 'var(--text-3)', rank: -1 })
  return (
    <div
      className="av-stream-activity"
      style={{ padding: `${spacing.toolRowPaddingY}px ${spacing.paddingX}px`, cursor: 'default' }}
    >
      <span aria-hidden="true" style={{ color: status.color, width: 12 }}>{status.marker}</span>
      <span>
        <strong>Activity</strong>
        <span className="av-stream-activity-counts">  ·  {streamActivitySummary(threads)}</span>
      </span>
    </div>
  )
}

function StreamFileUpdateRow({ thread }: { thread: ToolThread }) {
  const [open, setOpen] = useState(false)
  const data = streamFileUpdateData(thread)
  const status = streamToolStatus(thread)
  if (!data) return <StreamToolRow thread={thread} />
  if (open) {
    return (
      <div className="av-stream-expanded-tool">
        <button type="button" className="av-stream-collapse av-hover-control" onClick={() => setOpen(false)}>‹ collapse diff</button>
        <ToolThreadCard thread={thread} />
      </div>
    )
  }
  const changes = [
    data.additions > 0 ? `Added ${data.additions} ${data.additions === 1 ? 'line' : 'lines'}` : '',
    data.deletions > 0 ? `${data.additions > 0 ? 'removed' : 'Removed'} ${data.deletions} ${data.deletions === 1 ? 'line' : 'lines'}` : '',
  ].filter(Boolean).join(', ')
  return (
    <button type="button" className="av-stream-file-update av-hover-control" onClick={() => setOpen(true)} aria-expanded={false}>
      <span className="av-stream-file-heading">
        <span aria-hidden="true" style={{ color: status.color }}>{status.marker}</span>
        <strong>{data.operation}({data.path})</strong>
        <span className="av-stream-details">details</span>
      </span>
      {changes ? <span className="av-stream-change-summary"><span aria-hidden="true">└</span> {changes}</span> : null}
      {data.preview.length > 0 ? (
        <span className="av-stream-diff-preview">
          {data.preview.map((line) => (
            <span key={line.key} className={`av-stream-diff-line av-stream-diff-line--${line.tone}`}>
              <span className="av-stream-diff-gutter">{line.newLine ?? line.oldLine ?? ''} {line.tone === 'addition' ? '+' : line.tone === 'deletion' ? '-' : ' '}</span>
              <code>{line.text || ' '}</code>
            </span>
          ))}
          {data.hiddenLines > 0 ? <span className="av-stream-diff-more">… {data.hiddenLines} more lines</span> : null}
        </span>
      ) : null}
    </button>
  )
}

function StreamMessageItem({ message }: { message: ThreadedMessage }) {
  const spacing = streamDensitySpacing(use(MessageDensityContext))
  const isUserMessage = message.role === 'user'
  const textBlocks = message.blocks.filter((block) => block.type === 'text' && block.text.trim().length > 0)
  const toolThreads = dedupeStreamToolThreads(
    message.blocks.filter((block): block is ToolThread => block.type === 'tool_thread'),
  )
  const activityThreads = toolThreads.filter(isStreamActivityThread)
  const hasSingleActivity = activityThreads.length === 1
  let lastActivityIndex = -1
  for (let index = 0; index < toolThreads.length; index += 1) {
    if (isStreamActivityThread(toolThreads[index])) lastActivityIndex = index
  }
  if (textBlocks.length === 0 && toolThreads.length === 0) return null

  const marker = message.role === 'user' ? '❯' : message.role === 'system' ? '▲' : '•'
  const markerColor = message.role === 'user'
    ? 'var(--cyan)'
    : message.role === 'system'
      ? 'var(--amber)'
      : 'var(--text-3)'
  // Origin kind carries the spawn chain (`subagent:parent/child`); indent the
  // whole message behind one ↪ per nesting level so subagent activity reads as
  // nested inside the stream.
  const originKind = message.origin?.kind ?? ''
  const spawnPath = originKind.startsWith('subagent:') ? originKind.slice('subagent:'.length).split('/') : []
  const subagentArrows = spawnPath.length > 0 ? '↪'.repeat(Math.min(spawnPath.length, 3)) : ''
  const body = (
    <>
        {textBlocks.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, minWidth: 0 }}>
            <span aria-hidden="true" style={{ color: markerColor, flexShrink: 0, fontFamily: "'IBM Plex Mono', monospace" }}>{marker}</span>
            <div style={{ display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column', gap: spacing.blockGap }}>
              {textBlocks.map((block, index) => renderBlock(block, index))}
            </div>
          </div>
        )}
        {toolThreads.length > 0 && (
          <div className={activityThreads.length > 0 ? 'av-stream-activity-group' : undefined} style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            marginTop: textBlocks.length > 0 ? spacing.toolListMarginTop : 0,
          }}>
            {activityThreads.length > 1 ? <StreamActivitySummaryRow threads={activityThreads} /> : null}
            {toolThreads.map((thread, index) => (
              isStreamFileUpdateThread(thread)
                ? <StreamFileUpdateRow key={thread.toolUse.id ?? `${thread.toolUse.name}:${index}`} thread={thread} />
                : <StreamToolRow
                    key={thread.toolUse.id ?? `${thread.toolUse.name}:${index}`}
                    thread={thread}
                    compactActivity={hasSingleActivity && isStreamActivityThread(thread)}
                    treePosition={!hasSingleActivity && isStreamActivityThread(thread) ? index === lastActivityIndex ? 'last' : 'branch' : undefined}
                  />
            ))}
          </div>
        )}
    </>
  )
  return (
    <SessionContext.Provider value={message.sessionId}>
      <div className={isUserMessage ? 'av-stream-message av-stream-message--user' : 'av-stream-message'} style={{
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.blockGap,
        marginBottom: isUserMessage ? spacing.userMarginBottom : spacing.otherMarginBottom,
        width: '100%',
        padding: isUserMessage
          ? `${spacing.userPaddingY}px ${spacing.paddingX}px`
          : `${spacing.otherPaddingY}px ${spacing.paddingX}px`,
      }}>
        {subagentArrows ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, minWidth: 0 }}>
            <span
              aria-hidden="true"
              title={spawnPath.length > 1 ? `subagent · spawned via ${spawnPath.join(' ▸ ')}` : 'subagent'}
              style={{ color: 'var(--t-agent)', flexShrink: 0, fontFamily: "'IBM Plex Mono', monospace" }}
            >
              {subagentArrows}
            </span>
            <div style={{ display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column', gap: spacing.blockGap }}>
              {body}
            </div>
          </div>
        ) : body}
      </div>
    </SessionContext.Provider>
  )
}

function AgentsViewMessageItem({ message, showSession, hydrated, roleLabel }: {
  message: ThreadedMessage
  showSession?: boolean
  hydrated: boolean
  roleLabel: string
}) {
  const dc = use(MessageDensityContext)
  const spacing = agentsDensitySpacing(dc)
  const toolThreads = message.blocks.filter((block): block is ToolThread => block.type === 'tool_thread')
  const nonToolBlocks = message.blocks.filter((block) => block.type !== 'tool_thread')
  const toolOnly = toolThreads.length > 0 && nonToolBlocks.length === 0
  const roleColor = message.role === 'assistant'
    ? 'var(--violet)'
    : message.role === 'user'
      ? 'var(--cyan)'
      : 'var(--yellow)'
  const roleBackground = message.role === 'assistant'
    ? 'color-mix(in srgb, var(--violet) 8%, var(--surface))'
    : message.role === 'user'
      ? 'color-mix(in srgb, var(--cyan) 8%, var(--surface))'
      : 'color-mix(in srgb, var(--yellow) 8%, var(--surface))'
  const roleInitial = message.role === 'assistant' ? 'A' : message.role === 'user' ? 'U' : 'S'

  if (toolOnly) {
    return (
      <SessionContext.Provider value={message.sessionId}>
        <section style={{
          borderLeft: '3px solid var(--amber)',
          borderRadius: '0 7px 7px 0',
          background: 'color-mix(in srgb, var(--amber) 8%, transparent)',
          padding: `${spacing.toolCardPaddingY}px ${spacing.toolCardPaddingX}px`,
          marginBottom: spacing.cardMargin,
        }}>
          <header style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing.headerGap,
            color: 'var(--amber)',
            marginBottom: Math.max(4, spacing.headerMargin - 2),
          }}>
            <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>⚙</span>
            <span style={{ fontSize: spacing.headerLabelFontSize, fontWeight: 600 }}>{toolThreads.length} tool {toolThreads.length === 1 ? 'call' : 'calls'}</span>
            <span aria-hidden="true" style={{ color: 'var(--text-3)', fontSize: spacing.headerLabelFontSize }}>⧉</span>
            {message.timestamp && (
              <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: spacing.headerMetaFontSize, fontWeight: 400 }}>
                {hydrated ? formatLocalMessageTime(message.timestamp) : formatStableMessageTime(message.timestamp)}
              </span>
            )}
          </header>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.toolGap }}>
            {toolThreads.map((thread, index) => <AgentsToolRow key={thread.toolUse.id ?? index} thread={thread} />)}
          </div>
        </section>
      </SessionContext.Provider>
    )
  }

  return (
    <SessionContext.Provider value={message.sessionId}>
      <article style={{
        borderLeft: `4px solid ${roleColor}`,
        borderRadius: '0 7px 7px 0',
        background: roleBackground,
        padding: `${spacing.cardPaddingY}px ${spacing.cardPaddingX}px`,
        marginBottom: spacing.cardMargin,
      }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: spacing.headerGap, marginBottom: spacing.headerMargin, minWidth: 0 }}>
          <span style={{
            width: dc.msgGap <= 12 ? 18 : 22,
            height: dc.msgGap <= 12 ? 18 : 22,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: dc.msgGap <= 12 ? 10 : 11,
            fontWeight: 800,
            flexShrink: 0,
            color: 'var(--bg)',
            background: roleColor,
            lineHeight: 1,
          }}>
            {roleInitial}
          </span>
          <span style={{ color: roleColor, fontSize: spacing.headerLabelFontSize, fontWeight: 600, letterSpacing: '0.01em' }}>{roleLabel}</span>
          <div style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: spacing.headerGap,
            minWidth: 0,
            color: 'var(--text-3)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: spacing.headerMetaFontSize,
          }}>
            {message.usage && (
              <span>{fmtTokens(message.usage.input_tokens)} ctx / {fmtTokens(message.usage.output_tokens)} out</span>
            )}
            {toolThreads.length > 0 && (
              <span style={{
                color: 'var(--text-3)',
                background: 'color-mix(in srgb, var(--text) 5%, transparent)',
                border: '1px solid color-mix(in srgb, var(--text) 7%, transparent)',
                borderRadius: 4,
                padding: spacing.badgePadding,
                whiteSpace: 'nowrap',
              }}>
                turn · {toolThreads.length} {toolThreads.length === 1 ? 'call' : 'calls'}
              </span>
            )}
            {showSession && message.provider && <span>{message.provider.toUpperCase()}</span>}
            {message.timestamp && <span>{hydrated ? formatLocalMessageTime(message.timestamp) : formatStableMessageTime(message.timestamp)}</span>}
          </div>
        </header>
        {nonToolBlocks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.bodyGap, fontSize: spacing.bodyFontSize, lineHeight: spacing.bodyLineHeight }}>
            {nonToolBlocks.map((block, index) => renderBlock(block, index))}
          </div>
        )}
        {toolThreads.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.toolGap, marginTop: nonToolBlocks.length > 0 ? spacing.toolMarginTop : 0 }}>
            {toolThreads.map((thread, index) => <AgentsToolRow key={thread.toolUse.id ?? index} thread={thread} />)}
          </div>
        )}
      </article>
    </SessionContext.Provider>
  )
}

// ── Timeline message item ─────────────────────────────────────────────────────

const ROLE_STYLE = {
  assistant: { dot: 'var(--violet)', glow: 'var(--violet-glow)', labelColor: 'var(--violet)' },
  user:      { dot: 'var(--cyan)',   glow: 'var(--cyan-glow)',   label: 'USER',   labelColor: 'var(--cyan)'   },
  system:    { dot: 'var(--yellow)', glow: 'rgba(251,191,36,0.18)', label: 'SYSTEM', labelColor: 'var(--yellow)' },
} as const

export type MessageDensity = 'comfortable' | 'balanced' | 'dense'
export type WebViewMode = 'conversation' | 'full' | 'continue' | 'stream' | 'agents'

type DensityConfig = { msgGap: number; blockGap: number; labelGap: number; dotGap: number }

function densityConfig(d: MessageDensity): DensityConfig {
  switch (d) {
    case 'comfortable': return { msgGap: 52, blockGap: 12, labelGap: 12, dotGap: 22 }
    case 'dense':       return { msgGap: 12, blockGap: 5,  labelGap: 6,  dotGap: 14 }
    default:            return { msgGap: 36, blockGap: 8,  labelGap: 10, dotGap: 18 }
  }
}

const MessageDensityContext = createContext<DensityConfig>(densityConfig('balanced'))
const HydrationContext = createContext(false)
const SessionContext = createContext<string | undefined>(undefined)
const ViewModeContext = createContext<WebViewMode>('conversation')
const DiffStyleContext = createContext<PierreDiffStyle>('stacked')

const DiffOptionsContext = createContext<DiffOptions>(DEFAULT_DIFF_OPTIONS)

/** Opens a session that may not be in the current sidebar/tab list — used by
 * inline subagent cards' "Open session" action (real child sessions only,
 * e.g. OpenCode task subagents). No-op when the host view didn't wire one up. */
const NavigateSessionContext = createContext<((session: Session) => void) | undefined>(undefined)

/** Elapsed wall-clock ms per turn (see computeTurnDurationsMs), keyed by
 * message uuid, computed once over the full transcript by the host view. */
const TurnDurationContext = createContext<Map<string, number> | undefined>(undefined)

export function MessageDensityProvider({ density, children, onOpenSession, turnDurations }: { density: MessageDensity; children: React.ReactNode; onOpenSession?: (session: Session) => void; turnDurations?: Map<string, number> }) {
  const [hydrated, setHydrated] = useState(false)
  const value = useMemo(() => densityConfig(density), [density])

  useEffect(() => {
    setHydrated(true)
  }, [])

  return (
    <MessageDensityContext.Provider value={value}>
      <HydrationContext.Provider value={hydrated}>
        <NavigateSessionContext.Provider value={onOpenSession}>
          <TurnDurationContext.Provider value={turnDurations}>
            {children}
          </TurnDurationContext.Provider>
        </NavigateSessionContext.Provider>
      </HydrationContext.Provider>
    </MessageDensityContext.Provider>
  )
}

export function ViewModeProvider({ mode, children }: { mode: WebViewMode; children: React.ReactNode }) {
  return (
    <ViewModeContext.Provider value={mode}>
      {children}
    </ViewModeContext.Provider>
  )
}

export function DiffStyleProvider({ diffStyle, children }: { diffStyle: PierreDiffStyle; children: React.ReactNode }) {
  return (
    <DiffStyleContext.Provider value={diffStyle}>
      {children}
    </DiffStyleContext.Provider>
  )
}

export function DiffOptionsProvider({ options, children }: { options: DiffOptions; children: React.ReactNode }) {
  return (
    <DiffOptionsContext.Provider value={options}>
      {children}
    </DiffOptionsContext.Provider>
  )
}

function useEffectiveDiffStyle(): [PierreDiffStyle, () => void] {
  const defaultStyle = use(DiffStyleContext)
  const [override, setOverride] = useState<PierreDiffStyle | null>(null)
  const diffStyle = override ?? defaultStyle
  return [diffStyle, () => setOverride(toggleDiffStyle(diffStyle))]
}

function useDiffPresentation(): [PierreDiffPresentation, PierreDiffStyle, () => void] {
  const [diffStyle, toggleDiffStyleOverride] = useEffectiveDiffStyle()
  const options = use(DiffOptionsContext)
  const presentation = useMemo<PierreDiffPresentation>(() => ({ ...options, diffStyle }), [options, diffStyle])
  return [presentation, diffStyle, toggleDiffStyleOverride]
}

function MessageItemInner({ message, showSession }: { message: ThreadedMessage; showSession?: boolean }) {
  const hydrated = use(HydrationContext)
  const turnDurations = use(TurnDurationContext)
  const turnDurationMs = turnDurations?.get(message.uuid)
  const dc = use(MessageDensityContext)
  const viewMode = use(ViewModeContext)
  const isBridgeMessage = message.origin?.kind === 'bridge'
  const style = ROLE_STYLE[message.role]
  const flatItem = useColorTreatment() === 'flat'
  const roleLabel = message.role === 'assistant'
    ? getAssistantLabel(message.provider)
    : ROLE_STYLE[message.role].label

  if (viewMode === 'agents' && !isBridgeMessage) {
    return (
      <AgentsViewMessageItem
        message={message}
        showSession={showSession}
        hydrated={hydrated}
        roleLabel={roleLabel}
      />
    )
  }

  // Bridge messages (CLI bridge ephemeral responses) rendered distinctly
  if (isBridgeMessage) {
    const textBlocks = message.blocks.filter((b) => b.type === 'text')
    const bridgeLabel = message.role === 'user' ? '↳ sent' : '↲ reply'
    return (
      <div style={{ marginBottom: dc.blockGap, marginLeft: 8, paddingLeft: 8, borderLeft: `2px solid var(--accent-dim, rgba(255,165,0,0.3))` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.05em' }}>
            🔌 {bridgeLabel}
          </span>
          {message.timestamp && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--text-4)' }}>
              {hydrated ? formatLocalMessageTime(message.timestamp) : formatStableMessageTime(message.timestamp)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, lineHeight: 1.5 }}>
          {textBlocks.length > 0 ? textBlocks.map((block, i) => renderBlock(block, i)) : <span style={{ color: 'var(--text-3)' }}>({message.role === 'user' ? 'message sent' : 'no reply'})</span>}
        </div>
      </div>
    )
  }

  if (viewMode === 'stream') {
    return <StreamMessageItem message={message} />
  }

  return (
    <SessionContext.Provider value={message.sessionId}>
    <div className={`msg msg--${message.role}`} style={{ display: 'flex', gap: dc.dotGap, marginBottom: dc.msgGap }}>
      {/* Left column: dot */}
      <div className="msg-dot" style={{ width: 20, flexShrink: 0, paddingTop: 3 }}>
        <div
          style={{
            width: 13,
            height: 13,
            borderRadius: '50%',
            background: style.dot,
            boxShadow: flatItem ? `0 0 0 2px var(--bg)` : `0 0 0 2px var(--bg), 0 0 10px 3px ${style.glow}`,
            margin: '0 auto',
          }}
        />
      </div>

      {/* Right column */}
      <div className="msg-body" style={{ flex: 1, minWidth: 0 }}>
        {/* Label row */}
        <div className="msg-label" style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: dc.labelGap }}>
          <span
            style={{
              fontFamily: "'Oxanium', monospace",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: style.labelColor,
            }}
          >
            {roleLabel}
          </span>
          {message.aborted && (
            <span
              title="Claude interrupted this assistant turn before the stream completed."
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: 'var(--yellow)', background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)', borderRadius: 3, padding: '1px 5px', letterSpacing: '0.04em' }}
            >
              ABORTED PARTIAL
            </span>
          )}
          {message.subagentRetry && (
            <span
              title="Claude reported a retry for this subagent tool call."
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: 'var(--yellow)', background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)', borderRadius: 3, padding: '1px 5px', letterSpacing: '0.04em' }}
            >
              SUBAGENT RETRY
            </span>
          )}
          {message.timestamp && (
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: 'var(--text-3)',
              }}
            >
              {hydrated ? formatLocalMessageTime(message.timestamp) : formatStableMessageTime(message.timestamp)}
            </span>
          )}
          {message.usage && (
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: 'var(--text-3)',
                letterSpacing: '0.03em',
              }}
            >
              {fmtTokens(message.usage.input_tokens)}↑ {fmtTokens(message.usage.output_tokens)}↓
              {(message.usage.cache_read_input_tokens ?? 0) > 0 && (
                <span
                  title={`${fmtTokens(message.usage.cache_read_input_tokens!)} cache read`}
                  style={{ color: 'var(--green)', marginLeft: 5 }}
                >
                  ⚡{fmtTokens(message.usage.cache_read_input_tokens!)}
                </span>
              )}
            </span>
          )}
          {turnDurationMs != null && turnDurationMs > 0 && (
            <span
              title="Elapsed time for this turn"
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: 'var(--text-3)',
              }}
            >
              ⏱ {formatDurationShort(turnDurationMs)}
            </span>
          )}
          {message.origin?.kind && message.origin.kind !== 'task-notification' && (() => {
            const isSubagent = message.origin.kind.startsWith('subagent:')
            const isPeerSend = message.origin.subkind === 'peer-send-message'
            // Origin kind carries the spawn chain (`subagent:parent/child`);
            // repeat the arrow per nesting level for depth-2+ agents.
            const spawnPath = isSubagent ? message.origin.kind.slice('subagent:'.length).split('/') : []
            const depth = spawnPath.length
            const label = isSubagent
              ? `${'↪'.repeat(Math.min(Math.max(depth, 1), 3))} SUBAGENT`
              : isPeerSend ? '⇄ PEER SEND' : message.origin.kind.toUpperCase()
            const color = isSubagent ? 'var(--t-agent)' : 'var(--t-other)'
            const bg    = isSubagent ? 'rgba(244,114,182,0.08)' : 'rgba(139,128,240,0.08)'
            const bdr   = isSubagent ? '1px solid rgba(244,114,182,0.22)' : '1px solid rgba(139,128,240,0.2)'
            const title = depth > 1
              ? `spawned via ${spawnPath.join(' ▸ ')}`
              : isPeerSend ? 'Pushed in by another session’s SendMessage tool' : undefined
            return (
              <span
                title={title}
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color, background: bg, border: bdr, borderRadius: 3, padding: '1px 5px' }}
              >
                {label}
              </span>
            )
          })()}
          {message.taskDescription && message.origin?.kind?.startsWith('subagent:') && (
            <span
              title={message.taskDescription}
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: 'var(--text-3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
                maxWidth: '40ch',
              }}
            >
              Task: {message.taskDescription}
            </span>
          )}
          {message.requestId && (
            <span
              title={message.requestId}
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: 'var(--text-3)',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 3,
                padding: '1px 5px',
                letterSpacing: '0.04em',
              }}
            >
              req · {message.requestId.slice(0, 10)}
            </span>
          )}
          {showSession && message.provider && (
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: message.provider === 'codex'
                  ? 'var(--cyan)'
                  : message.provider === 'opencode'
                  ? 'var(--green)'
                  : message.provider === 'copilot'
                  ? 'var(--amber)'
                  : 'var(--violet)',
                background: message.provider === 'codex'
                  ? 'rgba(56,217,245,0.08)'
                  : message.provider === 'opencode'
                  ? 'rgba(45,212,160,0.08)'
                  : message.provider === 'copilot'
                  ? 'rgba(234,170,64,0.08)'
                  : 'rgba(139,128,240,0.08)',
                border: `1px solid ${message.provider === 'codex'
                  ? 'rgba(56,217,245,0.2)'
                  : message.provider === 'opencode'
                  ? 'rgba(45,212,160,0.2)'
                  : message.provider === 'copilot'
                  ? 'rgba(234,170,64,0.2)'
                  : 'rgba(139,128,240,0.2)'}`,
                borderRadius: 999,
                padding: '1px 6px',
              }}
            >
              {message.provider.toUpperCase()}
            </span>
          )}
          {showSession && message.sessionId && (
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.06em',
                color: 'var(--text-3)',
                background: 'var(--surface-3)',
                border: '1px solid var(--border)',
                borderRadius: 3,
                padding: '1px 6px',
              }}
            >
              {message.sessionId.slice(-10)}
            </span>
          )}
        </div>

        {/* Content blocks */}
        <div className="msg-blocks" style={{ display: 'flex', flexDirection: 'column', gap: dc.blockGap }}>
          {message.blocks.map((block, i) => renderBlock(block, i))}
        </div>
      </div>
    </div>
    </SessionContext.Provider>
  )
}

// Reference equality is the fast path (incremental threading preserves refs
// for the stable prefix). When a poll triggers a full rebuild — or a provider
// re-creates SessionMessage objects per fetch — fall back to value-equal on
// uuid + timestamp + block count so unchanged cards stop re-rendering.
const MessageItem = memo(MessageItemInner, (prev, next) =>
  prev.showSession === next.showSession
  && (
    prev.message === next.message
    || (
      prev.message.uuid === next.message.uuid
      && prev.message.timestamp === next.message.timestamp
      && prev.message.blocks.length === next.message.blocks.length
    )
  )
)

export default MessageItem
