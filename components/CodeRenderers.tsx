'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { renderMermaidSVG } from 'beautiful-mermaid'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { plainCodeHighlight, renderCodeHighlight } from './renderCodeHighlight'
import { pathBasename as basename } from '@/lib/projectPaths'
import { getCodeThemeStyle } from '@/lib/codeThemeStyles'
import { useCodeTheme } from './CodeThemeContext'
import type { SelectedLineRange } from '@pierre/diffs'
import { PierreFileDiffView, type PierreAnnotationMetadata, type PierreDiffAnnotation, type PierreDiffPresentation } from './PierreDiffView'

// Cache highlighted elements across virtualized remounts. Identical requests
// share asynchronous initialization; large cold blocks wait until the next frame.
const CODE_ELEMENT_CACHE_MAX = 800
const codeElementCache = new Map<string, ReactElement | null>()

// Preserve the existing size guards and defer larger cold blocks.
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

const codeElementFlights = new Map<string, Promise<ReactElement | null>>()

function buildCachedCodeElement(key: string, build: () => Promise<ReactElement | null>): Promise<ReactElement | null> {
  const cached = codeElementCache.get(key)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = codeElementFlights.get(key)
  if (pending) return pending
  const promise = Promise.resolve().then(build).catch(() => null).then(element => {
    if (codeElementCache.size >= CODE_ELEMENT_CACHE_MAX) {
      const oldest = codeElementCache.keys().next().value
      if (oldest !== undefined) codeElementCache.delete(oldest)
    }
    codeElementCache.set(key, element)
    return element
  }).finally(() => { codeElementFlights.delete(key) })
  codeElementFlights.set(key, promise)
  return promise
}

function useCachedCodeElement(
  cachedKey: string,
  code: string,
  eligible: boolean,
  build: () => Promise<ReactElement | null>,
): ReactElement | null {
  const [loaded, setLoaded] = useState<{ key: string; element: ReactElement | null } | null>(null)
  // Leaves are keyed by every render input. Keep their initial builder stable
  // across unrelated rerenders instead of restarting asynchronous highlighting.
  const [buildElement] = useState(() => build)
  useEffect(() => {
    if (!eligible || codeElementCache.has(cachedKey)) return
    let cancelled = false
    const run = () => { void buildCachedCodeElement(cachedKey, buildElement).then(element => {
      if (!cancelled) setLoaded({ key: cachedKey, element })
    }) }
    const frame = code.length > SYNTAX_SYNC_MAX_CHARS ? requestAnimationFrame(run) : undefined
    if (frame === undefined) run()
    return () => { cancelled = true; if (frame !== undefined) cancelAnimationFrame(frame) }
  }, [buildElement, cachedKey, code.length, eligible])
  if (!eligible) return null
  return codeElementCache.get(cachedKey) ?? (loaded?.key === cachedKey ? loaded.element : null)
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
  build: () => Promise<ReactElement | null>
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

// Keep highlighted and loading states at the same measured line height.
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
        build={() => renderCodeHighlight({
          language: language || undefined,
          style: codeStyle,
          customStyle: FENCE_PRE_STYLE,
          children: normalized,
        })}
        fallback={eligible ? plainCodeHighlight({ children: normalized, style: codeStyle, customStyle: FENCE_PRE_STYLE }) : <PlainFence language={language} code={normalized} />}
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
const VIEWER_LINE_NUMBER_STYLE: CSSProperties = {
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

  const customStyle: CSSProperties = {
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
      build={() => renderCodeHighlight({
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
      fallback={eligible ? plainCodeHighlight({ children: normalized, style: codeStyle, customStyle, showLineNumbers, startingLineNumber, lineNumberStyle: VIEWER_LINE_NUMBER_STYLE, codeTagProps: { style: VIEWER_CODE_TAG_STYLE } }) : fallback}
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
