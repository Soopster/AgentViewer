// What the What's new views share: the flat list they navigate and what each
// row shows in the detail pane. Both renderers draw from this, so a row means
// the same thing on the Web and in the terminal.

import { formatWhatsNewMarkdown, whatsNewKindLabel, whatsNewRevisionStats, WHATS_NEW_FILE_LIMIT, type WhatsNew, type WhatsNewFile, type WhatsNewHighlight, type WhatsNewKind, type WhatsNewRevision } from './whatsNew'

export type WhatsNewRow = {
  /** `r:<revision id>` or `h:<revision id>:<sha>`; stable across refreshes. */
  key: string
  type: 'revision' | 'highlight'
  revisionId: string
  label: string
  /** The muted second line. */
  meta: string
  kind: WhatsNewKind | null
}

export type WhatsNewDetail = {
  key: string
  title: string
  /** Stats or the area and short hash. */
  subtitle: string
  /** Why the change was made, when the commit said. */
  note: string | null
  kind: WhatsNewKind | null
  files: WhatsNewFile[]
  /** Files touched beyond the ones kept. */
  hiddenFiles: number
  added: number
  removed: number
  /** The selected item as markdown, for copy. */
  markdown: string
}

export const revisionKey = (revision: WhatsNewRevision) => `r:${revision.id}`
export const highlightKey = (revision: WhatsNewRevision, highlight: WhatsNewHighlight) => `h:${revision.id}:${highlight.sha}`

function date(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** A revision, then its highlights, in order. Chores are not rows: they appear in the revision's own file list. */
export function whatsNewRows(summary: WhatsNew): WhatsNewRow[] {
  const rows: WhatsNewRow[] = []
  for (const revision of summary.revisions) {
    rows.push({
      key: revisionKey(revision), type: 'revision', revisionId: revision.id, kind: null,
      label: revision.title,
      meta: `${revision.commits} commit${revision.commits === 1 ? '' : 's'} · ${revision.files} file${revision.files === 1 ? '' : 's'}`,
    })
    for (const highlight of revision.highlights) {
      rows.push({
        key: highlightKey(revision, highlight), type: 'highlight', revisionId: revision.id, kind: highlight.kind,
        label: highlight.subject,
        meta: `${whatsNewKindLabel(highlight.kind)}${highlight.area ? ` · ${highlight.area}` : ''} · ${highlight.files} file${highlight.files === 1 ? '' : 's'}`,
      })
    }
  }
  return rows
}

function filesMarkdown(files: readonly WhatsNewFile[], hidden: number): string[] {
  if (files.length === 0) return ['_No files changed._']
  const lines = files.map(file => `- ${file.path} (+${file.added} −${file.removed})`)
  if (hidden > 0) lines.push(`- _and ${hidden} more file${hidden === 1 ? '' : 's'}_`)
  return lines
}

/** What the detail pane shows for a row, or null when the key no longer exists (after a refresh). */
export function whatsNewDetail(summary: WhatsNew, key: string): WhatsNewDetail | null {
  for (const revision of summary.revisions) {
    if (key === revisionKey(revision)) {
      const hidden = Math.max(revision.files - revision.fileList.length, 0)
      return {
        key, title: revision.title, subtitle: whatsNewRevisionStats(revision), note: null, kind: null,
        files: revision.fileList, hiddenFiles: hidden, added: revision.added, removed: revision.removed,
        markdown: formatWhatsNewMarkdown({ ...summary, revisions: [revision], truncated: false }) + `\n### Files changed\n${filesMarkdown(revision.fileList, hidden).join('\n')}\n`,
      }
    }
    for (const highlight of revision.highlights) {
      if (key !== highlightKey(revision, highlight)) continue
      const hidden = Math.max(highlight.files - highlight.fileList.length, 0)
      const subtitle = `${highlight.area ? `${highlight.area} · ` : ''}${highlight.sha.slice(0, 7)} · ${date(highlight.timestampMs)}`
      return {
        key, title: highlight.subject, subtitle, note: highlight.detail, kind: highlight.kind,
        files: highlight.fileList, hiddenFiles: hidden, added: highlight.added, removed: highlight.removed,
        markdown: [`## ${highlight.subject}`, `_${subtitle}_`, ...(highlight.detail ? ['', highlight.detail] : []), '', '### Files changed', ...filesMarkdown(highlight.fileList, hidden), ''].join('\n'),
      }
    }
  }
  return null
}

/** The selection after a list changes: the same row if it survives, else the first. */
export function reconcileWhatsNewSelection(rows: readonly WhatsNewRow[], key: string | null): string | null {
  if (key && rows.some(row => row.key === key)) return key
  return rows[0]?.key ?? null
}

/** A directory/name split so a long path can show its name first and keep its folder muted. */
export function splitWhatsNewPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? { dir: '', name: path } : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) }
}

/** Width of the +/- bar for a file, relative to the largest in the list. */
export function changeBarCells(file: WhatsNewFile, largest: number, cells: number): { add: number; remove: number } {
  const total = file.added + file.removed
  if (total === 0 || largest === 0) return { add: 0, remove: 0 }
  const used = Math.max(1, Math.round((total / largest) * cells))
  const add = file.removed === 0 ? used : file.added === 0 ? 0 : Math.min(used - 1, Math.max(1, Math.round((file.added / total) * used)))
  return { add, remove: used - add }
}

export { WHATS_NEW_FILE_LIMIT }
