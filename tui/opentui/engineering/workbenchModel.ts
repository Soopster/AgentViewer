import { posix, win32 } from 'node:path'
import type { TuiTranscriptCard } from '../../format'
import type { ManagedProcess } from '../processStore'
import type { EngineeringRepository } from './repository'

export type WorkSession = { key: string; title: string; provider?: string }
export type AcceptanceCriterion = { id: string; text: string; review: 'pending' | 'accepted' | 'needs-work' }
export type WorkEvidence = { id: string; criterionId: string; session: WorkSession; cardKey: string; preview: string; files: string[] }
export type TaskBrief = {
  title: string; objective: string; criteria: AcceptanceCriterion[]
  constraints: string; questions: string; decisions: string
  sessions: WorkSession[]; evidence: WorkEvidence[]; updatedAt: number | null
}
export type BriefField = 'title' | 'objective' | 'criteria' | 'constraints' | 'questions' | 'decisions'
export const emptyTaskBrief = (): TaskBrief => ({ title: '', objective: '', criteria: [], constraints: '', questions: '', decisions: '', sessions: [], evidence: [], updatedAt: null })

/** Reordering or saving unchanged criteria retains their review and evidence identities. */
export function editTaskBrief(brief: TaskBrief, field: BriefField, value: string, now = Date.now()): TaskBrief {
  if (field !== 'criteria') return { ...brief, [field]: field === 'title' ? value.trim().replace(/\s+/g, ' ') : value.trim(), updatedAt: now }
  const unused = [...brief.criteria]
  const criteria = value.split('\n').map(line => line.trim().replace(/^(?:[-*]|\d+[.)])\s+/, '')).filter(Boolean).map(text => {
    const at = unused.findIndex(item => item.text === text)
    return at >= 0 ? unused.splice(at, 1)[0]! : { id: crypto.randomUUID(), text, review: 'pending' as const }
  })
  const ids = new Set(criteria.map(item => item.id))
  return { ...brief, criteria, evidence: brief.evidence.filter(item => ids.has(item.criterionId)), updatedAt: now }
}

export function pinTaskEvidence(brief: TaskBrief, criterionId: string | undefined, session: WorkSession | null, message: TuiTranscriptCard | null, files: string[]): TaskBrief {
  if (!criterionId || !session || !message || !brief.criteria.some(item => item.id === criterionId)) return brief
  if (brief.evidence.some(item => item.criterionId === criterionId && item.cardKey === message.key && item.session.key === session.key)) return brief
  const pin: WorkEvidence = { id: crypto.randomUUID(), criterionId, session, cardKey: message.key, preview: message.compactSummary.slice(0, 300), files }
  return { ...brief, evidence: [...brief.evidence, pin], updatedAt: Date.now() }
}

export type CheckResult = { outcome: 'passed' | 'failed' | 'stopped'; exitCode: number | null; completedAt: number; output: string[] }
export const ENGINEERING_RUNTIME_ID = crypto.randomUUID()
export type EngineeringCheck = {
  processId?: string; runtimeId?: string
  id: string; command: string; fingerprint: string; cwd: string; session: string | null
  criterionId?: string; filePaths?: string[]; result?: CheckResult
}
export type Verification = { state: 'running' | 'passed' | 'failed' | 'stopped' | 'stale' | 'unavailable'; result?: CheckResult }

/** Process IDs restart at proc-1. A saved record must never bind to a later run. */
export function findCheckProcess(check: EngineeringCheck, processes: readonly ManagedProcess[], runtimeId = ENGINEERING_RUNTIME_ID): ManagedProcess | undefined {
  if (check.runtimeId !== runtimeId || !check.processId) return undefined
  return processes.find(process => process.id === check.processId && process.command === check.command && process.cwd === check.cwd)
}

export function completedCheckResult(process: ManagedProcess | undefined): CheckResult | undefined {
  if (!process || (process.status !== 'exited' && process.status !== 'failed') || process.endedAt == null) return undefined
  return {
    outcome: process.signal ? 'stopped' : process.status === 'exited' && process.exitCode === 0 ? 'passed' : 'failed',
    exitCode: process.exitCode, completedAt: process.endedAt,
    output: process.lines.slice(-8).map(line => line.slice(0, 600)),
  }
}

export function checkVerification(check: EngineeringCheck, process: ManagedProcess | undefined, fingerprint: string | null): Verification {
  if (process && ['idle', 'running', 'stopping'].includes(process.status)) return { state: 'running' }
  const result = completedCheckResult(process) ?? check.result
  if (!result) return { state: 'unavailable' }
  return { state: fingerprint && fingerprint === check.fingerprint ? result.outcome : 'stale', result }
}

/** Transcript order is evidence of a shared turn, not proof of why a hunk exists. */
export type ChangeEvidence = { edit: TuiTranscriptCard; request?: TuiTranscriptCard; response?: TuiTranscriptCard }
export function workRelativePath(path: string, root: string): string | null {
  const paths = /^[A-Za-z]:[\\/]/.test(root) ? win32 : posix
  const relative = paths.isAbsolute(path) ? paths.relative(root, path) : path
  const result = paths.normalize(relative)
  if (paths.isAbsolute(result) || result === '..' || result.startsWith(`..${paths.sep}`)) return null
  return paths === win32 ? result.replaceAll('\\', '/') : result
}

export function indexChangeEvidence(cards: readonly TuiTranscriptCard[], root: string): Map<string, ChangeEvidence[]> {
  const index = new Map<string, ChangeEvidence[]>()
  let request: TuiTranscriptCard | undefined
  let turnEdits: ChangeEvidence[] = []
  for (const card of cards) {
    if (card.role === 'user' && card.category === 'conversation') { request = card; turnEdits = [] }
    if (card.role === 'assistant' && card.category === 'conversation') {
      for (const item of turnEdits) if (!item.response) item.response = card
    }
    if (card.pending || !card.fileEdits?.length) continue
    for (const path of new Set(card.fileEdits.map(edit => workRelativePath(edit.path, root)).filter((path): path is string => path !== null))) {
      const item = { edit: card, request }
      const list = index.get(path) ?? []
      list.push(item); index.set(path, list); turnEdits.push(item)
    }
  }
  return index
}

export type WorkSnapshot = {
  capturedAt: number; reviewed: boolean; branch: string
  files: Record<string, string>; sessions: Record<string, { title: string; version: string }>
  checks: Record<string, string>; attention: string[]
}
export type WorkDelta = {
  files: Array<{ path: string; change: 'new' | 'updated' | 'no longer changed' }>
  sessions: Array<{ key: string; title: string; change: 'newly observed' | 'updated' }>
  checks: string[]; attention: string[]; branchChanged: boolean; count: number
}

export function workSnapshot(repository: EngineeringRepository, sessions: Array<WorkSession & { version: string }>, checks: Array<{ id: string; verification: Verification }>, attention: string[], now = Date.now()): WorkSnapshot {
  return {
    capturedAt: now, reviewed: false, branch: repository.branch,
    files: Object.fromEntries(repository.files.map(file => [file.path, file.version ?? `${file.status}:${file.additions}:${file.deletions}`])),
    sessions: Object.fromEntries(sessions.map(session => [session.key, { title: session.title, version: session.version }])),
    checks: Object.fromEntries(checks.map(({ id, verification }) => [id, `${verification.state}:${verification.result?.completedAt ?? ''}`])),
    attention,
  }
}

export function compareWorkSnapshots(previous: WorkSnapshot | null, current: WorkSnapshot | null): WorkDelta {
  const delta: WorkDelta = { files: [], sessions: [], checks: [], attention: [], branchChanged: false, count: 0 }
  if (!previous || !current) return delta
  for (const [path, version] of Object.entries(current.files)) {
    if (previous.files[path] !== version) delta.files.push({ path, change: Object.hasOwn(previous.files, path) ? 'updated' : 'new' })
  }
  for (const path of Object.keys(previous.files)) if (!Object.hasOwn(current.files, path)) delta.files.push({ path, change: 'no longer changed' })
  for (const [key, session] of Object.entries(current.sessions)) {
    if (previous.sessions[key]?.version !== session.version) delta.sessions.push({ key, title: session.title, change: Object.hasOwn(previous.sessions, key) ? 'updated' : 'newly observed' })
  }
  delta.checks = Object.keys(current.checks).filter(id => previous.checks[id] !== current.checks[id])
  delta.attention = current.attention.filter(id => !previous.attention.includes(id))
  delta.branchChanged = current.branch !== previous.branch
  delta.count = delta.files.length + delta.sessions.length + delta.checks.length + delta.attention.length + Number(delta.branchChanged)
  return delta
}

/** A provider switch must not forget observations from another provider's catalog. */
export function acknowledgeWorkSnapshot(previous: WorkSnapshot | null, current: WorkSnapshot): WorkSnapshot {
  return { ...current, reviewed: true, sessions: { ...previous?.sessions, ...current.sessions } }
}

export function taskBriefMarkdown(brief: TaskBrief): string {
  return [
    `# ${brief.title || 'Task brief'}`, '\n## Objective', brief.objective || 'Not recorded.',
    '\n## Acceptance criteria', ...brief.criteria.map(item => `- [${item.review === 'accepted' ? 'x' : ' '}] ${item.text}${item.review === 'needs-work' ? ' (needs work)' : ''}`),
    '\n## Constraints', brief.constraints || 'None recorded.', '\n## Open questions', brief.questions || 'None recorded.',
    '\n## Decisions', brief.decisions || 'None recorded.', '\n## Linked sessions', ...brief.sessions.map(session => `- ${session.title} [${session.key}]`),
    '\n## Pinned evidence', ...brief.evidence.map(item => `- ${item.preview} [${item.session.key} / ${item.cardKey}]`),
    '\nAcceptance marks are manual review decisions; check results are recorded separately.',
  ].join('\n')
}

/** Explicit timezone keeps recorded evidence timestamps unambiguous. */
export function formatWorkTimestamp(value: number): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown time' : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
