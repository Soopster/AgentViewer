'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { pathBasename as basename } from '@/lib/projectPaths'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { diffLines } from 'diff'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import dart from 'react-syntax-highlighter/dist/esm/languages/prism/dart'
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff'
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import ini from 'react-syntax-highlighter/dist/esm/languages/prism/ini'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php'
import powershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import scss from 'react-syntax-highlighter/dist/esm/languages/prism/scss'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import type { Components } from 'react-markdown'
import type { ThreadedMessage, ThreadedBlock, ToolThread, TaskNotificationBlock, SystemReminderBlock, SlashCommandBlock, LocalCommandStdoutBlock, ClaudeSystemBlock } from '@/lib/threading'
import type { TextBlock, ThinkingBlock, ToolResultBlock, ImageBlock } from '@/lib/types'
import { getAssistantLabel } from '@/lib/provider'
import { useCodeTheme } from './CodeThemeContext'

SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('sh', bash)
SyntaxHighlighter.registerLanguage('zsh', bash)
SyntaxHighlighter.registerLanguage('shell', bash)
SyntaxHighlighter.registerLanguage('c', c)
SyntaxHighlighter.registerLanguage('cpp', cpp)
SyntaxHighlighter.registerLanguage('csharp', csharp)
SyntaxHighlighter.registerLanguage('cs', csharp)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('dart', dart)
SyntaxHighlighter.registerLanguage('scss', scss)
SyntaxHighlighter.registerLanguage('diff', diff)
SyntaxHighlighter.registerLanguage('dockerfile', docker)
SyntaxHighlighter.registerLanguage('docker', docker)
SyntaxHighlighter.registerLanguage('go', go)
SyntaxHighlighter.registerLanguage('java', java)
SyntaxHighlighter.registerLanguage('ini', ini)
SyntaxHighlighter.registerLanguage('toml', ini)
SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('js', javascript)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('jsx', jsx)
SyntaxHighlighter.registerLanguage('kotlin', kotlin)
SyntaxHighlighter.registerLanguage('kt', kotlin)
SyntaxHighlighter.registerLanguage('markdown', markdown)
SyntaxHighlighter.registerLanguage('md', markdown)
SyntaxHighlighter.registerLanguage('html', markup)
SyntaxHighlighter.registerLanguage('xml', markup)
SyntaxHighlighter.registerLanguage('svg', markup)
SyntaxHighlighter.registerLanguage('php', php)
SyntaxHighlighter.registerLanguage('powershell', powershell)
SyntaxHighlighter.registerLanguage('ps1', powershell)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('py', python)
SyntaxHighlighter.registerLanguage('ruby', ruby)
SyntaxHighlighter.registerLanguage('rb', ruby)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('rs', rust)
SyntaxHighlighter.registerLanguage('sql', sql)
SyntaxHighlighter.registerLanguage('swift', swift)
SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('ts', typescript)
SyntaxHighlighter.registerLanguage('yaml', yaml)
SyntaxHighlighter.registerLanguage('yml', yaml)

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

function MarkdownCodeBlock({ className, children, ...rest }: React.ComponentPropsWithoutRef<'code'>) {
  const { style: codeStyle } = useCodeTheme()
  const language = className?.replace('language-', '') ?? ''
  const isFenced = !!className
  if (isFenced) {
    const codeString = String(children).replace(/\n$/, '')
    return (
      <div style={{ margin: '10px 0', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {language && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            padding: '3px 12px',
            background: 'var(--surface-2)',
            borderBottom: '1px solid var(--border)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10, color: 'var(--text-3)',
            letterSpacing: '0.06em',
          }}>
            {language}
          </div>
        )}
        <SyntaxHighlighter
          language={language || undefined}
          style={codeStyle}
          customStyle={{
            margin: 0,
            padding: '12px 16px',
            fontSize: 13,
            lineHeight: 1.65,
            overflowX: 'auto',
          }}
        >
          {codeString}
        </SyntaxHighlighter>
      </div>
    )
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
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />,
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

function normalizeCode(code: string): string {
  return code.endsWith('\n') ? code.slice(0, -1) : code
}

function inferStartingLineNumber(lines: Array<{ num: string }>): number | undefined {
  const first = lines.find(line => /^\d+$/.test(line.num))
  return first ? Number(first.num) : undefined
}

function shouldShowLineNumbers(lines: Array<{ num: string }>): boolean {
  const numbered = lines.filter(line => line.num !== '')
  return numbered.length > 0 && numbered.every(line => /^\d+$/.test(line.num))
}

function CodeViewer({
  code,
  filePath,
  language,
  maxHeight,
  showLineNumbers = false,
  startingLineNumber,
}: {
  code: string
  filePath?: string
  language?: string
  maxHeight?: number
  showLineNumbers?: boolean
  startingLineNumber?: number
}) {
  const { style: codeStyle } = useCodeTheme()
  const resolvedLanguage = language ?? detectLanguageFromPath(filePath)

  return (
    <SyntaxHighlighter
      language={resolvedLanguage || undefined}
      style={codeStyle}
      showLineNumbers={showLineNumbers}
      startingLineNumber={startingLineNumber}
      wrapLongLines={false}
      customStyle={{
        margin: 0,
        padding: '10px 14px',
        fontSize: 13,
        lineHeight: 1.6,
        overflowX: 'auto',
        overflowY: maxHeight ? 'auto' : undefined,
        maxHeight,
      }}
      codeTagProps={{ style: { fontFamily: "'IBM Plex Mono', monospace" } }}
      lineNumberStyle={{
        minWidth: '2.6em',
        paddingRight: '0.9em',
        color: 'var(--text-3)',
        userSelect: 'none',
      }}
    >
      {normalizeCode(code)}
    </SyntaxHighlighter>
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

function DiffView({ oldStr, newStr, filePath }: { oldStr: string; newStr: string; filePath?: string }) {
  const { style: codeStyle } = useCodeTheme()
  const language = detectLanguageFromPath(filePath)
  const changes = useMemo(() => diffLines(oldStr, newStr), [oldStr, newStr])

  return (
    <div style={{ overflowX: 'auto', maxHeight: 500, overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
      {changes.map((change, ci) => {
        const chunkLines = change.value.split('\n')
        if (chunkLines[chunkLines.length - 1] === '') chunkLines.pop()
        if (chunkLines.length === 0) return null

        const isAdd = change.added
        const isDel = change.removed
        const sign      = isAdd ? '+' : isDel ? '−' : ' '
        const signColor = isAdd ? 'var(--green)' : isDel ? 'var(--red)' : 'var(--text-3)'
        const bgTint    = isAdd ? 'rgba(45,212,160,0.10)' : isDel ? 'rgba(240,96,96,0.10)' : 'transparent'
        const gutterBg  = isAdd ? 'rgba(45,212,160,0.18)' : isDel ? 'rgba(240,96,96,0.18)' : 'var(--surface-2)'
        const borderL   = isAdd ? '2px solid rgba(45,212,160,0.45)' : isDel ? '2px solid rgba(240,96,96,0.45)' : '2px solid transparent'

        return (
          <div key={ci} style={{ display: 'flex', borderLeft: borderL }}>
            {/* +/− gutter */}
            <div style={{
              flexShrink: 0, width: 22,
              background: gutterBg,
              borderRight: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              paddingTop: 1,
            }}>
              {chunkLines.map((_, li) => (
                <span key={li} style={{
                  display: 'block',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11, lineHeight: '1.6em',
                  color: signColor, userSelect: 'none',
                }}>
                  {sign}
                </span>
              ))}
            </div>
            {/* Highlighted code */}
            <div style={{ flex: 1, minWidth: 0, background: bgTint }}>
              <SyntaxHighlighter
                language={language || undefined}
                style={codeStyle}
                wrapLongLines={false}
                customStyle={{
                  margin: 0, padding: '0 10px',
                  // Transparent only for tinted chunks so bgTint shows through;
                  // context chunks let the Prism theme control its own background.
                  ...(isAdd || isDel ? { background: 'transparent' } : {}),
                  fontSize: 13, lineHeight: 1.6,
                  overflowX: 'visible',
                }}
                codeTagProps={{ style: { fontFamily: "'IBM Plex Mono', monospace" } }}
              >
                {chunkLines.join('\n')}
              </SyntaxHighlighter>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Edit tool card ────────────────────────────────────────────────────────────

function EditToolCard({ thread }: { thread: ToolThread }) {
  const [open, setOpen] = useState(true)
  const [hovered, setHovered] = useState(false)
  const { toolUse, result } = thread
  const input = toolUse.input as { file_path?: string; old_string?: string; new_string?: string }
  const filePath = input.file_path ?? ''
  const oldStr   = input.old_string ?? ''
  const newStr   = input.new_string ?? ''
  const delta    = newStr.split('\n').length - oldStr.split('\n').length
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
  const [open, setOpen] = useState(true)
  const [hovered, setHovered] = useState(false)
  const { toolUse, result } = thread
  const input = toolUse.input as {
    status?: string
    changes?: Array<{ path?: string; kind?: unknown; diff?: string }>
  }
  const changes = input.changes ?? []
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
          {JSON.stringify(toolUse.input, null, 2)}
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
  const raw      = thread.result && !thread.result.is_error ? resultToString(thread.result.content) : ''
  const lineCount = raw ? raw.split('\n').filter(l => l.trim()).length : null
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
  const raw     = thread.result && !thread.result.is_error ? resultToString(thread.result.content) : ''
  const fileCount = raw ? raw.split('\n').filter(l => l.trim()).length : null
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

function AgentCard({ thread }: { thread: ToolThread }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
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
  const resultText = (parsed?.content as Array<{ text?: string }>)?.[0]?.text
    ?? (parsed?.message as string)
    ?? ''
  const totalTokens       = parsed?.totalTokens        as number | undefined
  const totalToolUseCount = parsed?.totalToolUseCount   as number | undefined
  const totalDurationMs   = parsed?.totalDurationMs     as number | undefined
  const outputFile        = parsed?.outputFile          as string | undefined

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

      {/* Stats row for completed synchronous agents */}
      {status === 'completed' && (totalTokens != null || totalToolUseCount != null || totalDurationMs != null) && (
        <div style={{ display: 'flex', gap: 16, padding: '3px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
          {totalTokens    != null && <span>⬡ {totalTokens.toLocaleString()} tok</span>}
          {totalToolUseCount != null && <span>⚙ {totalToolUseCount} tools</span>}
          {totalDurationMs   != null && <span>⏱ {(totalDurationMs / 1000).toFixed(1)}s</span>}
          {input.model && <span>{input.model}</span>}
        </div>
      )}

      {/* Output file path for async agents */}
      {status === 'async_launched' && outputFile && (
        <div style={{ padding: '3px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
          {outputFile}
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
  const [open, setOpen] = useState(true)
  const [hovered, setHovered] = useState(false)
  const { toolUse, result } = thread
  const input = toolUse.input as {
    file_path?: string
    edits?: { old_string?: string; new_string?: string; replace_all?: boolean }[]
  }
  const filePath = input.file_path ?? ''
  const edits = input.edits ?? []
  const c = toolColor('MultiEdit')

  const totalDelta = edits.reduce((acc, e) => {
    const oldLines = (e.old_string ?? '').split('\n').length
    const newLines = (e.new_string ?? '').split('\n').length
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

type TaskRecord = { id?: string; subject?: string; status?: string; owner?: string; blockedBy?: string[] }

const TASK_ICON: Record<string, string>  = { completed: '✓', in_progress: '◐', pending: '○' }
const TASK_COLOR: Record<string, string> = { completed: 'var(--green)', in_progress: 'var(--amber)', pending: 'var(--text-3)' }

function TaskCard({ thread }: { thread: ToolThread }) {
  const [hovered, setHovered] = useState(false)
  const { toolUse, result } = thread
  const name  = toolUse.name
  const c     = 'var(--amber)'
  const input = toolUse.input as {
    subject?: string; description?: string
    taskId?: string; status?: string; owner?: string
    addBlockedBy?: string[]; addBlocks?: string[]
  }
  const raw = result ? resultToString(result.content) : ''

  let tasks: TaskRecord[] | null = null
  if (name === 'TaskList' && raw) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) tasks = p as TaskRecord[] } catch { /* not JSON */ }
  }

  const headerContent = (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
        background: `linear-gradient(to right, rgba(245,158,11,${hovered ? '0.14' : '0.08'}) 0%, var(--surface) ${hovered ? '65%' : '50%'})`,
        transition: 'background 0.15s ease',
      }}
    >
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: c, fontWeight: 500, letterSpacing: '0.06em', flexShrink: 0 }}>
        TASK
      </span>
      {name === 'TaskCreate' && (
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {input.subject ?? ''}
        </span>
      )}
      {name === 'TaskList' && (
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text-2)', fontSize: 11, flex: 1 }}>
          {tasks !== null ? `${tasks.length} task${tasks.length !== 1 ? 's' : ''}` : 'list'}
        </span>
      )}
      {(name === 'TaskGet' || name === 'TaskUpdate' || name === 'TaskStop') && (
        <>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)', fontSize: 13, flexShrink: 0 }}>
            #{input.taskId ?? ''}
          </span>
          {name === 'TaskUpdate' && input.status && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: TASK_COLOR[input.status] ?? 'var(--text-3)', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px', flexShrink: 0 }}>
              {input.status}
            </span>
          )}
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

  // TaskList with parsed tasks: custom layout
  if (name === 'TaskList' && tasks !== null) {
    return (
      <div style={{ border: '1px solid var(--border)', borderLeft: `2px solid ${c}`, borderRadius: 6, overflow: 'hidden', fontSize: 13, marginTop: 4 }}>
        {headerContent}
        {tasks.length > 0 && (
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5, background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
            {tasks.map((t, i) => {
              const st = t.status ?? 'pending'
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: TASK_COLOR[st] ?? 'var(--text-3)', flexShrink: 0, marginTop: 1, width: 12, textAlign: 'center' }}>
                    {TASK_ICON[st] ?? '○'}
                  </span>
                  <span style={{ fontSize: 13, color: st === 'completed' ? 'var(--text-3)' : 'var(--text)', lineHeight: 1.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.subject ?? t.id ?? '—'}
                  </span>
                  {t.id && (
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
                      #{t.id}
                    </span>
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
    <CardShell color={c} result={result} toolName={name} header={headerContent} />
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
  const hidden = expanded ? 0 : Math.max(0, totalLines - LIMIT)

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
      {hidden > 0 && (
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

  const parts = splitResultParts(raw)
  const hasReminders = parts.some(p => p.kind === 'system_reminder')

  // Pre-compute visible lines across text parts (system-reminder parts don't count toward limit)
  let budget = expanded ? Infinity : LIMIT
  const processedParts = parts.map(part => {
    if (part.kind === 'system_reminder') return { ...part, visibleLines: [] as string[] }
    const lines = part.text.split('\n')
    const visibleLines = budget > 0 ? lines.slice(0, budget) : []
    budget = Math.max(0, budget - lines.length)
    return { ...part, visibleLines }
  })

  const totalTextLines = parts
    .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
    .reduce((n, p) => n + p.text.split('\n').length, 0)
  const hidden = expanded ? 0 : Math.max(0, totalTextLines - LIMIT)

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

      {hidden > 0 && (
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
  const detailPreview = useMemo(() => {
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
    return 'Claude system event'
  }, [content, payload.description, payload.elapsed_time_seconds, payload.level, payload.status, payload.summary, payload.tool_name, subtype])
  const tone = payload.level === 'warning'
    ? 'var(--yellow)'
    : subtype === 'compact_boundary'
    ? 'var(--violet)'
    : subtype.startsWith('task_')
    ? 'var(--violet)'
    : subtype.startsWith('hook_')
    ? 'var(--cyan)'
    : subtype === 'tool_progress' || subtype === 'tool_use_summary'
    ? 'var(--cyan)'
    : 'var(--text-3)'
  const badges = useMemo(() => {
    const nextBadges: string[] = []
    if (typeof payload.status === 'string') nextBadges.push(payload.status)
    if (typeof payload.task_id === 'string') nextBadges.push(payload.task_id.slice(0, 8))
    if (typeof payload.tool_use_id === 'string') nextBadges.push(payload.tool_use_id.slice(0, 8))
    if (typeof payload.tool_name === 'string') nextBadges.push(payload.tool_name)
    if (typeof payload.hook_name === 'string') nextBadges.push(payload.hook_name)
    if (typeof payload.mcp_server_name === 'string') nextBadges.push(payload.mcp_server_name)
    if (subtype === 'compact_boundary' && payload.compact_metadata && typeof payload.compact_metadata === 'object') {
      const compact = payload.compact_metadata as { trigger?: unknown; pre_tokens?: unknown }
      if (typeof compact.trigger === 'string') nextBadges.push(compact.trigger)
      if (typeof compact.pre_tokens === 'number') nextBadges.push(`${fmtTokens(compact.pre_tokens)} pre`)
    }
    return nextBadges
  }, [payload.compact_metadata, payload.hook_name, payload.mcp_server_name, payload.status, payload.task_id, payload.tool_name, payload.tool_use_id, subtype])

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
    if (subtype === 'hook_response') {
      return [content, typeof payload.stdout === 'string' ? payload.stdout : '', typeof payload.stderr === 'string' ? payload.stderr : ''].filter(Boolean).join('\n\n')
    }
    return content
  }, [content, payload.last_tool_name, payload.result, payload.stderr, payload.stdout, subtype])
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

function MessageItemInner({ message, showSession }: { message: ThreadedMessage; showSession?: boolean }) {
  const [hydrated, setHydrated] = useState(false)
  const style = ROLE_STYLE[message.role]
  const roleLabel = message.role === 'assistant'
    ? getAssistantLabel(message.provider)
    : ROLE_STYLE[message.role].label

  useEffect(() => {
    setHydrated(true)
  }, [])

  return (
    <div className={`msg msg--${message.role}`} style={{ display: 'flex', gap: 18, marginBottom: 36 }}>
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
        <div className="msg-label" style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
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
          {message.origin?.kind && message.origin.kind !== 'task-notification' && (
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.1em',
                color: 'var(--t-other)',
                background: 'rgba(139,128,240,0.08)',
                border: '1px solid rgba(139,128,240,0.2)',
                borderRadius: 3,
                padding: '1px 5px',
              }}
            >
              {message.origin.kind.toUpperCase()}
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
        <div className="msg-blocks" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {message.blocks.map((block, i) => renderBlock(block, i))}
        </div>
      </div>
    </div>
  )
}

const MessageItem = memo(MessageItemInner, (prev, next) =>
  prev.showSession === next.showSession
  && prev.message === next.message
)

export default MessageItem
