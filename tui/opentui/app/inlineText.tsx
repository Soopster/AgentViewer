/** @jsxImportSource @opentui/react */
import { TextAttributes } from '@opentui/core'
import React, { useSyncExternalStore } from 'react'
import { hasTuiLinkTarget, parseTuiLineTokens } from '../../../lib/tuiLinkTargets'
import type { TuiThemePalette } from '../../theme'
import type { QuietWorkspaceState } from '../workspaceContext'

/** What clicking a composer status segment does. */
type ComposerStatusAction = 'model' | 'path' | 'git'
export type InlineTextSegment = {
  text: string
  fg: string
  bg?: string
  attributes?: number
  action?: ComposerStatusAction
}
/** The action of the segment under a column of a row drawn by renderInlineTextSegments. */

export function inlineSegmentActionAt(segments: readonly InlineTextSegment[], width: number, column: number): ComposerStatusAction | undefined {
  const index = inlineSegmentIndexAt(segments, width, column)
  return index === null ? undefined : segments[index]?.action
}
/** The index of the segment drawn under a column, or null past the drawn text. */

export function inlineSegmentIndexAt(segments: readonly InlineTextSegment[], width: number, column: number): number | null {
  let start = 0
  let remaining = width
  for (let index = 0; index < segments.length; index += 1) {
    if (remaining <= 0) break
    const length = clipText(segments[index]!.text, remaining).length
    if (length === 0) continue
    if (column >= start && column < start + length) return index
    start += length
    remaining -= length
  }
  return null
}
export function composerSendingHintSegments(value: string, theme: TuiThemePalette): InlineTextSegment[] {
  const segments: InlineTextSegment[] = []
  value.split(' · ').forEach((group, index) => {
    if (index > 0) segments.push({ text: ' · ', fg: theme.dim })
    const match = group.match(/^(\S+)(?:\s+(.*))?$/)
    const key = match?.[1] ?? group
    const label = match?.[2]
    const normalized = group.toLowerCase()
    const color = normalized.includes('cancel') || normalized.includes('interrupt')
      ? theme.red
      : normalized.includes('queue') || normalized.includes('background')
        ? theme.amber
        : normalized.includes('running') || normalized.includes('streaming') || normalized.includes('thinking') || normalized.includes('responding')
          ? theme.green
          : theme.cyan

    if (!label) {
      segments.push({ text: group, fg: color })
      return
    }
    segments.push({ text: key, fg: color })
    segments.push({ text: ` ${label}`, fg: color })
  })
  return segments
}
function clipText(value: string, width: number): string {
  if (width <= 0) return ''
  if (value.length <= width) return value
  if (width === 1) return value.slice(0, 1)
  return `${value.slice(0, width - 1)}…`
}
function cleanLivePreviewText(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/^```[^\n]*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|`)/g, '')
}
export function wrapLivePreviewTail(value: string, width: number, maxLines: number): string[] {
  if (width <= 0 || maxLines <= 0) return []
  const cleaned = cleanLivePreviewText(value).trimEnd()
  if (!cleaned) return []

  // Live buffers can grow large. Only inspect enough trailing source to fill
  // the fixed preview card so streaming updates stay bounded.
  const sourceLimit = Math.max(width * maxLines * 6, 1024)
  const source = cleaned.slice(-sourceLimit)
  const wrapped: string[] = []

  for (const rawLine of source.split('\n')) {
    let remaining = rawLine.replace(/\s+/g, ' ').trim()
    if (!remaining) {
      if (wrapped.length > 0 && wrapped[wrapped.length - 1] !== '') wrapped.push('')
      continue
    }
    while (remaining.length > width) {
      let splitAt = remaining.lastIndexOf(' ', width)
      if (splitAt < Math.floor(width * 0.4)) splitAt = width
      wrapped.push(remaining.slice(0, splitAt).trimEnd())
      remaining = remaining.slice(splitAt).trimStart()
    }
    if (remaining) wrapped.push(remaining)
  }

  return wrapped.slice(-maxLines)
}
export function renderInlineTextSegments(segments: InlineTextSegment[], width: number, padFg: string, hover?: { index: number; bg: string}  | null): React.ReactNode[] {
  if (width <= 0) return []
  const out: React.ReactNode[] = []
  let remaining = width
  for (let i = 0; i < segments.length; i += 1) {
    if (remaining <= 0) break
    const segment = segments[i]
    if (!segment?.text) continue
    const clipped = clipText(segment.text, remaining)
    if (!clipped) continue
    if (segment.action) {
      // A click target is underlined, but not the padding around its label.
      const label = clipped.trim()
      const start = clipped.indexOf(label)
      // Under the pointer the label takes a raised background, so it reads as a button.
      const labelBg = hover?.index === i ? hover.bg : segment.bg
      if (start > 0) out.push(<span key={`${i}a`} fg={segment.fg} bg={segment.bg}>{clipped.slice(0, start)}</span>)
      out.push(<span key={i} fg={segment.fg} bg={labelBg} attributes={(segment.attributes ?? 0) | TextAttributes.UNDERLINE}>{label}</span>)
      if (start + label.length < clipped.length) out.push(<span key={`${i}b`} fg={segment.fg} bg={segment.bg}>{clipped.slice(start + label.length)}</span>)
    } else {
      out.push(<span key={i} fg={segment.fg} bg={segment.bg} attributes={segment.attributes}>{clipped}</span>)
    }
    remaining -= clipped.length
  }
  if (remaining > 0) {
    out.push(<span key="pad" fg={padFg}>{' '.repeat(remaining)}</span>)
  }
  return out
}
/**
 * A status row that shows the draft's length. It subscribes to the draft itself, so typing
 * repaints these spans without re-rendering the root.
 */
export function DraftLengthSpans({ draft, build, width, padFg, hover }: {
  draft: QuietWorkspaceState
  build: (draftLength: number) => InlineTextSegment[]
  width: number
  padFg: string
  hover?: { index: number; bg: string}  | null
}) {
  const length = useSyncExternalStore(draft.subscribe, () => draft.read().length, () => draft.read().length)
  return <>{renderInlineTextSegments(build(length), width, padFg, hover)}</>
}
// `code` and **bold** are the only spans the native CLIs surface in prose, and
// the only two low-risk enough to detect without mangling identifiers (`__init__`,
// `file_name`, `a*b`). Both require a matching close on the same line; stray
// markers fall through as literal text.
const INLINE_MARKDOWN_PATTERN = /(`[^`]+`)|(\*\*[^*]+?\*\*)/
const INLINE_MARKDOWN_PATTERN_G = /(`[^`]+`)|(\*\*[^*]+?\*\*)/g
function hasInlineMarkdown(text: string): boolean {
  return INLINE_MARKDOWN_PATTERN.test(text)
}
// Whether a line needs span rendering at all. Both renderers below have a
// fast path that hands the raw string to `fitText`, and the overwhelming
// majority of transcript lines take it — so this has to stay a pair of regex
// probes, not tokenization.
export function hasInlineSpans(text: string): boolean {
  return hasInlineMarkdown(text) || hasTuiLinkTarget(text)
}
type InlineMarkdownToken = { text: string; kind: 'plain' | 'code' | 'bold'; url?: string} 
// Split one line of prose into plain / `code` / **bold** runs. Markers are
// stripped; anything unmatched stays plain. Shared by the wrapping and
// width-clamped renderers below so every view parses markdown identically.
function parseInlineMarkdownTokens(text: string): InlineMarkdownToken[] {
  const tokens: InlineMarkdownToken[] = []
  let last = 0
  INLINE_MARKDOWN_PATTERN_G.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INLINE_MARKDOWN_PATTERN_G.exec(text)) !== null) {
    if (match.index > last) tokens.push({ text: text.slice(last, match.index), kind: 'plain' })
    if (match[1]) tokens.push({ text: match[1].slice(1, -1), kind: 'code' })
    else if (match[2]) tokens.push({ text: match[2].slice(2, -2), kind: 'bold' })
    last = INLINE_MARKDOWN_PATTERN_G.lastIndex
  }
  if (last < text.length) tokens.push({ text: text.slice(last), kind: 'plain' })
  return tokens
}
// Link detection runs AFTER markdown tokenization, never before. A path cited
// in backticks — `lib/a.ts`, by far the most common way an agent names a file —
// needs its markers stripped by the markdown pass first; linkifying first would
// leave the backticks on screen as literal text. Splitting each markdown token
// instead keeps the token's own styling and adds the target to it, so a path in
// backticks stays `code`-colored and becomes clickable.
function parseInlineSpanTokens(text: string, linkCwd: string | undefined): InlineMarkdownToken[] {
  const tokens = parseInlineMarkdownTokens(text)
  if (!hasTuiLinkTarget(text)) return tokens
  return tokens.flatMap((token) => parseTuiLineTokens(token.text, linkCwd).map((run) => (
    run.kind === 'link'
      ? { text: run.text, kind: token.kind, url: run.url }
      : { text: run.text, kind: token.kind }
  )))
}
function inlineMarkdownTokenFg(token: InlineMarkdownToken, theme: TuiThemePalette, baseFg: string): string {
  // A link keeps whatever color its markdown token had — recoloring it would
  // fight the role colors the transcript uses to say who is speaking. The
  // underline below is what marks it as clickable.
  return token.kind === 'code' ? theme.cyan : baseFg
}
function inlineMarkdownTokenAttrs(token: InlineMarkdownToken): number | undefined {
  const bold = token.kind === 'bold' ? TextAttributes.BOLD : 0
  const underline = token.url ? TextAttributes.UNDERLINE : 0
  const attributes = bold | underline
  return attributes === 0 ? undefined : attributes
}
// `<a href>` is what paints a link id into the cell attributes, which is the
// only thing `renderer.getLinkAt(x, y)` can read back — a styled <span> with the
// same text is not clickable. So the element choice here IS the feature.
function inlineSpanElement(
  token: InlineMarkdownToken,
  key: string,
  fg: string,
  attributes: number | undefined,
  text: string
): React.ReactNode {
  return token.url
    ? <a key={key} href={token.url} fg={fg} attributes={attributes}>{text}</a>
    : <span key={key} fg={fg} attributes={attributes}>{text}</span>
}
// Wrapping context (Stream view, wrapMode="word"): emit sibling <span>s so
// **bold**/`code` render like the native CLIs while the parent <text> keeps
// flowing/wrapping the assembled StyledText — width stays the caller's job.

export function renderInlineMarkdownSpans(
  text: string,
  theme: TuiThemePalette,
  baseFg: string,
  keyPrefix: string,
  linkCwd?: string
): React.ReactNode[] {
  return parseInlineSpanTokens(text, linkCwd).map((token, index) => inlineSpanElement(
    token,
    `${keyPrefix}:${index}`,
    inlineMarkdownTokenFg(token, theme, baseFg),
    inlineMarkdownTokenAttrs(token),
    token.text
  ))
}
// Width-clamped context (reader/agent cards, wrapMode="none" on pre-wrapped
// lines): same styling, but clip to `width` the way fitText would so the
// single-line layout is preserved. No trailing pad — matches the plain path.
export function renderInlineMarkdownClipped(
  text: string,
  theme: TuiThemePalette,
  baseFg: string,
  width: number,
  keyPrefix: string,
  linkCwd?: string): React.ReactNode[] {
  if (width <= 0) return []
  const out: React.ReactNode[] = []
  let remaining = width
  const tokens = parseInlineSpanTokens(text, linkCwd)
  for (let i = 0; i < tokens.length; i += 1) {
    if (remaining <= 0) break
    const token = tokens[i]
    const clipped = clipText(token.text, remaining)
    if (!clipped) continue
    out.push(inlineSpanElement(
      token,
      `${keyPrefix}:${i}`,
      inlineMarkdownTokenFg(token, theme, baseFg),
      inlineMarkdownTokenAttrs(token),
      clipped
    ))
    remaining -= clipped.length
  }
  return out
}
export const LIVE_PREVIEW_HEIGHT = 6
export const LIVE_PREVIEW_BODY_LINES = LIVE_PREVIEW_HEIGHT - 2
export function LivePreviewCard({
  title, lines, accentColor, bodyColor, theme,
}: {
  title: string
  lines: string[]
  accentColor: string
  bodyColor: string
  theme: TuiThemePalette
}) {
  const lastLineIndex = lines.length - 1
  return (
    <box backgroundColor={theme.surface2} paddingX={1} height={LIVE_PREVIEW_HEIGHT}>
      <box
        border
        borderStyle="single"
        borderColor={accentColor}
        backgroundColor={theme.surface}
        height={LIVE_PREVIEW_HEIGHT}
        flexGrow={1}
        flexDirection="column"
        paddingX={1}
        overflow="hidden"
        title={` ${title} `}
        titleColor={accentColor}
        titleAlignment="left"
      >
        {lines.map((line, index) => (
          <text key={`${index}:${line}`} wrapMode="none">
            <span fg={bodyColor}>{line || ' '}</span>
            {index === lastLineIndex ? <span fg={accentColor}> ▌</span> : null}
          </text>
        ))}
      </box>
    </box>
  )
}
