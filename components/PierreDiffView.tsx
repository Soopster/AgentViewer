'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { FileDiff, MultiFileDiff } from '@pierre/diffs/react'
import { parsePatchFiles, type DiffLineAnnotation, type FileDiffMetadata, type FileDiffOptions, type SelectedLineRange } from '@pierre/diffs'
import { createFileTreeIconResolver, getBuiltInSpriteSheet, prepareFileTreeInput } from '@pierre/trees'

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

const DIFF_OPTIONS: FileDiffOptions<undefined> = {
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

function getDiffOptions(presentation?: PierreDiffPresentation): FileDiffOptions<undefined> {
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
}

function PierreDiffFrame({ children, maxHeight }: PierreDiffFrameProps) {
  return (
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
        disableWorkerPool
      />
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
}) {
  const files = useMemo(() => parsePatchDiffFiles(patch), [patch])

  if (files.length === 0) {
    return (
      <PierreDiffFrame maxHeight={maxHeight}>
        <PierreFallbackDiffView text={patch || emptyLabel} />
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
              onLineSelectionStart: onSelectedLinesChange,
              onLineSelectionChange: onSelectedLinesChange,
              onLineSelectionEnd: onSelectedLinesChange,
              onLineSelected: onSelectedLinesChange,
            }}
            selectedLines={selectedLines}
            renderAnnotation={renderAnnotation}
            disableWorkerPool
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

function PierreFallbackDiffView({ text }: { text: string }) {
  const lines = text.split('\n').slice(0, 240)
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
