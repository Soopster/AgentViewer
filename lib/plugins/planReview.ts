/** Shared Plan Review contract. No renderer or provider runtime dependencies. */
import type { SessionIdentity } from '../sessionIdentity'
import type { SessionMessage } from '../types'
export type PlanTarget = SessionIdentity & { provider: NonNullable<SessionIdentity['provider']> }
export type PlanSource = { kind: 'message' | 'file' | 'native'; target: PlanTarget; messageId?: string; path?: string; automatic?: boolean; permissionId?: string; permissionToken?: string }
export type PlanAnchor = { quote: string; start: number; end: number; prefix: string; suffix: string; line: number; status: 'active' | 'unmatched' }
export type PlanAnnotation = { id: string; revision: string; kind: 'comment' | 'deletion' | 'global' | 'label'; text: string; anchor?: PlanAnchor; resolved?: boolean; createdAt: number }
export type PlanRevision = { hash: string; text: string; createdAt: number; source: PlanSource }
export type PlanDecision = { revision: string; kind: 'approved' | 'changes-requested'; createdAt: number }
export type PlanDelivery = { id: string; revision: string; action: 'feedback' | 'implement'; status: 'pending' | 'sent' | 'failed' | 'unknown'; text: string; error?: string; createdAt: number }
export type PlanDraft = { text: string; start: number; end: number; kind: PlanAnnotation['kind'] }
export type PlanReview = { id: string; title: string; sequence: number; revisions: PlanRevision[]; annotations: PlanAnnotation[]; decisions: PlanDecision[]; drafts: Record<string, PlanDraft>; draftVersions?: Record<string, number>; deliveries: PlanDelivery[] }
export type PlanSnapshot = { reviews: PlanReview[] }
export type PlanOperation =
  | { type: 'annotate'; id: string; kind: PlanAnnotation['kind']; text: string; start?: number; end?: number }
  | { type: 'delete'; id: string }
  | { type: 'resolve'; id: string; resolved: boolean }
  | { type: 'draft'; owner: string; draft: PlanDraft | null; expectedVersion?: number }
  | { type: 'approve' }
export type PlanMutation = { reviewId: string; revision: string; sequence: number; requestId: string; operation: PlanOperation }
export type PlanOpen = { source: PlanSource }
export type PlanSend = { reviewId: string; revision: string; sequence: number; requestId: string; action: 'feedback' | 'implement'; permissionMode?: 'default' | 'acceptEdits' }
export type PlanReviewService = {
  read(cwd: string, target?: PlanTarget, signal?: AbortSignal): Promise<PlanSnapshot>
  messages(target: PlanTarget, signal?: AbortSignal): Promise<{ id: string; text: string }[]>
  open(cwd: string, input: PlanOpen, signal?: AbortSignal): Promise<PlanReview>
  mutate(cwd: string, input: PlanMutation): Promise<PlanReview>
  send(cwd: string, input: PlanSend): Promise<PlanReview>
  reconcile(cwd: string, reviewId: string, deliveryId: string): Promise<PlanReview>
}
export const PLAN_LABELS = ['Clarify', 'Needs tests', 'Out of scope', 'Looks good'] as const
export const latestPlan = (review: PlanReview) => review.revisions[review.revisions.length - 1]!
export const planNotes = (review: PlanReview, hash = latestPlan(review).hash) => review.annotations.filter(note => note.revision === hash)
export const planPendingNotes = (review: PlanReview) => planNotes(review).filter(note => !note.resolved)
export const planApproved = (review: PlanReview) => [...review.decisions].reverse().find(decision => decision.revision === latestPlan(review).hash)?.kind === 'approved'
export function messageText(message: SessionMessage): string {
  const content = message.message.content
  return typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => 'text' in part ? part.text : '').join('\n\n') : ''
}
/** Only explicit completed plan artifacts; ordinary headings and todo lists aren't plans. */
export function explicitPlan(message: SessionMessage): string | null {
  if (message.type !== 'assistant' || message.ephemeral) return null
  const text = messageText(message)
  if (message.planArtifact) return text.replace(/^## Plan\s*\n/, '').trim() || null
  let fence: { char: string; length: number } | null = null, body: string[] | null = null, result: string | null = null
  for (const line of text.split('\n')) {
    if (!fence && !body) {
      const opening = line.match(/^\s*<proposed_plan>(.*)$/)
      if (opening) {
        const close = opening[1].indexOf('</proposed_plan>')
        if (close >= 0) result = opening[1].slice(0, close).trim() || null
        else body = opening[1].trim() ? [opening[1]] : []
        continue
      }
    }
    if (!fence && body && /^\s*<\/proposed_plan>/.test(line)) { result = body.join('\n').trim() || null; body = null; continue }
    if (body) body.push(line)
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null
    }
  }
  return result
}

export function makePlanAnchor(text: string, start: number, end: number): PlanAnchor {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length || !text.slice(start, end).trim()) throw new Error('Select nonempty plan text')
  return { quote: text.slice(start, end), start, end, prefix: text.slice(Math.max(0, start - 64), start), suffix: text.slice(end, end + 64), line: text.slice(0, start).split('\n').length, status: 'active' }
}
/** Verify positions first, then quote plus context. Never guess between duplicate quotes. */
export function restorePlanAnchor(anchor: PlanAnchor, text: string): PlanAnchor {
  const positions: number[] = []
  for (let at = text.indexOf(anchor.quote); at >= 0; at = text.indexOf(anchor.quote, at + 1)) positions.push(at)
  const contextual = positions.filter(at => (!anchor.prefix || text.slice(Math.max(0, at - anchor.prefix.length), at) === anchor.prefix) && (!anchor.suffix || text.slice(at + anchor.quote.length, at + anchor.quote.length + anchor.suffix.length) === anchor.suffix))
  const start = contextual.length === 1 ? contextual[0] : positions.length === 1 ? positions[0] : -1
  return start < 0 ? { ...anchor, status: 'unmatched' } : makePlanAnchor(text, start, start + anchor.quote.length)
}
/** Source-local quoted Markdown feedback, inspired by Plannotator's parser/exporter. */
export function planFeedback(review: PlanReview, action: 'feedback' | 'implement'): string {
  const revision = latestPlan(review)
  const notes = planPendingNotes(review).map((note, index) => `${index + 1}. ${note.kind === 'deletion' ? 'Remove this' : note.kind === 'global' ? 'General feedback' : note.kind === 'label' ? `[${note.text}]` : 'Comment'}${note.anchor ? note.anchor.status === 'active' ? ` (line ${note.anchor.line})` : ' (selection no longer matched)' : ''}\n${note.anchor ? note.anchor.quote.split('\n').map(line => `> ${line}`).join('\n') + '\n' : ''}${note.kind === 'label' ? '' : note.text}\n`).join('\n')
  return `${action === 'feedback' ? 'PLAN CHANGES REQUESTED. Revise the plan to address the feedback below. Do not implement or resubmit it unchanged.' : 'Implement this exact approved plan, incorporating its review notes. Follow the session’s existing permissions and instructions.'}\n\nPlan: ${review.title}\nRevision: ${revision.hash}\n${revision.source.path ? `File: ${revision.source.path}\n` : ''}\n${revision.text}\n\n## Review notes\n${notes || 'No annotations.'}`
}
/** Bounded linear comparison for a readable revision overview in either renderer. */
export function planRevisionDiff(previous: string, current: string): string {
  const before = previous.split('\n'), after = current.split('\n')
  let first = 0, tail = 0
  while (first < before.length && first < after.length && before[first] === after[first]) first++
  while (tail < before.length - first && tail < after.length - first && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  if (first === before.length && first === after.length) return 'No changes.'
  return [...before.slice(Math.max(0, first - 2), first).map(line => `  ${line}`), ...before.slice(first, before.length - tail).map(line => `- ${line}`), ...after.slice(first, after.length - tail).map(line => `+ ${line}`), ...after.slice(after.length - tail, after.length - tail + 2).map(line => `  ${line}`)].join('\n')
}

/** Map rendered UTF-16 offsets onto source offsets, including escapes/entities. */
export function planSourceOffsets(raw: string, rendered: string, base: number): number[] | null {
  if (!rendered.length) return null
  const exact = raw.indexOf(rendered)
  if (exact >= 0 && raw.indexOf(rendered, exact + 1) < 0) return Array.from({ length: rendered.length + 1 }, (_, i) => base + exact + i)
  const offsets = [base]; let at = 0
  for (let i = 0; i < rendered.length; i++) {
    if (raw[at] === '&' && /^&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z]+);/.test(raw.slice(at))) {
      at = raw.indexOf(';', at) + 1
      if (rendered.codePointAt(i)! > 0xffff) { offsets.push(base + at); i++ }
    } else if (raw[at] === rendered[i]) at++
    else if (raw[at] === '\\' && raw[at + 1] === rendered[i]) at += 2
    else return null
    offsets.push(base + at)
  }
  return at === raw.length ? offsets : null
}
