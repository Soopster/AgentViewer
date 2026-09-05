'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { EditProvider, FileDiff, MultiFileDiff, WorkerPoolContextProvider } from '@pierre/diffs/react'
import { Editor, type EditorFactory } from '@pierre/diffs/edit'
import { parsePatchFiles, type DiffLineAnnotation, type FileDiffContentsLoader, type FileDiffMetadata, type FileDiffOptions, type SelectedLineRange } from '@pierre/diffs'
import { createFileTreeIconResolver, getBuiltInSpriteSheet, prepareFileTreeInput } from '@pierre/trees'
import { DIFF_WORKER_POOL_OPTIONS } from '@/components/pierreDiffWorker'

// Editable surfaces need token-level (not line-level) highlight patching so the
// worker can re-highlight around the cursor without discarding editor state.
const DIFF_WORKER_HIGHLIGHTER_OPTIONS = { useTokenTransformer: true }

export type PierreDiffStyle = 'stacked' | 'split'
export type PierreChangeStyle = 'classic' | 'bars' | 'none'
export type PierreInlineDiffStyle = 'word-alt' | 'word' | 'char' | 'none'
export type PierreAnnotationMetadata = {
  filePath?: string
  noteId: string
  text: string
  rangeLabel: string
  kind: 'thread' | 'draft'
}
export type PierreDiffAnnotation<T = PierreAnnotationMetadata> = DiffLineAnnotation<T>

export type PierreDiffPresentation = {
  diffStyle?: PierreDiffStyle
  changeStyle?: PierreChangeStyle
  inlineDiffStyle?: PierreInlineDiffStyle
  wrap?: boolean
  showLineNumbers?: boolean
  showHunkHeaders?: boolean
  showBackgrounds?: boolean
}

const COMPLETE_TREE_ICONS = { set: 'complete', colored: true } as const
const COMPLETE_TREE_SPRITE = getBuiltInSpriteSheet('complete')
const COMPLETE_TREE_ICON_RESOLVER = createFileTreeIconResolver(COMPLETE_TREE_ICONS)
const FileDiffAny = FileDiff as any
const MultiFileDiffAny = MultiFileDiff as any

const DIFF_OPTIONS: FileDiffOptions<undefined, undefined> = {
  diffStyle: 'unified',
  diffIndicators: 'classic',
  overflow: 'wrap',
  hunkSeparators: 'line-info-basic',
  lineDiffType: 'word',
  enableLineSelection: true,
  disableVirtualizationBuffers: true,
  unsafeCSS: `
    :host {
      --diffs-font-family: 'IBM Plex Mono', monospace;
      --diffs-header-font-family: 'IBM Plex Sans', system-ui, sans-serif;
      --diffs-font-size: 12px;
      --diffs-line-height: 19px;
      --diffs-light-bg: var(--surface);
      --diffs-dark-bg: var(--surface);
      --diffs-light: var(--text);
      --diffs-dark: var(--text);
      --diffs-added-light: var(--green);
      --diffs-added-dark: var(--green);
      --diffs-deleted-light: var(--red);
      --diffs-deleted-dark: var(--red);
      --diffs-modified-light: var(--cyan);
      --diffs-modified-dark: var(--cyan);
      --diffs-bg-context-override: var(--surface);
      --diffs-bg-context-gutter-override: var(--surface-2);
      --diffs-bg-separator-override: var(--surface-2);
      --diffs-bg-addition-override: color-mix(in srgb, var(--green) 13%, var(--surface));
      --diffs-bg-deletion-override: color-mix(in srgb, var(--red) 14%, var(--surface));
      --diffs-fg-number-override: var(--text-3);
    }
    [data-diffs-header=default] {
      min-height: 30px;
      padding-inline: 10px;
      border-block-end: 1px solid var(--border);
      background: var(--surface-2);
    }
    [data-file-info] {
      color: var(--text-2);
      background: var(--surface-2);
      border-color: var(--border);
    }
  `,
}

function getDiffOptions(presentation?: PierreDiffPresentation): FileDiffOptions<undefined, undefined> {
  if (!presentation) return DIFF_OPTIONS

  const diffIndicators =
    presentation.changeStyle === 'bars' ? 'bars'
      : presentation.changeStyle === 'none' ? 'none'
        : 'classic'

  return {
    ...DIFF_OPTIONS,
    diffStyle: presentation.diffStyle === 'split' ? 'split' : 'unified',
    diffIndicators,
    disableBackground: presentation.showBackgrounds === false,
    lineDiffType: presentation.inlineDiffStyle ?? DIFF_OPTIONS.lineDiffType,
    overflow: presentation.wrap === false ? 'scroll' : 'wrap',
    disableLineNumbers: presentation.showLineNumbers === false,
    hunkSeparators: presentation.showHunkHeaders === false ? 'simple' : DIFF_OPTIONS.hunkSeparators,
  }
}

type PierreDiffFrameProps = {
  children: React.ReactNode
  maxHeight?: number | null
  editable?: boolean
}

function PierreDiffFrame({ children, maxHeight, editable }: PierreDiffFrameProps) {
  return (
    <WorkerPoolContextProvider
      poolOptions={DIFF_WORKER_POOL_OPTIONS}
      highlighterOptions={editable ? DIFF_WORKER_HIGHLIGHTER_OPTIONS : {}}
    >
      <div
        style={{
          maxHeight: maxHeight ?? undefined,
          overflow: maxHeight != null ? 'auto' : undefined,
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        <PierreBuiltInIconSprite />
        {children}
      </div>
    </WorkerPoolContextProvider>
  )
}

export function PierreFileDiffView({
  oldStr,
  newStr,
  filePath,
  maxHeight = 500,
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
  maxHeight?: number | null
  presentation?: PierreDiffPresentation
  selectedLines?: SelectedLineRange | null
  onSelectedLinesChange?: (selection: SelectedLineRange | null) => void
  lineAnnotations?: PierreDiffAnnotation[]
  renderAnnotation?: (annotation: PierreDiffAnnotation) => ReactNode
  onGutterUtilityClick?: (range: SelectedLineRange) => void
}) {
  const oldFile = useMemo(() => ({
    name: filePath || 'previous',
    contents: oldStr,
  }), [filePath, oldStr])
  const newFile = useMemo(() => ({
    name: filePath || 'current',
    contents: newStr,
  }), [filePath, newStr])

  return (
    <PierreDiffFrame maxHeight={maxHeight}>
      <MultiFileDiffAny
        oldFile={oldFile}
        newFile={newFile}
        options={{
          ...getDiffOptions(presentation),
          ...(onGutterUtilityClick ? { enableGutterUtility: true, onGutterUtilityClick } : {}),
          onLineSelectionStart: onSelectedLinesChange,
          onLineSelectionChange: onSelectedLinesChange,
          onLineSelectionEnd: onSelectedLinesChange,
          onLineSelected: onSelectedLinesChange,
        }}
        lineAnnotations={lineAnnotations}
        selectedLines={selectedLines}
        renderAnnotation={renderAnnotation}
      />
    </PierreDiffFrame>
  )
}

const MultiFileDiffEditable = MultiFileDiff as unknown as (props: Record<string, unknown>) => React.JSX.Element

/**
 * Working-tree diff whose right-hand side is a live editor. The old side stays
 * the committed text, so the diff re-renders against HEAD as the user types.
 */
export function PierreEditableFileDiffView({
  headStr,
  workingStr,
  filePath,
  maxHeight = null,
  presentation,
  onEditedContentChange,
}: {
  headStr: string
  workingStr: string
  filePath: string
  maxHeight?: number | null
  presentation?: PierreDiffPresentation
  onEditedContentChange: (contents: string) => void
}) {
  const oldFile = useMemo(() => ({ name: filePath, contents: headStr }), [filePath, headStr])
  const newFile = useMemo(() => ({ name: filePath, contents: workingStr }), [filePath, workingStr])

  const changeRef = useRef(onEditedContentChange)
  useEffect(() => {
    changeRef.current = onEditedContentChange
  }, [onEditedContentChange])

  // The factory must forward the editor type and the options the component
  // hands it — that is how the surface's own onChange reaches the editor
  // instance. @pierre/diffs 1.4 made the surface an explicit constructor
  // argument and collapsed onChange's three parameters into one event.
  const createEditor: EditorFactory<undefined, undefined> = useCallback((
    editorType,
    options,
    editStateKey,
  ) => (
    new Editor(editorType, {
      ...options,
      historyMaxEntries: 500,
      onChange: (event) => {
        options?.onChange?.(event)
        changeRef.current(event.file.contents)
      },
    }, editStateKey)
  ), [])

  const options = useMemo(() => ({
    ...getDiffOptions(presentation),
    enableLineSelection: false,
  }), [presentation])

  return (
    <PierreDiffFrame maxHeight={maxHeight} editable>
      <EditProvider createEditor={createEditor}>
        <MultiFileDiffEditable
          oldFile={oldFile}
          newFile={newFile}
          options={options}
          edit
        />
      </EditProvider>
    </PierreDiffFrame>
  )
}

export function PierrePatchDiffView({
  patch,
  maxHeight = 500,
  emptyLabel = 'No textual diff.',
  presentation,
  selectedLines,
  onSelectedLinesChange,
  lineAnnotations,
  renderAnnotation,
  onGutterUtilityClick,
  loadDiffFiles,
}: {
  patch: string
  maxHeight?: number | null
  emptyLabel?: string
  presentation?: PierreDiffPresentation
  selectedLines?: SelectedLineRange | null
  onSelectedLinesChange?: (selection: SelectedLineRange | null) => void
  lineAnnotations?: PierreDiffAnnotation[]
  renderAnnotation?: (annotation: PierreDiffAnnotation) => ReactNode
  onGutterUtilityClick?: (range: SelectedLineRange) => void
  /**
   * Supplies whole-file contents for a patch-parsed diff. Patches only carry
   * their own hunks, so without this the renderer cannot expand context
   * between them. Omit to keep a diff strictly read-only.
   */
  loadDiffFiles?: FileDiffContentsLoader
}) {
  const files = useMemo(() => parsePatchDiffFiles(patch), [patch])

  if (files.length === 0) {
    return (
      <PierreDiffFrame maxHeight={maxHeight}>
        <PierreFallbackDiffView text={patch || emptyLabel} presentation={presentation} />
      </PierreDiffFrame>
    )
  }

  return (
    <PierreDiffFrame maxHeight={maxHeight}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
        {files.map((file, index) => (
          <FileDiffAny
            key={`${file.prevName ?? ''}:${file.name}:${index}`}
            fileDiff={file}
            lineAnnotations={lineAnnotations?.filter((annotation) => {
              if (!annotation.metadata?.filePath) return true
              return annotation.metadata.filePath === displayPath(file)
            })}
            options={{
              ...getDiffOptions(presentation),
              ...(onGutterUtilityClick ? { enableGutterUtility: true, onGutterUtilityClick } : {}),
              ...(loadDiffFiles ? { loadDiffFiles } : {}),
              onLineSelectionStart: onSelectedLinesChange,
              onLineSelectionChange: onSelectedLinesChange,
              onLineSelectionEnd: onSelectedLinesChange,
              onLineSelected: onSelectedLinesChange,
            }}
            selectedLines={selectedLines}
            renderAnnotation={renderAnnotation}
          />
        ))}
      </div>
    </PierreDiffFrame>
  )
}

function parsePatchDiffFiles(patch: string): FileDiffMetadata[] {
  if (!patch.trim()) return []
  try {
    const files = parsePatchFiles(patch, 'web-diff', false).flatMap((entry) => entry.files)
    if (files.length <= 1) return files

    const prepared = prepareFileTreeInput(files.map((file) => displayPath(file)), {
      flattenEmptyDirectories: true,
      sort: 'default',
    })
    const order = new Map(prepared.paths.map((path, index) => [path, index]))
    return [...files].sort((left, right) => {
      const leftPath = displayPath(left)
      const rightPath = displayPath(right)
      return (order.get(leftPath) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(rightPath) ?? Number.MAX_SAFE_INTEGER)
        || leftPath.localeCompare(rightPath)
    })
  } catch {
    return []
  }
}

function displayPath(file: FileDiffMetadata): string {
  return (file.name || file.prevName || 'unknown').replace(/^[ab]\//, '')
}

export function PierreFileTypeIcon({ filePath }: { filePath: string }) {
  const icon = useMemo(() => COMPLETE_TREE_ICON_RESOLVER.resolveIcon('file-tree-icon-file', filePath), [filePath])
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={14}
      height={14}
      viewBox="0 0 16 16"
      style={{ flexShrink: 0, color: 'var(--text-3)' }}
    >
      <use href={`#${icon.name}`} />
    </svg>
  )
}

export function PierreBuiltInIconSprite() {
  const spriteRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const node = spriteRef.current
    if (!node || node.childNodes.length > 0) return
    node.innerHTML = COMPLETE_TREE_SPRITE
  }, [])

  return (
    <span ref={spriteRef} aria-hidden="true" style={{ display: 'none' }} />
  )
}

function PierreFallbackDiffView({
  text,
  presentation,
}: {
  text: string
  presentation?: PierreDiffPresentation
}) {
  const lines = text.split('\n').slice(0, 240)
  if (presentation?.diffStyle === 'split') {
    const rows = buildSplitFallbackRows(lines)
    return (
      <div style={{ padding: '8px 10px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: '17px' }}>
        {rows.map((row, index) => {
          if (row.kind === 'header') {
            return (
              <div
                key={`${index}:${row.kind}:${row.text}`}
                style={{ color: 'var(--cyan)', background: 'var(--surface-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {row.text}
              </div>
            )
          }
          if (row.kind === 'meta') {
            return (
              <div
                key={`${index}:${row.kind}:${row.text}`}
                style={{ color: 'var(--text-3)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {row.text}
              </div>
            )
          }
          return (
            <div key={`${index}:${row.kind}:${row.leftText}:${row.rightText}`} style={{ display: 'flex', width: '100%' }}>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: row.leftKind === 'deletion'
                    ? 'color-mix(in srgb, var(--red) 14%, var(--surface))'
                    : row.leftKind === 'empty'
                      ? 'var(--surface-2)'
                      : undefined,
                  color: row.leftKind === 'deletion' ? 'var(--red)' : 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  paddingRight: 8,
                }}
              >
                {row.leftText || ' '}
              </div>
              <div style={{ width: 1, background: 'var(--border)' }} />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: row.rightKind === 'addition'
                    ? 'color-mix(in srgb, var(--green) 13%, var(--surface))'
                    : row.rightKind === 'empty'
                      ? 'var(--surface-2)'
                      : undefined,
                  color: row.rightKind === 'addition' ? 'var(--green)' : 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  paddingLeft: 8,
                }}
              >
                {row.rightText || ' '}
              </div>
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <pre style={{ margin: 0, padding: '8px 10px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: '17px' }}>
      {lines.map((line, index) => {
        const isAdd = line.startsWith('+') && !line.startsWith('+++')
        const isDel = line.startsWith('-') && !line.startsWith('---')
        return (
          <div
            key={`${index}:${line}`}
            style={{
              color: isAdd ? 'var(--green)' : isDel ? 'var(--red)' : 'var(--text-3)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

type SplitFallbackRow =
  | { kind: 'header'; text: string }
  | { kind: 'meta'; text: string }
  | { kind: 'pair'; leftKind: 'deletion' | 'context' | 'empty'; rightKind: 'addition' | 'context' | 'empty'; leftText: string; rightText: string }

function buildSplitFallbackRows(lines: string[]): SplitFallbackRow[] {
  const rows: SplitFallbackRow[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line) {
      index += 1
      continue
    }

    if (line.startsWith('@@') || line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      rows.push({ kind: 'header', text: line })
      index += 1
      continue
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      const deletions: string[] = []
      while (index < lines.length) {
        const next = lines[index] ?? ''
        if (!next.startsWith('-') || next.startsWith('---')) break
        deletions.push(next.slice(1))
        index += 1
      }

      const additions: string[] = []
      while (index < lines.length) {
        const next = lines[index] ?? ''
        if (!next.startsWith('+') || next.startsWith('+++')) break
        additions.push(next.slice(1))
        index += 1
      }

      const pairCount = Math.max(deletions.length, additions.length)
      for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
        rows.push({
          kind: 'pair',
          leftKind: pairIndex < deletions.length ? 'deletion' : 'empty',
          rightKind: pairIndex < additions.length ? 'addition' : 'empty',
          leftText: deletions[pairIndex] ?? '',
          rightText: additions[pairIndex] ?? '',
        })
      }
      continue
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      rows.push({
        kind: 'pair',
        leftKind: 'empty',
        rightKind: 'addition',
        leftText: '',
        rightText: line.slice(1),
      })
      index += 1
      continue
    }

    if (line.startsWith(' ')) {
      rows.push({
        kind: 'pair',
        leftKind: 'context',
        rightKind: 'context',
        leftText: line.slice(1),
        rightText: line.slice(1),
      })
      index += 1
      continue
    }

    rows.push({ kind: 'meta', text: line })
    index += 1
  }

  return rows
}
