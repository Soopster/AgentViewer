'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { renderMermaidSVG } from 'beautiful-mermaid'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import highlightFactory from 'react-syntax-highlighter/dist/esm/highlight'
import { refractor } from 'refractor/core'
import type { ReactElement, ReactNode } from 'react'
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

// ── Cached / deferred syntax highlighting ────────────────────────────────────
// react-syntax-highlighter re-tokenizes the whole code string on every mount
// (its SyntaxHighlighter is a plain function component — see
// node_modules/react-syntax-highlighter/dist/esm/highlight.js). Virtualized
// rows unmount/remount as they leave/re-enter the scroll window, so scrolling
// a code-heavy transcript re-ran Prism over every visible diff/fence each
// pass. Mirror the factory react-syntax-highlighter uses internally
// (highlight(refractor, {})) and cache its rendered element by
// theme|language|code, so a remount is a Map hit instead of a re-tokenize.
const renderSyntaxHighlight = highlightFactory(refractor, {}) as (
  props: Record<string, unknown>,
) => ReactElement

const CODE_ELEMENT_CACHE_MAX = 800
const codeElementCache = new Map<string, ReactElement | null>()

// Small fences highlight synchronously (cheap, cache-warm). Larger blocks
// render unhighlighted first and hydrate one rAF later so a cold Prism pass
// never blocks the frame that mounted the row. Above these guards we skip
// highlighting entirely (plain block) — mirrors agentsview's HIGHLIGHT_MAX_BYTES.
const SYNTAX_SYNC_MAX_CHARS = 6000
const HIGHLIGHT_MAX_BYTES = 50_000
const HIGHLIGHT_MAX_LINES = 800

function shouldHighlightSyntax(code: string): boolean {
  if (code.length > HIGHLIGHT_MAX_BYTES) return false
  let lines = 1
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) lines += 1
    if (lines > HIGHLIGHT_MAX_LINES) return false
  }
  return true
}

function buildCachedCodeElement(key: string, build: () => ReactElement | null): ReactElement | null {
  const cached = codeElementCache.get(key)
  if (cached !== undefined) return cached
  let element: ReactElement | null = null
  try {
    element = build()
  } catch {
    element = null
  }
  if (codeElementCache.size >= CODE_ELEMENT_CACHE_MAX) {
    const oldestKey = codeElementCache.keys().next().value as string | undefined
    if (oldestKey !== undefined) codeElementCache.delete(oldestKey)
  }
  codeElementCache.set(key, element)
  return element
}

/**
 * Returns a cached highlighted element for `cachedKey`. Cold-cache digs larger
 * than `SYNTAX_SYNC_MAX_CHARS` are deferred one animation frame; `eligible`
 * false (over the size guards) always yields null so callers render a plain
 * block. Returns null while a deferred build is pending.
 *
 * Callers pass `key={cachedKey}` on the leaf component so a code change
 * remounts the leaf and this state resets — no stale element lingers across
 * prop updates.
 */
function useCachedCodeElement(
  cachedKey: string,
  code: string,
  eligible: boolean,
  build: () => ReactElement | null,
): ReactElement | null {
  const needsDefer = code.length > SYNTAX_SYNC_MAX_CHARS

  const [element, setElement] = useState<ReactElement | null>(() => {
    if (!eligible) return null
    const cached = codeElementCache.get(cachedKey)
    if (cached !== undefined) return cached
    return needsDefer ? null : buildCachedCodeElement(cachedKey, build)
  })

  useEffect(() => {
    let cancelled = false
    if (!eligible) {
      setElement(null)
      return
    }
    const cached = codeElementCache.get(cachedKey)
    if (cached !== undefined) {
      setElement(cached)
      return
    }
    if (!needsDefer) {
      setElement(buildCachedCodeElement(cachedKey, build))
      return
    }
    const frame = requestAnimationFrame(() => {
      if (cancelled) return
      setElement(buildCachedCodeElement(cachedKey, build))
    })
    return () => { cancelled = true; cancelAnimationFrame(frame) }
  }, [build, cachedKey, eligible, needsDefer])

  return element
}

function CachedSyntaxElement({
  eligible,
  code,
  cachedKey,
  build,
  fallback,
}: {
  eligible: boolean
  code: string
  cachedKey: string
  build: () => ReactElement | null
  fallback: ReactNode
}) {
  const element = useCachedCodeElement(cachedKey, code, eligible, build)
  if (element === null) return <>{fallback}</>
  return element
}

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

// Shared wrapper styling for the highlighted fence/viewer so the cache key
// stays stable (the SyntaxHighlighter <pre> output is identical for equal
// language|code|style|customStyle).
const FENCE_PRE_STYLE = { margin: 0, padding: '12px 16px', fontSize: 13, lineHeight: 1.65, overflowX: 'auto' } as const

function PlainFence({ language, code }: { language?: string; code: string }) {
  return (
    <div style={FENCE_PRE_STYLE}>
      <pre style={{
        margin: 0,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 13,
        lineHeight: 1.6,
        color: 'var(--text-2)',
        whiteSpace: 'pre',
      }}>
        {code}
      </pre>
    </div>
  )
}

export const FencedCodeBlock = memo(function FencedCodeBlock({
  language,
  codeString,
  margin = '10px 0',
}: {
  language: string
  codeString: string
  margin?: string | number
}) {
  const codeStyle = useCodeHighlighterStyle()
  const { themeId } = useCodeTheme()
  const normalized = normalizeCode(codeString)
  const cacheKey = `fence|${themeId}|${language ?? ''}|${codeString}`
  const eligible = shouldHighlightSyntax(codeString)

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
      <CachedSyntaxElement
        key={cacheKey}
        eligible={eligible}
        code={codeString}
        cachedKey={cacheKey}
        build={() => renderSyntaxHighlight({
          language: language || undefined,
          style: codeStyle,
          customStyle: FENCE_PRE_STYLE,
          children: normalized,
        })}
        fallback={<PlainFence language={language} code={normalized} />}
      />
    </div>
  )
})

export const MermaidDiagram = memo(function MermaidDiagram({ codeString }: { codeString: string }) {
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
})

const VIEWER_PRE_STYLE = { margin: 0, padding: '10px 14px', fontSize: 13, lineHeight: 1.6 }
const VIEWER_CODE_TAG_STYLE = { fontFamily: "'IBM Plex Mono', monospace" }
const VIEWER_LINE_NUMBER_STYLE = {
  minWidth: '2.6em',
  paddingRight: '0.9em',
  color: 'var(--text-3)',
  userSelect: 'none',
}

export const CodeViewer = memo(function CodeViewer({
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
  const { themeId } = useCodeTheme()
  const resolvedLanguage = language ?? detectLanguageFromPath(filePath)
  const normalized = normalizeCode(code)
  // Include every prop that changes the produced <pre> tree in the cache key.
  const inlineOpts = [
    showLineNumbers ? 1 : 0,
    startingLineNumber ?? 0,
    maxHeight ?? 0,
    expandToContentWidth ? 1 : 0,
  ].join(',')
  const cacheKey = `viewer|${themeId}|${resolvedLanguage ?? ''}|${inlineOpts}|${code}`
  const eligible = shouldHighlightSyntax(code)

  const customStyle = {
    ...VIEWER_PRE_STYLE,
    width: expandToContentWidth ? 'max-content' : undefined,
    minWidth: expandToContentWidth ? '100%' : undefined,
    overflowX: expandToContentWidth ? 'visible' : 'auto',
    overflowY: maxHeight ? 'auto' : undefined,
    maxHeight,
  }

  const fallback = (
    <pre style={{
      margin: 0,
      padding: '10px 14px',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 13,
      lineHeight: 1.6,
      color: 'var(--text-2)',
      whiteSpace: 'pre',
      overflowX: expandToContentWidth ? 'visible' : 'auto',
      overflowY: maxHeight ? 'auto' : undefined,
      maxHeight,
    }}>
      {normalized}
    </pre>
  )

  return (
    <CachedSyntaxElement
      key={cacheKey}
      eligible={eligible}
      code={code}
      cachedKey={cacheKey}
      build={() => renderSyntaxHighlight({
        language: resolvedLanguage || undefined,
        style: codeStyle,
        showLineNumbers,
        startingLineNumber,
        wrapLongLines: false,
        customStyle,
        codeTagProps: { style: VIEWER_CODE_TAG_STYLE },
        lineNumberStyle: VIEWER_LINE_NUMBER_STYLE,
        children: normalized,
      })}
      fallback={fallback}
    />
  )
})

export const DiffView = memo(function DiffView({
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
})
