import { createHash } from 'node:crypto'
import { parsePatchFiles } from '@pierre/diffs'
import type { ReviewDocument, ReviewHunk, ReviewLine, ReviewNote } from './types'

export function reviewDigest(value: string): string { return createHash('sha256').update(value).digest('hex') }

/** Use Pierre's parsed model so code addresses agree with both renderers. */
export function reviewDocument(patch: string): ReviewDocument {
  const revision = reviewDigest(patch)
  const files = parsePatchFiles(patch, revision, false).flatMap(part => part.files)
  const hunks: ReviewHunk[] = []
  const paths: string[] = []
  for (const file of files) {
    const filePath = (file.name || file.prevName || 'unknown').replace(/^[ab]\//, '')
    paths.push(filePath)
    file.hunks.forEach((hunk, index) => {
      const lines: ReviewLine[] = []
      let oldLine = hunk.deletionStart
      let newLine = hunk.additionStart
      const clean = (text: string) => text.replace(/\r?\n$/, '')
      for (const content of hunk.hunkContent) {
        if (content.type === 'context') {
          for (let i = 0; i < content.lines; i++) lines.push({ oldLine: oldLine++, newLine: newLine++, text: clean(file.additionLines[content.additionLineIndex + i] ?? '') })
        } else {
          for (let i = 0; i < content.deletions; i++) lines.push({ oldLine: oldLine++, text: clean(file.deletionLines[content.deletionLineIndex + i] ?? '') })
          for (let i = 0; i < content.additions; i++) lines.push({ newLine: newLine++, text: clean(file.additionLines[content.additionLineIndex + i] ?? '') })
        }
      }
      // Exclude line numbers: inserting lines above an unchanged hunk keeps its identity.
      const id = reviewDigest(JSON.stringify([filePath, lines.map(line => [line.oldLine != null, line.newLine != null, line.text])]))
      hunks.push({ id, filePath, index, header: hunk.hunkSpecs ?? `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`, lines })
    })
  }
  const counts = new Map<string, number>()
  for (const hunk of hunks) counts.set(hunk.id, (counts.get(hunk.id) ?? 0) + 1)
  for (const hunk of hunks) if (counts.get(hunk.id)! > 1) hunk.id = reviewDigest(`${hunk.id}:${revision}:${hunk.index}`)
  return { revision, files: paths, hunks }
}

function lineAt(line: ReviewLine, side: string | undefined) { return side === 'deletions' ? line.oldLine : line.newLine }

export function noteHunk(document: ReviewDocument, note: Pick<ReviewNote, 'filePath' | 'range'>): ReviewHunk | undefined {
  return document.hunks.find(hunk => hunk.filePath === note.filePath
    && hunk.lines.some(line => lineAt(line, note.range.side) === note.range.start)
    && hunk.lines.some(line => lineAt(line, note.range.endSide ?? note.range.side) === note.range.end))
}

export function anchorNote(document: ReviewDocument, note: ReviewNote): ReviewNote {
  const hunk = noteHunk(document, note)
  if (!hunk) throw new Error('The selected range is not in a current review hunk. Refresh and select it again.')
  return { ...note, resolution: 'active', anchor: {
    hunkId: hunk.id, oldStart: hunk.lines.find(line => line.oldLine != null)?.oldLine ?? 0,
    newStart: hunk.lines.find(line => line.newLine != null)?.newLine ?? 0,
  } }
}

/** Reattach only when the original hunk content is proven unchanged. Keep uncertain notes for inspection. */
export function reconcileNote(document: ReviewDocument, note: ReviewNote): ReviewNote {
  const hunk = note.anchor && document.hunks.find(item => item.id === note.anchor!.hunkId)
  if (!hunk || !note.anchor) return { ...note, resolution: noteHunk(document, note) ? 'stale' : 'orphaned' }
  const oldStart = hunk.lines.find(line => line.oldLine != null)?.oldLine ?? 0
  const newStart = hunk.lines.find(line => line.newLine != null)?.newLine ?? 0
  const delta = (side: string | undefined) => side === 'deletions' ? oldStart - note.anchor!.oldStart : newStart - note.anchor!.newStart
  return { ...note, resolution: 'active', range: { ...note.range,
    start: note.range.start + delta(note.range.side), end: note.range.end + delta(note.range.endSide ?? note.range.side),
  }, anchor: { hunkId: hunk.id, oldStart, newStart } }
}
