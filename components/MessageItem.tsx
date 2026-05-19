'use client'

import { lazy, memo, Suspense, use, useEffect, useMemo, useState, createContext } from 'react'
import { pathBasename as basename } from '@/lib/projectPaths'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import type { ThreadedMessage, ThreadedBlock, ToolThread, TaskNotificationBlock, SystemReminderBlock, SlashCommandBlock, LocalCommandStdoutBlock, ClaudeSystemBlock } from '@/lib/threading'
import type { TextBlock, ThinkingBlock, ToolResultBlock, ImageBlock } from '@/lib/types'
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
import { Separator } from '@/components/ui/separator'

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
  WebSearch: 'var(--cyan)',
  WebFetch:  'var(--t-read)',
  NotebookEdit: 'var(--t-edit)',
}

function toolColor(name: string) {
  return TOOL_COLORS[name] ?? 'var(--t-other)'
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

function DiffView(props: { oldStr: string; newStr: string; filePath?: string }) {
  return (
    <Suspense fallback={<PlainCodeBlock code={props.newStr || props.oldStr} language={detectLanguageFromPath(props.filePath)} maxHeight={500} />}>
      <LazyDiffView {...props} />
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
  const [hovered, setHovered] = useState(false)
  const delta    = countLines(newStr) - countLines(oldStr)
  const sign     = delta > 0 ? `+${delta}` : String(delta)
  const c        = toolColor(toolUse.name)

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
            background: `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
        </div>
      }
      body={open ? (
        <>
          <div style={{ padding: '2px 12px', background: 'var(--surface)', borderTop: '1px solid var(--border)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {filePath}
          </div>
          <DiffView oldStr={oldStr} newStr={newStr} filePath={filePath} />
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
            background: `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
  const [hovered, setHovered] = useState(false)
  const c = toolColor('FileChange')
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
            background: `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
              const diffText = change.diff ?? ''
              return (
                <div key={`${filePath}:${index}`} style={{ borderTop: index > 0 ? '1px solid var(--border)' : undefined }}>
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
                      color: c,
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
                  </div>
                  <CodeViewer code={diffText} language="diff" maxHeight={420} />
                </div>
              )
            })
          )}
        </div>
      ) : undefined}
    />
  )
}

// ── Generic tool card ─────────────────────────────────────────────────────────

function GenericToolCard({ thread }: { thread: ToolThread }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const { toolUse, result } = thread
  const c = toolColor(toolUse.name)
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
            background: `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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

// ── AskUserQuestion card ──────────────────────────────────────────────────────

type AUQOption  = { label: string; description?: string; preview?: string }
type AUQQuestion = { question: string; header?: string; multiSelect?: boolean; options: AUQOption[] }

function AskUserQuestionCard({ thread }: { thread: ToolThread }) {
  const input = thread.toolUse.input as { questions?: AUQQuestion[] }
  const questions = input.questions ?? []
  const resultStr = thread.result ? resultToString(thread.result.content) : ''
  const answered  = !!resultStr

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
        background: 'linear-gradient(to right, var(--violet-glow), transparent)',
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

  return (
    <div>
      {/* Question text */}
      <div style={{
        fontFamily: "'IBM Plex Sans', sans-serif",
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
        {q.options.map((opt, oi) => {
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
                    ? 'linear-gradient(to right, rgba(139,128,240,0.10), rgba(139,128,240,0.04))'
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
                    fontFamily: "'IBM Plex Sans', sans-serif",
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
                      fontFamily: "'IBM Plex Sans', sans-serif",
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
          background: `linear-gradient(to right, rgba(56,217,245,${hovered ? '0.14' : '0.08'}) 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
  return (
    <CardShell color={c} result={thread.result} toolName="Bash"
      header={
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 14px',
            background: `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
  const input = thread.toolUse.input as { file_path?: string; offset?: number; limit?: number }
  const filePath = input.file_path ?? ''
  const c = toolColor('Read')
  const rangeLabel = [
    input.offset != null ? `@${input.offset}` : null,
    input.limit  != null ? `+${input.limit}`  : null,
  ].filter(Boolean).join(' ')
  return (
    <CardShell color={c} result={thread.result} toolName="Read" resultFilePath={filePath}
      header={
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            background: `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
            background: `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
            background: `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
  const input = thread.toolUse.input as { todos?: TodoItem[] }
  const todos = input.todos ?? []
  const counts = { completed: 0, in_progress: 0, pending: 0 }
  for (const t of todos) counts[t.status] = (counts[t.status] ?? 0) + 1

  return (
    <div style={{ border: '1px solid var(--border)', borderLeft: '2px solid var(--violet)', borderRadius: 6, overflow: 'hidden', fontSize: 13, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'linear-gradient(to right, var(--violet-glow), transparent)' }}>
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
              {todo.content}
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
  message: { role: string; content: string | Array<{ type: string; text?: string; name?: string }> }
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

function AgentCard({ thread }: { thread: ToolThread }) {
  const sessionId = use(SessionContext)
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
  const raw = thread.result ? resultToString(thread.result.content) : ''

  let parsed: Record<string, unknown> | null = null
  try { if (raw) parsed = JSON.parse(raw) } catch { /* not JSON */ }

  const status = (parsed?.status as string) ?? (thread.result ? 'unknown' : 'pending')
  const statusColors: Record<string, string> = {
    completed: 'var(--green)', async_launched: 'var(--cyan)',
    sub_agent_entered: 'var(--amber)', unknown: 'var(--text-3)', pending: 'var(--text-3)',
  }
  const statusLabels: Record<string, string> = {
    completed: 'done', async_launched: 'launched', sub_agent_entered: 'entered',
  }
  const resultText       = (parsed?.content as Array<{ text?: string }>)?.[0]?.text ?? (parsed?.message as string) ?? ''
  const totalTokens       = parsed?.totalTokens        as number | undefined
  const totalToolUseCount = parsed?.totalToolUseCount   as number | undefined
  const totalDurationMs   = parsed?.totalDurationMs     as number | undefined
  const outputFile        = parsed?.outputFile          as string | undefined
  const agentId           = parsed?.agentId             as string | undefined
  const toolStats         = parsed?.toolStats           as { readCount?: number; searchCount?: number; bashCount?: number; editFileCount?: number; linesAdded?: number; linesRemoved?: number } | undefined

  const canViewTranscript = !!agentId && !!sessionId && (status === 'completed' || status === 'async_launched')

  const loadTranscript = async () => {
    if (transcriptMessages || !agentId || !sessionId) return
    setTranscriptLoading(true)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/subagents/${agentId}/messages`)
      const data = await res.json() as { messages?: SubagentMessage[] }
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
    return { startedAtMs, endedAtMs, lastAssistantText }
  }, [transcriptMessages])

  const formatClockShort = (ms: number) => {
    const d = new Date(ms)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
  }
  const formatDurationShort = (ms: number) => {
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

  return (
    <div style={{ border: '1px solid var(--border)', borderLeft: `2px solid ${c}`, borderRadius: 6, overflow: 'hidden', fontSize: 13, marginTop: 4 }}>
      {/* Header */}
      <div
        onClick={() => resultText ? setOpen(v => !v) : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
          background: `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
            fontFamily: "'IBM Plex Sans', sans-serif",
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
              boxShadow: `0 0 6px ${c}`,
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
            {!transcriptLoading && transcriptMessages && <span style={{ opacity: 0.5 }}>({transcriptMessages.length} msgs)</span>}
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
                fontFamily: "'IBM Plex Sans', sans-serif",
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
                    return (
                      <div key={msg.uuid} style={{ borderBottom: '1px solid var(--border)', padding: '6px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: isAssistant ? c : 'var(--text-3)', letterSpacing: '0.06em' }}>
                            {isAssistant ? 'CLAUDE' : 'USER'}
                          </span>
                          {tools.length > 0 && (
                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)' }}>
                              {tools.join(', ')}
                            </span>
                          )}
                        </div>
                        {text && (
                          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflowY: 'auto' }}>
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
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface)', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65, maxHeight: 320, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {resultText}
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

  return (
    <CardShell color={c} result={thread.result} toolName="Skill"
      header={
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            background: `linear-gradient(to right, rgba(139,128,240,${hovered ? '0.14' : '0.08'}) 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
  const input = toolUse.input as {
    file_path?: string
    edits?: { old_string?: string; new_string?: string; replace_all?: boolean }[]
  }
  const filePath = input.file_path ?? ''
  const edits = input.edits ?? []
  const largeDiff = isLargeTextList(edits.flatMap((edit) => [edit.old_string ?? '', edit.new_string ?? '']))
  const [open, setOpen] = useState(() => !largeDiff)
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
            background: `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
            <div key={i}>
              {edits.length > 1 && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '2px 12px',
                  borderTop: '1px solid var(--border)',
                  background: 'var(--surface)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11, color: 'var(--text-3)',
                  userSelect: 'none',
                }}>
                  <span>{i + 1} / {edits.length}</span>
                  {edit.replace_all && (
                    <span style={{ color: 'var(--amber)', border: '1px solid var(--border)', borderRadius: 3, padding: '0 4px' }}>replace_all</span>
                  )}
                </div>
              )}
              <DiffView oldStr={edit.old_string ?? ''} newStr={edit.new_string ?? ''} filePath={filePath} />
            </div>
          ))}
        </>
      ) : undefined}
    />
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
          background: `linear-gradient(to right, rgba(56,217,245,${hovered ? '0.14' : '0.08'}) 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
                    <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>
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
              <button onClick={() => setExpanded(v => !v)} style={EXPAND_BTN}>
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
            background: `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
  const hasBody      = !!newSource

  const editModeColor: Record<string, string> = {
    replace: 'var(--t-edit)',
    insert:  'var(--green)',
    delete:  'var(--red)',
  }
  const chipColor = editModeColor[editMode] ?? 'var(--text-3)'

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
            background: `linear-gradient(to right, ${c}${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
type TaskRecord = Partial<TaskListOutput['tasks'][number]>
type TaskInput = Partial<TaskCreateInput & TaskGetInput & TaskUpdateInput & { _stopReason?: string }>

const TASK_ICON: Record<string, string>  = { completed: '✓', in_progress: '◐', pending: '○' }
const TASK_COLOR: Record<string, string> = { completed: 'var(--green)', in_progress: 'var(--amber)', pending: 'var(--text-3)' }

function TaskCard({ thread }: { thread: ToolThread }) {
  const [hovered, setHovered] = useState(false)
  const { toolUse, result } = thread
  const name  = toolUse.name
  const c     = 'var(--amber)'
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
        background: `linear-gradient(to right, rgba(245,158,11,${hovered ? '0.14' : '0.08'}) 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
    return (
      <div style={{ border: '1px solid var(--border)', borderLeft: `2px solid ${c}`, borderRadius: 6, overflow: 'hidden', fontSize: 13, marginTop: 4 }}>
        {headerContent}
        {tasks.length > 0 && (
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5, background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
            {tasks.map((t, i) => {
              const st = t.status ?? 'pending'
              const blockedBy = Array.isArray(t.blockedBy) ? t.blockedBy : []
              const openBlockers = blockedBy.filter((id) => !completedSet.has(id))
              const isBlocked = st === 'pending' && openBlockers.length > 0
              const activeForm = st === 'in_progress' && t.id ? activeForms.get(t.id) : undefined
              const subject = activeForm && activeForm.trim() ? activeForm.trim() : (t.subject ?? t.id ?? '—')
              const subjectColor = st === 'completed'
                ? 'var(--text-3)'
                : isBlocked
                ? 'var(--text-2)'
                : 'var(--text)'
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
        background: `linear-gradient(to right, var(--t-glob)${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
                <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {job.prompt ?? ''}
                </span>
              </div>
            ))}
            {(hidden > 0 || expanded) && (
              <button onClick={() => setExpanded(v => !v)} style={EXPAND_BTN}>
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
        background: `linear-gradient(to right, var(--t-other)${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
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
  const name = thread.toolUse.name
  if (name === 'Edit')                         return <EditToolCard thread={thread} />
  if (name === 'MultiEdit')                    return <MultiEditCard thread={thread} />
  if (name === 'FileChange')                   return <FileChangeCard thread={thread} />
  if (name === 'Write')                        return <WriteToolCard thread={thread} />
  if (name === 'Bash')                         return <BashCard thread={thread} />
  if (name === 'Read')                         return <ReadCard thread={thread} />
  if (name === 'Grep')                         return <GrepCard thread={thread} />
  if (name === 'Glob')                         return <GlobCard thread={thread} />
  if (name === 'TodoWrite')                    return <TodoWriteCard thread={thread} />
  if (name === 'Agent')                        return <AgentCard thread={thread} />
  if (name === 'EnterPlanMode' || name === 'ExitPlanMode') return <PlanModeCard thread={thread} />
  if (name === 'Skill')                        return <SkillCard thread={thread} />
  if (name === 'AskUserQuestion')              return <AskUserQuestionCard thread={thread} />
  if (name === 'ToolSearch')                   return <ToolSearchCard thread={thread} />
  if (name === 'WebSearch')                    return <WebSearchCard thread={thread} />
  if (name === 'WebFetch')                     return <WebFetchCard thread={thread} />
  if (name === 'NotebookEdit')                 return <NotebookEditCard thread={thread} />
  if (name === 'EnterWorktree' || name === 'ExitWorktree') return <WorktreeCard thread={thread} />
  if (name === 'TaskCreate' || name === 'TaskList' || name === 'TaskGet' || name === 'TaskUpdate' || name === 'TaskStop') return <TaskCard thread={thread} />
  if (name === 'CronCreate' || name === 'CronList' || name === 'CronDelete') return <CronCard thread={thread} />
  if (name === 'ListMcpResourcesTool' || name === 'ReadMcpResourceTool') return <McpCard thread={thread} />
  return <GenericToolCard thread={thread} />
}

// ── Tool result renderers ─────────────────────────────────────────────────────

function resultToString(content: ToolResultBlock['content']): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(b => ((b as { type: string; text?: string }).type === 'text'
        ? (b as { text: string }).text
        : JSON.stringify(b)))
      .join('\n')
  }
  return JSON.stringify(content, null, 2)
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

function ReadResultSection({ raw, filePath }: { raw: string; filePath?: string }) {
  const [expanded, setExpanded] = useState(false)
  const LIMIT = 25

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
      {processedParts.map((part, i) =>
        part.kind === 'system_reminder'
          ? <SystemReminderCard key={i} block={{ type: 'system_reminder', content: part.content }} />
          : part.visibleLines.length > 0
            ? (
              <div key={i}>
                <CodeViewer
                  code={part.visibleLines.map(line => line.code).join('\n')}
                  filePath={filePath}
                  showLineNumbers={shouldShowLineNumbers(part.visibleLines)}
                  startingLineNumber={inferStartingLineNumber(part.visibleLines)}
                  maxHeight={500}
                />
              </div>
            )
            : null
      )}
      {totalLines > LIMIT && (
        <button onClick={() => setExpanded(v => !v)} style={EXPAND_BTN}>
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

  const preStyle: React.CSSProperties = {
    padding: '8px 14px', margin: 0,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13, color: 'var(--text-2)',
    background: 'var(--surface)', overflowX: 'auto',
    whiteSpace: 'pre', lineHeight: 1.6,
  }

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
        <pre style={preStyle}>{processedParts[0]?.kind === 'text' ? processedParts[0].visibleLines.join('\n') : ''}</pre>
      ) : (
        processedParts.map((part, i) =>
          part.kind === 'system_reminder'
            ? <SystemReminderCard key={i} block={{ type: 'system_reminder', content: part.content }} />
            : part.visibleLines.length > 0
              ? <pre key={i} style={preStyle}>{part.visibleLines.join('\n')}</pre>
              : null
        )
      )}

      {totalTextLines > LIMIT && (
        <button onClick={() => setExpanded(v => !v)} style={EXPAND_BTN}>
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
  const raw = useMemo(() => imageBlock ? '' : resultToString(result.content), [imageBlock, result.content])
  const nonEmpty = useMemo(() => raw.split('\n').filter(l => l.trim()), [raw])

  if (imageBlock) return <ImageResultSection block={imageBlock} />

  if (result.is_error) return <GenericResultSection raw={raw} isError />

  if (nonEmpty.length === 1 && raw.length < 140) {
    return (
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
    )
  }

  if (toolName === 'Read') return <ReadResultSection raw={raw} filePath={filePath} />

  const persistedMatch = raw.match(/<persisted-output>[\s\S]*?Preview[^\n]*:\n([\s\S]*)/)
  if (persistedMatch) return <GenericResultSection raw={persistedMatch[1].trim()} note="· preview" />

  return <GenericResultSection raw={raw} />
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
          background: hovered
            ? 'linear-gradient(to right, rgba(139,128,240,0.14), rgba(139,128,240,0.04))'
            : 'linear-gradient(to right, var(--violet-glow), transparent)',
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
            fontFamily: "'IBM Plex Sans', sans-serif",
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
          background: 'linear-gradient(180deg, rgba(139,128,240,0.04) 0%, var(--surface) 40px)',
          borderTop: '1px solid rgba(139,128,240,0.15)',
          maxHeight: 420,
          overflowY: 'auto',
        }}>
          <p style={{
            fontFamily: "'IBM Plex Sans', sans-serif",
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
          background: `linear-gradient(to right, var(--violet)${hovered ? '22' : '14'} 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
          cursor: hasResult ? 'pointer' : 'default',
          userSelect: 'none', transition: 'background 0.15s ease',
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
          TASK
        </span>
        <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", color: 'var(--text)', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
  const c = 'var(--cyan)'
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
        background: 'linear-gradient(to right, rgba(34,211,238,0.10), var(--surface))',
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
            fontFamily: "'IBM Plex Sans', sans-serif",
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

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function ClaudeSystemCard({ block }: { block: ClaudeSystemBlock }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const { subtype, payload } = block
  const content = typeof payload.content === 'string' ? payload.content : ''
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
  const detailPreview = useMemo(() => {
    if (errorSummary) return apiErrorStatus ? `${errorSummary} (HTTP ${apiErrorStatus})` : errorSummary
    if (content.trim()) return content.replace(/\s+/g, ' ').trim()
    if (subtype === 'compact_boundary') return 'Conversation compacted'
    if (subtype === 'task_started' && typeof payload.description === 'string') return payload.description
    if (subtype === 'task_progress' && typeof payload.summary === 'string') return payload.summary
    if (subtype === 'task_updated') {
      if (typeof payload.summary === 'string') return payload.summary
      const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch as Record<string, unknown> : null
      if (typeof patch?.description === 'string') return patch.description
      if (typeof patch?.status === 'string') return `Task ${patch.status}`
    }
    if (subtype === 'task_notification' && typeof payload.summary === 'string') return payload.summary
    if (subtype === 'tool_progress' && typeof payload.tool_name === 'string') {
      return `${payload.tool_name} · ${typeof payload.elapsed_time_seconds === 'number' ? `${payload.elapsed_time_seconds}s` : 'running'}`
    }
    if (subtype === 'tool_use_summary' && typeof payload.summary === 'string') return payload.summary
    if (subtype === 'status' && typeof payload.status === 'string') return payload.status
    if (subtype === 'hook_started') {
      const hookName = typeof payload.hook_name === 'string' ? payload.hook_name : 'hook'
      const event = typeof payload.hook_event === 'string' ? payload.hook_event : ''
      return event ? `${hookName} ▸ ${event}` : hookName
    }
    if (subtype === 'hook_progress') {
      const hookName = typeof payload.hook_name === 'string' ? payload.hook_name : 'hook'
      const output = typeof payload.output === 'string' && payload.output ? payload.output
        : typeof payload.stdout === 'string' ? payload.stdout : ''
      return output ? `${hookName} · ${output.replace(/\s+/g, ' ').trim().slice(0, 120)}` : hookName
    }
    if (subtype === 'hook_response') {
      const hookName = typeof payload.hook_name === 'string' ? payload.hook_name : 'hook'
      const outcome = typeof payload.outcome === 'string' ? payload.outcome : ''
      return outcome ? `${hookName} ${outcome}` : hookName
    }
    if (subtype === 'memory_recall') {
      const memories = Array.isArray(payload.memories) ? payload.memories : []
      const mode = typeof payload.mode === 'string' ? payload.mode : ''
      const count = memories.length
      return `${count} memor${count === 1 ? 'y' : 'ies'}${mode ? ` · ${mode}` : ''}`
    }
    return 'Claude system event'
  }, [apiErrorStatus, content, errorSummary, payload.description, payload.elapsed_time_seconds, payload.hook_event, payload.hook_name, payload.level, payload.memories, payload.mode, payload.outcome, payload.output, payload.status, payload.stdout, payload.summary, payload.tool_name, subtype])
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
    : 'var(--text-3)'
  const badges = useMemo(() => {
    const nextBadges: string[] = []
    if (errorCode) nextBadges.push(errorCode)
    if (apiErrorStatus != null) nextBadges.push(`HTTP ${apiErrorStatus}`)
    if (typeof payload.status === 'string') nextBadges.push(payload.status)
    if (typeof payload.task_id === 'string') nextBadges.push(payload.task_id.slice(0, 8))
    if (typeof payload.tool_use_id === 'string') nextBadges.push(payload.tool_use_id.slice(0, 8))
    if (typeof payload.tool_name === 'string') nextBadges.push(payload.tool_name)
    if (typeof payload.hook_name === 'string') nextBadges.push(payload.hook_name)
    if (typeof payload.hook_event === 'string') nextBadges.push(payload.hook_event)
    if (typeof payload.outcome === 'string') nextBadges.push(payload.outcome)
    if (typeof payload.mcp_server_name === 'string') nextBadges.push(payload.mcp_server_name)
    if (typeof payload.subagent_type === 'string') nextBadges.push(payload.subagent_type)
    if (typeof payload.task_type === 'string' && payload.task_type !== payload.subagent_type) nextBadges.push(payload.task_type)
    if (subtype === 'memory_recall' && typeof payload.mode === 'string') nextBadges.push(payload.mode)
    if (subtype === 'compact_boundary' && payload.compact_metadata && typeof payload.compact_metadata === 'object') {
      const compact = payload.compact_metadata as { trigger?: unknown; pre_tokens?: unknown }
      if (typeof compact.trigger === 'string') nextBadges.push(compact.trigger)
      if (typeof compact.pre_tokens === 'number') nextBadges.push(`${fmtTokens(compact.pre_tokens)} pre`)
    }
    return nextBadges
  }, [apiErrorStatus, errorCode, payload.compact_metadata, payload.hook_event, payload.hook_name, payload.mcp_server_name, payload.mode, payload.outcome, payload.status, payload.subagent_type, payload.task_id, payload.task_type, payload.tool_name, payload.tool_use_id, subtype])

  const body = useMemo(() => {
    if (subtype === 'task_notification') return content || (typeof payload.result === 'string' ? payload.result : '')
    if (subtype === 'task_progress') {
      return [content, typeof payload.last_tool_name === 'string' ? `Last tool: ${payload.last_tool_name}` : ''].filter(Boolean).join('\n')
    }
    if (subtype === 'task_updated') {
      const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch as Record<string, unknown> : null
      const lines = [
        content,
        typeof patch?.description === 'string' ? `Description: ${patch.description}` : '',
        typeof patch?.status === 'string' ? `Status: ${patch.status}` : '',
        typeof patch?.error === 'string' ? `Error: ${patch.error}` : '',
        typeof patch?.total_paused_ms === 'number' ? `Paused: ${(patch.total_paused_ms / 1000).toFixed(1)}s` : '',
      ].filter(Boolean)
      return lines.join('\n')
    }
    if (subtype === 'hook_progress' || subtype === 'hook_response') {
      return [content, typeof payload.stdout === 'string' ? payload.stdout : '', typeof payload.stderr === 'string' ? payload.stderr : ''].filter(Boolean).join('\n\n')
    }
    if (subtype === 'memory_recall') {
      const memories = Array.isArray(payload.memories) ? payload.memories as Array<Record<string, unknown>> : []
      const lines = memories.map((m) => {
        const scope = typeof m.scope === 'string' ? m.scope : ''
        const path = typeof m.path === 'string' ? m.path : ''
        const memContent = typeof m.content === 'string' ? m.content : ''
        const header = scope ? `[${scope}] ${path}` : path
        return memContent ? `${header}\n${memContent}` : header
      })
      return lines.join('\n\n')
    }
    return content
  }, [content, payload.last_tool_name, payload.memories, payload.result, payload.stderr, payload.stdout, subtype])
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
          background: hovered
            ? `linear-gradient(to right, ${tone}22, var(--surface))`
            : `linear-gradient(to right, ${tone}14, var(--surface))`,
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
          fontFamily: "'IBM Plex Sans', sans-serif",
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
  return null
}

// ── Token usage formatting ────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ── Timeline message item ─────────────────────────────────────────────────────

const ROLE_STYLE = {
  assistant: { dot: 'var(--violet)', glow: 'var(--violet-glow)', labelColor: 'var(--violet)' },
  user:      { dot: 'var(--cyan)',   glow: 'var(--cyan-glow)',   label: 'USER',   labelColor: 'var(--cyan)'   },
  system:    { dot: 'var(--yellow)', glow: 'rgba(251,191,36,0.18)', label: 'SYSTEM', labelColor: 'var(--yellow)' },
} as const

export type MessageDensity = 'comfortable' | 'balanced' | 'dense'

type DensityConfig = { msgGap: number; blockGap: number; labelGap: number; dotGap: number }

function densityConfig(d: MessageDensity): DensityConfig {
  switch (d) {
    case 'comfortable': return { msgGap: 52, blockGap: 12, labelGap: 12, dotGap: 22 }
    case 'dense':       return { msgGap: 12, blockGap: 5,  labelGap: 6,  dotGap: 14 }
    default:            return { msgGap: 36, blockGap: 8,  labelGap: 10, dotGap: 18 }
  }
}

const MessageDensityContext = createContext<DensityConfig>(densityConfig('balanced'))
const SessionContext = createContext<string | undefined>(undefined)
export const LiveSubagentTextContext = createContext<Record<string, string>>({})
export const TaskActiveFormsContext = createContext<Map<string, string>>(new Map())

/**
 * Scan threaded messages for TaskCreate/TaskUpdate calls and build a
 * taskId → activeForm map reflecting the most recent activeForm set for each
 * task. Used by the TaskList renderer to substitute the present-continuous form
 * when a task is in_progress.
 */
export function buildTaskActiveFormsForWeb(messages: ThreadedMessage[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of messages) {
    for (const b of m.blocks) {
      if (b.type !== 'tool_thread') continue
      const name = b.toolUse.name
      if (name === 'TaskCreate') {
        const inp = b.toolUse.input as { activeForm?: string }
        const af = typeof inp.activeForm === 'string' ? inp.activeForm.trim() : ''
        if (!af || !b.result) continue
        const text = typeof b.result.content === 'string'
          ? b.result.content
          : Array.isArray(b.result.content)
          ? b.result.content.map((c) => (c && typeof c === 'object' && 'text' in c && typeof (c as { text: unknown }).text === 'string') ? (c as { text: string }).text : '').join('')
          : ''
        try {
          const parsed = JSON.parse(text) as { task?: { id?: string } }
          const id = parsed?.task?.id
          if (typeof id === 'string' && id) map.set(id, af)
        } catch { /* skip */ }
      } else if (name === 'TaskUpdate') {
        const inp = b.toolUse.input as { taskId?: string; activeForm?: string }
        const af = typeof inp.activeForm === 'string' ? inp.activeForm.trim() : ''
        if (typeof inp.taskId === 'string' && af) map.set(inp.taskId, af)
      }
    }
  }
  return map
}

export function MessageDensityProvider({ density, children }: { density: MessageDensity; children: React.ReactNode }) {
  const value = useMemo(() => densityConfig(density), [density])
  return (
    <MessageDensityContext.Provider value={value}>
      {children}
    </MessageDensityContext.Provider>
  )
}

function MessageItemInner({ message, showSession }: { message: ThreadedMessage; showSession?: boolean }) {
  const [hydrated, setHydrated] = useState(false)
  const dc = use(MessageDensityContext)
  const style = ROLE_STYLE[message.role]
  const roleLabel = message.role === 'assistant'
    ? getAssistantLabel(message.provider)
    : ROLE_STYLE[message.role].label

  useEffect(() => {
    setHydrated(true)
  }, [])

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
            boxShadow: `0 0 0 2px var(--bg), 0 0 10px 3px ${style.glow}`,
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
          {message.origin?.kind && message.origin.kind !== 'task-notification' && (() => {
            const isSubagent = message.origin.kind.startsWith('subagent:')
            const label = isSubagent ? '↪ SUBAGENT' : message.origin.kind.toUpperCase()
            const color = isSubagent ? 'var(--t-agent)' : 'var(--t-other)'
            const bg    = isSubagent ? 'rgba(244,114,182,0.08)' : 'rgba(139,128,240,0.08)'
            const bdr   = isSubagent ? '1px solid rgba(244,114,182,0.22)' : '1px solid rgba(139,128,240,0.2)'
            return (
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color, background: bg, border: bdr, borderRadius: 3, padding: '1px 5px' }}>
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
