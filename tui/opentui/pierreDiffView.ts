import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
import { prepareFileTreeInput } from '@pierre/trees'

export type TuiPierreDiffRowTone = 'file' | 'tree' | 'hunk' | 'context' | 'addition' | 'deletion' | 'meta'

export type TuiPierreDiffRow = {
  key: string
  tone: TuiPierreDiffRowTone
  text: string
  oldLine?: number
  newLine?: number
  indicator?: string
}

export type TuiPierreDiffView = {
  rows: TuiPierreDiffRow[]
}

export function buildPierreDiffView(diffText: string, cacheKey: string): TuiPierreDiffView | null {
  const rows: TuiPierreDiffRow[] = []
  try {
    const parsed = parsePatchFiles(diffText, cacheKey, false)
    const files = parsed.flatMap((patch) => patch.files)
    if (files.length === 0) return buildFallbackDiffView(diffText, cacheKey)

    const orderedFiles = orderDiffFiles(files)
    if (orderedFiles.length > 1) {
      rows.push({
        key: `${cacheKey}:tree:summary`,
        tone: 'meta',
        text: `${orderedFiles.length} files changed`,
      })
      for (const [index, path] of diffTreePaths(orderedFiles).entries()) {
        rows.push({
          key: `${cacheKey}:tree:${index}`,
          tone: 'tree',
          text: treePathLabel(path, index, orderedFiles.length),
        })
      }
    }

    for (const [fileIndex, file] of orderedFiles.entries()) {
      if (fileIndex > 0 || rows.length > 0) {
        rows.push({ key: `${cacheKey}:spacer:${fileIndex}`, tone: 'meta', text: '' })
      }
      rows.push({
        key: `${cacheKey}:file:${fileIndex}`,
        tone: 'file',
        text: diffFileLabel(file),
      })
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
          text: cleanDiffLineText(hunk.hunkSpecs ?? `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@${hunk.hunkContext ? ` ${hunk.hunkContext}` : ''}`),
        })

        let oldLine = hunk.deletionStart
        let newLine = hunk.additionStart
        for (const [contentIndex, content] of hunk.hunkContent.entries()) {
          if (content.type === 'context') {
            for (let lineIndex = 0; lineIndex < content.lines; lineIndex++) {
              rows.push({
                key: `${cacheKey}:file:${fileIndex}:hunk:${hunkIndex}:ctx:${contentIndex}:${lineIndex}`,
                tone: 'context',
                text: cleanDiffLineText(file.additionLines[content.additionLineIndex + lineIndex] ?? file.deletionLines[content.deletionLineIndex + lineIndex] ?? ''),
                oldLine: oldLine++,
                newLine: newLine++,
                indicator: ' ',
              })
            }
          } else {
            for (let lineIndex = 0; lineIndex < content.deletions; lineIndex++) {
              rows.push({
                key: `${cacheKey}:file:${fileIndex}:hunk:${hunkIndex}:del:${contentIndex}:${lineIndex}`,
                tone: 'deletion',
                text: cleanDiffLineText(file.deletionLines[content.deletionLineIndex + lineIndex] ?? ''),
                oldLine: oldLine++,
                indicator: '-',
              })
            }
            for (let lineIndex = 0; lineIndex < content.additions; lineIndex++) {
              rows.push({
                key: `${cacheKey}:file:${fileIndex}:hunk:${hunkIndex}:add:${contentIndex}:${lineIndex}`,
                tone: 'addition',
                text: cleanDiffLineText(file.additionLines[content.additionLineIndex + lineIndex] ?? ''),
                newLine: newLine++,
                indicator: '+',
              })
            }
          }
        }
      }
    }

    return rows.length > 0 ? { rows } : null
  } catch {
    return buildFallbackDiffView(diffText, cacheKey)
  }
}

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
  return rows.length > 0 ? { rows } : null
}

function orderDiffFiles(files: FileDiffMetadata[]): FileDiffMetadata[] {
  const prepared = prepareFileTreeInput(files.map((file) => diffDisplayPath(file)), {
    flattenEmptyDirectories: true,
    sort: 'default',
  })
  const order = new Map(prepared.paths.map((path, index) => [path, index]))
  return [...files].sort((left, right) => {
    const leftOrder = order.get(diffDisplayPath(left)) ?? Number.MAX_SAFE_INTEGER
    const rightOrder = order.get(diffDisplayPath(right)) ?? Number.MAX_SAFE_INTEGER
    return leftOrder - rightOrder || diffDisplayPath(left).localeCompare(diffDisplayPath(right))
  })
}

function diffTreePaths(files: FileDiffMetadata[]): string[] {
  return [...prepareFileTreeInput(files.map((file) => diffDisplayPath(file)), {
    flattenEmptyDirectories: true,
    sort: 'default',
  }).paths]
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
