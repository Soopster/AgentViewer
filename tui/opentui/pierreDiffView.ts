import {
  cleanLastNewline,
  getHighlighterOptions,
  getSharedHighlighter,
  parsePatchFiles,
  renderDiffWithHighlighter,
  type FileDiffMetadata,
} from '@pierre/diffs'
import { prepareFileTreeInput } from '@pierre/trees'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TuiPierreDiffRowTone = 'file' | 'tree' | 'hunk' | 'context' | 'addition' | 'deletion' | 'meta'

export type TuiRenderSpan = {
  text: string
  fg?: string
  bg?: string
}

export type TuiPierreDiffRow = {
  key: string
  tone: TuiPierreDiffRowTone
  text: string
  spans?: TuiRenderSpan[]  // syntax-highlighted spans; populated after highlight load
  oldLine?: number
  newLine?: number
  indicator?: string
}

// ─── Split-view types ─────────────────────────────────────────────────────────

export type TuiSplitSideKind = 'deletion' | 'addition' | 'context' | 'empty'

export type TuiSplitRowSide = {
  kind: TuiSplitSideKind
  lineNum?: number
  text: string
  spans?: TuiRenderSpan[]
}

/** One row in split view. Full-width header rows (file/hunk/meta/tree) use `.text`;
 *  paired change/context rows use `.left` and `.right`. */
export type TuiPierreSplitRow = {
  key: string
  tone: TuiPierreDiffRowTone | 'split-change' | 'split-context'
  text?: string
  left?: TuiSplitRowSide
  right?: TuiSplitRowSide
}

export type TuiPierreDiffView = {
  rows: TuiPierreDiffRow[]
  splitRows: TuiPierreSplitRow[]
}

export type TuiFileHighlights = {
  deletionLines: Array<HastNode | undefined>
  additionLines: Array<HastNode | undefined>
}

// ─── HAST types ───────────────────────────────────────────────────────────────

type HastTextNode = { type: 'text'; value: string }
type HastElementNode = {
  type: 'element'
  tagName: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}
type HastNode = HastTextNode | HastElementNode

// ─── Style parsing (cache-keyed to avoid reparsing repeated Pierre style strings) ──

const EMPTY_STYLES = new Map<string, string>()
const parsedStyleCache = new Map<string, Map<string, string>>()

function parseStyleValue(style: unknown): Map<string, string> {
  if (typeof style !== 'string') return EMPTY_STYLES
  const cached = parsedStyleCache.get(style)
  if (cached) return cached
  const result = new Map<string, string>()
  for (const segment of style.split(';')) {
    const colon = segment.indexOf(':')
    if (colon <= 0) continue
    const key = segment.slice(0, colon).trim()
    const value = segment.slice(colon + 1).trim()
    if (key && value) result.set(key, value)
  }
  parsedStyleCache.set(style, result)
  return result
}

// ─── HAST → span flattening ───────────────────────────────────────────────────

function mergeSpan(target: TuiRenderSpan[], span: TuiRenderSpan) {
  if (!span.text) return
  const last = target[target.length - 1]
  if (last && last.fg === span.fg && last.bg === span.bg) {
    last.text += span.text
    return
  }
  target.push(span)
}

// Cache flattened spans per HAST node so revisiting the same file is cheap.
const flattenedLineCache = new WeakMap<HastNode, Map<string, TuiRenderSpan[]>>()

export function flattenHastLine(
  node: HastNode | undefined,
  appearance: 'dark' | 'light',
  emphasisBg?: string,
): TuiRenderSpan[] {
  if (!node) return []

  const cacheKey = `${appearance}:${emphasisBg ?? ''}`
  const cachedByNode = flattenedLineCache.get(node)
  const cached = cachedByNode?.get(cacheKey)
  if (cached) return cached

  const colorVar = appearance === 'dark' ? '--diffs-token-dark' : '--diffs-token-light'
  const spans: TuiRenderSpan[] = []

  function visit(current: HastNode, inherited: { fg?: string; bg?: string }) {
    if (current.type === 'text') {
      const text = cleanLastNewline(current.value)
      if (text) mergeSpan(spans, { text, fg: inherited.fg, bg: inherited.bg })
      return
    }
    const properties = current.properties ?? {}
    const styles = parseStyleValue(properties.style)
    const fg = styles.get(colorVar) ?? styles.get('color') ?? inherited.fg
    const bg =
      Object.hasOwn(properties, 'data-diff-span') && emphasisBg ? emphasisBg : inherited.bg
    for (const child of (current.children ?? []) as HastNode[]) {
      visit(child, { fg, bg })
    }
  }

  visit(node, {})

  const map = cachedByNode ?? new Map<string, TuiRenderSpan[]>()
  map.set(cacheKey, spans)
  if (!cachedByNode) flattenedLineCache.set(node, map)
  return spans
}

// ─── Highlight loading & per-content cache ────────────────────────────────────

const highlightCache = new Map<string, Map<string, TuiFileHighlights>>()
const highlightInFlight = new Map<string, Promise<Map<string, TuiFileHighlights>>>()
const HIGHLIGHT_CACHE_MAX = 60

const RENDER_OPTIONS = {
  dark: {
    theme: 'pierre-dark' as const,
    useTokenTransformer: false as const,
    tokenizeMaxLineLength: 1_000,
    lineDiffType: 'word-alt' as const,
    maxLineDiffLength: 10_000,
  },
  light: {
    theme: 'pierre-light' as const,
    useTokenTransformer: false as const,
    tokenizeMaxLineLength: 1_000,
    lineDiffType: 'word-alt' as const,
    maxLineDiffLength: 10_000,
  },
}

export async function loadDiffHighlights(
  diffText: string,
  cacheKey: string,
  appearance: 'dark' | 'light',
): Promise<Map<string, TuiFileHighlights>> {
  const fullKey = `${appearance}:${cacheKey}:${diffText.length}`
  const hit = highlightCache.get(fullKey)
  if (hit) return hit

  const inflight = highlightInFlight.get(fullKey)
  if (inflight) return inflight

  const options = RENDER_OPTIONS[appearance]

  const promise = (async (): Promise<Map<string, TuiFileHighlights>> => {
    try {
      const parsed = parsePatchFiles(diffText, cacheKey, false)
      const files = parsed.flatMap((p) => p.files)
      const result = new Map<string, TuiFileHighlights>()

      for (const file of files) {
        try {
          const hlOpts = getHighlighterOptions(file.lang ?? 'text', { theme: options.theme })
          const highlighter = await getSharedHighlighter({
            ...hlOpts,
            preferredHighlighter: 'shiki-wasm',
          })
          const highlighted = renderDiffWithHighlighter(file, highlighter, options)
          result.set(diffDisplayPath(file), {
            deletionLines: highlighted.code.deletionLines as Array<HastNode | undefined>,
            additionLines: highlighted.code.additionLines as Array<HastNode | undefined>,
          })
        } catch {
          // Per-file highlight failure is non-fatal — leave it unhighlighted.
        }
      }

      if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) {
        const oldest = highlightCache.keys().next().value
        if (oldest !== undefined) highlightCache.delete(oldest)
      }
      highlightCache.set(fullKey, result)
      return result
    } catch {
      return new Map()
    } finally {
      highlightInFlight.delete(fullKey)
    }
  })()

  highlightInFlight.set(fullKey, promise)
  return promise
}

// ─── Split-view row builder (per file) ────────────────────────────────────────

function buildFileSplitRows(
  file: FileDiffMetadata,
  fileHighlights: TuiFileHighlights | undefined,
  appearance: 'dark' | 'light',
  cacheKey: string,
  fileIndex: number,
): TuiPierreSplitRow[] {
  const rows: TuiPierreSplitRow[] = []

  for (const [hunkIndex, hunk] of file.hunks.entries()) {
    if (hunk.collapsedBefore > 0) {
      rows.push({
        key: `${cacheKey}:s:${fileIndex}:${hunkIndex}:collapsed`,
        tone: 'meta',
        text: `... ${hunk.collapsedBefore} unchanged line${hunk.collapsedBefore === 1 ? '' : 's'}`,
      })
    }
    rows.push({
      key: `${cacheKey}:s:${fileIndex}:${hunkIndex}:header`,
      tone: 'hunk',
      text: cleanDiffLineText(
        hunk.hunkSpecs ??
          `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@${hunk.hunkContext ? ` ${hunk.hunkContext}` : ''}`,
      ),
    })

    let delIdx = hunk.deletionLineIndex
    let addIdx = hunk.additionLineIndex
    let delNum = hunk.deletionStart
    let addNum = hunk.additionStart

    for (const [ci, content] of hunk.hunkContent.entries()) {
      if (content.type === 'context') {
        for (let li = 0; li < content.lines; li++) {
          const rawText =
            file.additionLines[addIdx + li] ?? file.deletionLines[delIdx + li] ?? ''
          const hastNode = fileHighlights?.additionLines[addIdx + li]
          const spans = hastNode ? flattenHastLine(hastNode, appearance) : undefined
          const side: Omit<TuiSplitRowSide, 'lineNum'> = {
            kind: 'context',
            text: cleanDiffLineText(rawText),
            spans: spans?.length ? spans : undefined,
          }
          rows.push({
            key: `${cacheKey}:s:${fileIndex}:${hunkIndex}:ctx:${ci}:${li}`,
            tone: 'split-context',
            left: { ...side, lineNum: delNum + li },
            right: { ...side, lineNum: addNum + li },
          })
        }
        delIdx += content.lines
        addIdx += content.lines
        delNum += content.lines
        addNum += content.lines
      } else {
        const pairCount = Math.max(content.deletions, content.additions)
        for (let i = 0; i < pairCount; i++) {
          let left: TuiSplitRowSide
          let right: TuiSplitRowSide

          if (i < content.deletions) {
            const rawText = file.deletionLines[delIdx + i] ?? ''
            const hastNode = fileHighlights?.deletionLines[delIdx + i]
            const spans = hastNode ? flattenHastLine(hastNode, appearance) : undefined
            left = {
              kind: 'deletion',
              lineNum: delNum + i,
              text: cleanDiffLineText(rawText),
              spans: spans?.length ? spans : undefined,
            }
          } else {
            left = { kind: 'empty', text: '' }
          }

          if (i < content.additions) {
            const rawText = file.additionLines[addIdx + i] ?? ''
            const hastNode = fileHighlights?.additionLines[addIdx + i]
            const spans = hastNode ? flattenHastLine(hastNode, appearance) : undefined
            right = {
              kind: 'addition',
              lineNum: addNum + i,
              text: cleanDiffLineText(rawText),
              spans: spans?.length ? spans : undefined,
            }
          } else {
            right = { kind: 'empty', text: '' }
          }

          rows.push({
            key: `${cacheKey}:s:${fileIndex}:${hunkIndex}:chg:${ci}:${i}`,
            tone: 'split-change',
            left,
            right,
          })
        }
        delIdx += content.deletions
        addIdx += content.additions
        delNum += content.deletions
        addNum += content.additions
      }
    }
  }

  return rows
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildPierreDiffView(
  diffText: string,
  cacheKey: string,
  highlights?: Map<string, TuiFileHighlights> | null,
  appearance: 'dark' | 'light' = 'dark',
): TuiPierreDiffView | null {
  const rows: TuiPierreDiffRow[] = []
  const splitRows: TuiPierreSplitRow[] = []
  try {
    const parsed = parsePatchFiles(diffText, cacheKey, false)
    const files = parsed.flatMap((patch) => patch.files)
    if (files.length === 0) return buildFallbackDiffView(diffText, cacheKey)

    const orderedFiles = orderDiffFiles(files)
    if (orderedFiles.length > 1) {
      const summaryRow: TuiPierreDiffRow = {
        key: `${cacheKey}:tree:summary`,
        tone: 'meta',
        text: `${orderedFiles.length} files changed`,
      }
      rows.push(summaryRow)
      splitRows.push(summaryRow)
      for (const [index, path] of diffTreePaths(orderedFiles).entries()) {
        const treeRow: TuiPierreDiffRow = {
          key: `${cacheKey}:tree:${index}`,
          tone: 'tree',
          text: treePathLabel(path, index, orderedFiles.length),
        }
        rows.push(treeRow)
        splitRows.push(treeRow)
      }
    }

    for (const [fileIndex, file] of orderedFiles.entries()) {
      const fileHighlights = highlights?.get(diffDisplayPath(file))

      if (fileIndex > 0 || rows.length > 0) {
        const spacer: TuiPierreDiffRow = { key: `${cacheKey}:spacer:${fileIndex}`, tone: 'meta', text: '' }
        rows.push(spacer)
        splitRows.push(spacer)
      }
      const fileRow: TuiPierreDiffRow = {
        key: `${cacheKey}:file:${fileIndex}`,
        tone: 'file',
        text: diffFileLabel(file),
      }
      rows.push(fileRow)
      splitRows.push(fileRow)

      // Append split rows for this file
      splitRows.push(...buildFileSplitRows(file, fileHighlights, appearance, cacheKey, fileIndex))

      for (const [hunkIndex, hunk] of file.hunks.entries()) {
        if (hunk.collapsedBefore > 0) {
          rows.push({
            key: `${cacheKey}:file:${fileIndex}:hunk:${hunkIndex}:collapsed`,
            tone: 'meta',
            text: `... ${hunk.collapsedBefore} unchanged line${hunk.collapsedBefore === 1 ? '' : 's'}`,
          })
        }
        rows.push({
          key: `${cacheKey}:file:${fileIndex}:hunk:${hunkIndex}:header`,
          tone: 'hunk',
          text: cleanDiffLineText(
            hunk.hunkSpecs ??
              `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@${hunk.hunkContext ? ` ${hunk.hunkContext}` : ''}`,
          ),
        })

        let oldLine = hunk.deletionStart
        let newLine = hunk.additionStart

        for (const [contentIndex, content] of hunk.hunkContent.entries()) {
          if (content.type === 'context') {
            for (let lineIndex = 0; lineIndex < content.lines; lineIndex++) {
              const rawText =
                file.additionLines[content.additionLineIndex + lineIndex] ??
                file.deletionLines[content.deletionLineIndex + lineIndex] ??
                ''
              const hastNode =
                fileHighlights?.additionLines[content.additionLineIndex + lineIndex]
              const spans = hastNode ? flattenHastLine(hastNode, appearance) : undefined
              rows.push({
                key: `${cacheKey}:file:${fileIndex}:hunk:${hunkIndex}:ctx:${contentIndex}:${lineIndex}`,
                tone: 'context',
                text: cleanDiffLineText(rawText),
                spans: spans?.length ? spans : undefined,
                oldLine: oldLine++,
                newLine: newLine++,
                indicator: ' ',
              })
            }
          } else {
            for (let lineIndex = 0; lineIndex < content.deletions; lineIndex++) {
              const rawText = file.deletionLines[content.deletionLineIndex + lineIndex] ?? ''
              const hastNode =
                fileHighlights?.deletionLines[content.deletionLineIndex + lineIndex]
              const spans = hastNode ? flattenHastLine(hastNode, appearance) : undefined
              rows.push({
                key: `${cacheKey}:file:${fileIndex}:hunk:${hunkIndex}:del:${contentIndex}:${lineIndex}`,
                tone: 'deletion',
                text: cleanDiffLineText(rawText),
                spans: spans?.length ? spans : undefined,
                oldLine: oldLine++,
                indicator: '-',
              })
            }
            for (let lineIndex = 0; lineIndex < content.additions; lineIndex++) {
              const rawText = file.additionLines[content.additionLineIndex + lineIndex] ?? ''
              const hastNode =
                fileHighlights?.additionLines[content.additionLineIndex + lineIndex]
              const spans = hastNode ? flattenHastLine(hastNode, appearance) : undefined
              rows.push({
                key: `${cacheKey}:file:${fileIndex}:hunk:${hunkIndex}:add:${contentIndex}:${lineIndex}`,
                tone: 'addition',
                text: cleanDiffLineText(rawText),
                spans: spans?.length ? spans : undefined,
                newLine: newLine++,
                indicator: '+',
              })
            }
          }
        }
      }
    }

    return rows.length > 0 ? { rows, splitRows } : null
  } catch {
    return buildFallbackDiffView(diffText, cacheKey)
  }
}

// ─── Fallback (raw text diff coloring) ───────────────────────────────────────

function buildFallbackDiffView(diffText: string, cacheKey: string): TuiPierreDiffView | null {
  const rows = diffText
    .split('\n')
    .map((lineText, index): TuiPierreDiffRow | null => {
      const text = lineText.trimEnd()
      if (!text) return null
      if (text.startsWith('+') && !text.startsWith('+++')) {
        return { key: `${cacheKey}:fallback:${index}`, tone: 'addition', text: text.slice(1), indicator: '+' }
      }
      if (text.startsWith('-') && !text.startsWith('---')) {
        return { key: `${cacheKey}:fallback:${index}`, tone: 'deletion', text: text.slice(1), indicator: '-' }
      }
      if (text.startsWith('@@')) return { key: `${cacheKey}:fallback:${index}`, tone: 'hunk', text }
      return { key: `${cacheKey}:fallback:${index}`, tone: 'meta', text }
    })
    .filter((row): row is TuiPierreDiffRow => row != null)
  return rows.length > 0 ? { rows, splitRows: [] } : null
}

// ─── File ordering ────────────────────────────────────────────────────────────

function orderDiffFiles(files: FileDiffMetadata[]): FileDiffMetadata[] {
  const prepared = prepareFileTreeInput(
    files.map((file) => diffDisplayPath(file)),
    { flattenEmptyDirectories: true, sort: 'default' },
  )
  const order = new Map(prepared.paths.map((path, index) => [path, index]))
  return [...files].sort((left, right) => {
    const leftOrder = order.get(diffDisplayPath(left)) ?? Number.MAX_SAFE_INTEGER
    const rightOrder = order.get(diffDisplayPath(right)) ?? Number.MAX_SAFE_INTEGER
    return leftOrder - rightOrder || diffDisplayPath(left).localeCompare(diffDisplayPath(right))
  })
}

function diffTreePaths(files: FileDiffMetadata[]): string[] {
  return [
    ...prepareFileTreeInput(
      files.map((file) => diffDisplayPath(file)),
      { flattenEmptyDirectories: true, sort: 'default' },
    ).paths,
  ]
}

function diffDisplayPath(file: FileDiffMetadata): string {
  return stripDiffPathPrefix(file.name || file.prevName || 'unknown')
}

function diffFileLabel(file: FileDiffMetadata): string {
  const name = diffDisplayPath(file)
  const prevName = file.prevName ? stripDiffPathPrefix(file.prevName) : null
  const change = file.type.replaceAll('-', ' ')
  if (prevName && prevName !== name) return `${change} ${prevName} -> ${name}`
  return `${change} ${name}`
}

function stripDiffPathPrefix(path: string): string {
  return path.replace(/^[ab]\//, '')
}

function treePathLabel(path: string, index: number, total: number): string {
  return `${index === total - 1 ? '└─' : '├─'} ${path}`
}

function cleanDiffLineText(text: string): string {
  return text.replace(/\r?\n$/, '')
}
