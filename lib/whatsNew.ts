// What's new: the highlights of a repository's history, revision by revision.
//
// A revision is a release (a tag) when the history has tags, otherwise one
// calendar day, because a repository with no releases still ships in days.
// No Node imports: the reader (`lib/whatsNewReader.ts`) hands over parsed
// commits and this module only groups, scores and formats, so the whole shape
// is testable without a repository.
//
// Highlights are chosen by a deterministic score, never a model: the same
// history reads the same every time, and a summary that varies per open would
// make "what's new" unreliable as a record.

export type WhatsNewCommit = {
  sha: string
  subject: string
  /** The message body, trimmed by the reader. */
  body: string
  author: string
  timestampMs: number
  /** Tags pointing at this commit. */
  tags: string[]
  files: { path: string; added: number; removed: number }[]
}

export type WhatsNewKind = 'feature' | 'fix' | 'improvement' | 'chore'

/** A file a change touched, with how many lines it added and removed there. */
export type WhatsNewFile = { path: string; added: number; removed: number }

/** Files kept per change; the rest are counted, never silently dropped. */
export const WHATS_NEW_FILE_LIMIT = 150

export type WhatsNewHighlight = {
  sha: string
  subject: string
  /** The first paragraph of the body: why the change was made. */
  detail: string | null
  kind: WhatsNewKind
  /** The part of the repository it touched most, e.g. a plugin id or a top-level folder. */
  area: string | null
  timestampMs: number
  files: number
  added: number
  removed: number
  score: number
  /** Largest changes first, at most `WHATS_NEW_FILE_LIMIT`. */
  fileList: WhatsNewFile[]
}

export type WhatsNewRevision = {
  /** The tag name, or the local date (YYYY-MM-DD). */
  id: string
  title: string
  kind: 'release' | 'day'
  fromMs: number
  toMs: number
  commits: number
  files: number
  added: number
  removed: number
  authors: string[]
  counts: Record<WhatsNewKind, number>
  highlights: WhatsNewHighlight[]
  /** Commits that did not make the highlights. */
  others: number
  /** Every file the revision touched, summed over its commits, largest first, at most `WHATS_NEW_FILE_LIMIT`. */
  fileList: WhatsNewFile[]
}

export type WhatsNew = {
  generatedAt: number
  /** Commits read; a long history is cut at the reader's limit, and that is said. */
  scanned: number
  truncated: boolean
  grouping: 'release' | 'day'
  revisions: WhatsNewRevision[]
}

export const WHATS_NEW_KINDS: readonly WhatsNewKind[] = ['feature', 'improvement', 'fix', 'chore']
export const DEFAULT_REVISION_LIMIT = 14
export const HIGHLIGHTS_PER_REVISION = 5

const CHORE = /^(bump|update (?:all )?(?:dependencies|packages|deps)|merge|revert|chore|wip|typo|lint|format|release|version)\b/i
const FEATURE = /^(add|introduce|new|ship|support|enable|allow|build|create|implement|launch|let|give|make|show|port)\b/i
const FIX = /^(fix|repair|resolve|correct|stop|prevent|handle|guard|avoid|patch)\b/i

export function classifyCommit(subject: string): WhatsNewKind {
  const text = subject.trim().replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '')
  if (CHORE.test(text) || /^(refactor|rename|move|extract|clean|document|docs?|tidy)\b/i.test(text)) return 'chore'
  if (FIX.test(text)) return 'fix'
  if (FEATURE.test(text)) return 'feature'
  return 'improvement'
}

/** `plugins/git/web/X.tsx` is the `git` plugin; `lib/x.ts` is `lib`. */
export function areaOfPath(path: string): string {
  const parts = path.split('/')
  if (parts[0] === 'plugins' && parts[1]) return parts[1]
  if (parts[0] === 'docs' || parts[0] === 'scripts') return parts[0]
  if (parts.length === 1) return 'root'
  return parts[0]!
}

// Shared folders every feature touches say nothing about which feature it was.
const GENERIC_AREAS = new Set(['lib', 'components', 'tui', 'app', 'bin', 'scripts', 'docs', 'root'])

function dominantArea(files: WhatsNewCommit['files']): string | null {
  const weight = new Map<string, number>()
  const named = files.filter(file => !GENERIC_AREAS.has(areaOfPath(file.path)))
  for (const file of named.length > 0 ? named : files) {
    const area = areaOfPath(file.path)
    weight.set(area, (weight.get(area) ?? 0) + 1 + Math.min(file.added + file.removed, 400) / 100)
  }
  let best: string | null = null
  let bestWeight = 0
  for (const [area, value] of weight) if (value > bestWeight) { best = area; bestWeight = value }
  // A lockfile-only or docs-only change has no area worth naming.
  return best === 'root' ? null : best
}

const LOCKFILES = /(^|\/)(package-lock\.json|bun\.lock|pnpm-lock\.yaml|yarn\.lock)$/

function topFiles(files: Iterable<WhatsNewFile>): WhatsNewFile[] {
  return [...files].sort((a, b) => (b.added + b.removed) - (a.added + a.removed) || a.path.localeCompare(b.path)).slice(0, WHATS_NEW_FILE_LIMIT)
}

/** One entry per path: a rename shows its destination, and a file edited twice is summed. */
function mergeFiles(commits: readonly WhatsNewCommit[]): Map<string, WhatsNewFile> {
  const merged = new Map<string, WhatsNewFile>()
  for (const commit of commits) {
    for (const file of commit.files) {
      if (LOCKFILES.test(file.path)) continue
      const known = merged.get(file.path)
      if (known) { known.added += file.added; known.removed += file.removed } else merged.set(file.path, { ...file })
    }
  }
  return merged
}

function measure(commit: WhatsNewCommit) {
  const paths = new Set<string>()
  let added = 0
  let removed = 0
  for (const file of commit.files) {
    if (LOCKFILES.test(file.path)) continue
    paths.add(file.path)
    added += file.added
    removed += file.removed
  }
  return { files: paths.size, added, removed }
}

/** Size, a feature verb and a body that explains why all raise a commit; chores sink. */
export function scoreCommit(commit: WhatsNewCommit, kind: WhatsNewKind = classifyCommit(commit.subject)): number {
  const { files, added, removed } = measure(commit)
  const size = Math.log2(1 + files) + Math.min(added + removed, 3000) / 600
  const explained = Math.min(commit.body.length, 800) / 200
  const base = { feature: 3, improvement: 1.5, fix: 1, chore: -3 }[kind]
  return Math.round((base + size + explained) * 100) / 100
}

function firstParagraph(body: string): string | null {
  const paragraph = body.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim()
  if (!paragraph) return null
  return paragraph.length > 280 ? `${paragraph.slice(0, 279)}…` : paragraph
}

function localDay(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dayTitle(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year!, month! - 1, date!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function summarize(id: string, title: string, kind: WhatsNewRevision['kind'], commits: WhatsNewCommit[]): WhatsNewRevision {
  const counts: Record<WhatsNewKind, number> = { feature: 0, improvement: 0, fix: 0, chore: 0 }
  const authors = new Set<string>()
  const files = new Set<string>()
  let added = 0
  let removed = 0
  const ranked: WhatsNewHighlight[] = []
  for (const commit of commits) {
    const commitKind = classifyCommit(commit.subject)
    counts[commitKind]++
    if (commit.author) authors.add(commit.author)
    for (const file of commit.files) if (!LOCKFILES.test(file.path)) files.add(file.path)
    const size = measure(commit)
    added += size.added
    removed += size.removed
    ranked.push({
      sha: commit.sha,
      subject: commit.subject,
      detail: firstParagraph(commit.body),
      kind: commitKind,
      area: dominantArea(commit.files),
      timestampMs: commit.timestampMs,
      files: size.files,
      added: size.added,
      removed: size.removed,
      score: scoreCommit(commit, commitKind),
      fileList: topFiles(mergeFiles([commit]).values()),
    })
  }
  // A chore never headlines a revision, even one with nothing else in it.
  const candidates = ranked.filter(entry => entry.kind !== 'chore').sort((a, b) => b.score - a.score || b.timestampMs - a.timestampMs)
  const highlights = candidates.slice(0, HIGHLIGHTS_PER_REVISION)
  return {
    id, title, kind,
    fromMs: Math.min(...commits.map(commit => commit.timestampMs)),
    toMs: Math.max(...commits.map(commit => commit.timestampMs)),
    commits: commits.length,
    files: files.size, added, removed,
    authors: [...authors],
    counts,
    highlights,
    others: commits.length - highlights.length,
    fileList: topFiles(mergeFiles(commits).values()),
  }
}

/** Newest-first commits in; newest-first revisions out. A tag closes a release at its own commit. */
export function buildWhatsNew(commits: readonly WhatsNewCommit[], options: { limit?: number; truncated?: boolean; now?: number } = {}): WhatsNew {
  const limit = options.limit ?? DEFAULT_REVISION_LIMIT
  const sorted = [...commits].sort((a, b) => b.timestampMs - a.timestampMs)
  const tagged = sorted.some(commit => commit.tags.length > 0)
  const revisions: WhatsNewRevision[] = []
  let bucket: WhatsNewCommit[] = []
  let bucketId = ''
  let bucketTitle = ''

  const flush = () => {
    if (bucket.length > 0) revisions.push(summarize(bucketId, bucketTitle, tagged ? 'release' : 'day', bucket))
    bucket = []
  }

  if (tagged) {
    // Newest first, so commits after the newest tag are unreleased work.
    bucketId = 'unreleased'
    bucketTitle = 'Unreleased'
    for (const commit of sorted) {
      if (commit.tags.length > 0) {
        flush()
        bucketId = commit.tags[0]!
        bucketTitle = commit.tags[0]!
      }
      bucket.push(commit)
    }
    flush()
  } else {
    for (const commit of sorted) {
      const day = localDay(commit.timestampMs)
      if (day !== bucketId) { flush(); bucketId = day; bucketTitle = dayTitle(day) }
      bucket.push(commit)
    }
    flush()
  }

  const shown = revisions.slice(0, limit)
  return {
    generatedAt: options.now ?? Date.now(),
    scanned: sorted.length,
    // The oldest revision shown may be cut by the scan limit mid-way, and later ones are simply not read.
    truncated: Boolean(options.truncated) || revisions.length > shown.length,
    grouping: tagged ? 'release' : 'day',
    revisions: shown,
  }
}

const KIND_LABEL: Record<WhatsNewKind, string> = { feature: 'New', improvement: 'Improved', fix: 'Fixed', chore: 'Maintenance' }
export const whatsNewKindLabel = (kind: WhatsNewKind): string => KIND_LABEL[kind]

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** One line: `12 commits · 41 files · +3,120 −880 · 3 new, 2 fixed`. */
export function whatsNewRevisionStats(revision: WhatsNewRevision): string {
  const parts = [plural(revision.commits, 'commit'), plural(revision.files, 'file'), `+${revision.added.toLocaleString('en-US')} −${revision.removed.toLocaleString('en-US')}`]
  const kinds = (['feature', 'improvement', 'fix'] as const)
    .filter(kind => revision.counts[kind] > 0)
    .map(kind => `${revision.counts[kind]} ${KIND_LABEL[kind].toLowerCase()}`)
  if (kinds.length > 0) parts.push(kinds.join(', '))
  return parts.join(' · ')
}

/** The document both UIs show and copy; line shape is what `whatsNewLineTone` reads back. */
export function formatWhatsNewMarkdown(summary: WhatsNew): string {
  if (summary.revisions.length === 0) return "# What's new\n\n_No commits to summarize._\n"
  const lines = ["# What's new", '']
  for (const revision of summary.revisions) {
    lines.push(`## ${revision.title}`, `_${whatsNewRevisionStats(revision)}_`, '')
    if (revision.highlights.length === 0) lines.push('_Maintenance only._', '')
    for (const highlight of revision.highlights) {
      const area = highlight.area ? ` (${highlight.area})` : ''
      lines.push(`- **${KIND_LABEL[highlight.kind]}:** ${highlight.subject}${area}`)
      if (highlight.detail) lines.push(`  ${highlight.detail}`)
    }
    if (revision.others > 0 && revision.highlights.length > 0) lines.push(`- _and ${plural(revision.others, 'other change')}_`)
    lines.push('')
  }
  if (summary.truncated) lines.push('_Older history is not shown._', '')
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

export type WhatsNewLineTone = 'title' | 'revision' | 'stats' | 'item' | 'detail' | 'note' | 'plain'

export function whatsNewLineTone(line: string): WhatsNewLineTone {
  if (line.startsWith('# ')) return 'title'
  if (line.startsWith('## ')) return 'revision'
  if (/^_.*_$/.test(line) && !line.startsWith('- ')) return /\bcommits?\b/.test(line) ? 'stats' : 'note'
  if (line.startsWith('- _')) return 'note'
  if (line.startsWith('- ')) return 'item'
  if (line.startsWith('  ')) return 'detail'
  return 'plain'
}
