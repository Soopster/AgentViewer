'use client'

import { useMemo } from 'react'
import { renderMermaidSVG } from 'beautiful-mermaid'
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
import { pathBasename as basename } from '@/lib/projectPaths'
import { getCodeThemeStyle } from '@/lib/codeThemeStyles'
import { useCodeTheme } from './CodeThemeContext'
import type { ReactNode } from 'react'
import type { SelectedLineRange } from '@pierre/diffs'
import { PierreFileDiffView, type PierreAnnotationMetadata, type PierreDiffAnnotation, type PierreDiffPresentation } from './PierreDiffView'

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

function useCodeHighlighterStyle() {
  const { themeId } = useCodeTheme()
  return getCodeThemeStyle(themeId)
}

export function FencedCodeBlock({
  language,
  codeString,
  margin = '10px 0',
}: {
  language: string
  codeString: string
  margin?: string | number
}) {
  const codeStyle = useCodeHighlighterStyle()

  return (
    <div style={{ margin, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
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

export function MermaidDiagram({ codeString }: { codeString: string }) {
  const rendered = useMemo(() => {
    try {
      return {
        svg: renderMermaidSVG(codeString, {
          bg: 'var(--surface)',
          fg: 'var(--text)',
          line: 'var(--text-3)',
          accent: 'var(--violet)',
          muted: 'var(--text-3)',
          surface: 'var(--surface-2)',
          border: 'var(--border-2)',
          font: "'IBM Plex Sans', sans-serif",
          transparent: true,
        }),
        error: '',
      }
    } catch (err) {
      return {
        svg: '',
        error: err instanceof Error ? err.message : 'Unable to render Mermaid diagram.',
      }
    }
  }, [codeString])

  if (rendered.error) {
    return (
      <div>
        <div style={{
          margin: '10px 0 0',
          padding: '8px 10px',
          border: '1px solid rgba(248,113,113,0.26)',
          borderRadius: '6px 6px 0 0',
          background: 'rgba(248,113,113,0.08)',
          color: 'var(--red, #f87171)',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          lineHeight: 1.5,
        }}>
          Mermaid render failed: {rendered.error}
        </div>
        <FencedCodeBlock language="mermaid" codeString={codeString} />
      </div>
    )
  }

  return (
    <div style={{ margin: '10px 0' }}>
      <div
        style={{
          padding: 12,
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          overflowX: 'auto',
        }}
      >
        <div
          className="agent-viewer-mermaid"
          style={{ minWidth: 0 }}
          dangerouslySetInnerHTML={{ __html: rendered.svg }}
        />
      </div>
      <details style={{
        marginTop: 6,
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
      }}>
        <summary style={{
          cursor: 'pointer',
          padding: '6px 10px',
          color: 'var(--text-3)',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          letterSpacing: '0.05em',
          userSelect: 'none',
        }}>
          Mermaid source
        </summary>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <FencedCodeBlock language="mermaid" codeString={codeString} margin={0} />
        </div>
      </details>
    </div>
  )
}

export function CodeViewer({
  code,
  filePath,
  language,
  maxHeight,
  showLineNumbers = false,
  startingLineNumber,
  expandToContentWidth = false,
}: {
  code: string
  filePath?: string
  language?: string
  maxHeight?: number
  showLineNumbers?: boolean
  startingLineNumber?: number
  expandToContentWidth?: boolean
}) {
  const codeStyle = useCodeHighlighterStyle()
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
        width: expandToContentWidth ? 'max-content' : undefined,
        minWidth: expandToContentWidth ? '100%' : undefined,
        overflowX: expandToContentWidth ? 'visible' : 'auto',
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

export function DiffView({
  oldStr,
  newStr,
  filePath,
  presentation,
  selectedLines,
  onSelectedLinesChange,
  lineAnnotations,
  renderAnnotation,
  onGutterUtilityClick,
}: {
  oldStr: string
  newStr: string
  filePath?: string
  presentation?: PierreDiffPresentation
  selectedLines?: SelectedLineRange | null
  onSelectedLinesChange?: (selection: SelectedLineRange | null) => void
  lineAnnotations?: PierreDiffAnnotation<PierreAnnotationMetadata>[]
  renderAnnotation?: (annotation: PierreDiffAnnotation<PierreAnnotationMetadata>) => ReactNode
  onGutterUtilityClick?: (range: SelectedLineRange) => void
}) {
  return (
    <PierreFileDiffView
      oldStr={oldStr}
      newStr={newStr}
      filePath={filePath}
      maxHeight={500}
      presentation={presentation}
      selectedLines={selectedLines}
      onSelectedLinesChange={onSelectedLinesChange}
      lineAnnotations={lineAnnotations}
      renderAnnotation={renderAnnotation}
      onGutterUtilityClick={onGutterUtilityClick}
    />
  )
}
