// A change to a card rule as a small, checked patch instead of a rewritten file, in the form an agent
// or a model can produce and a person can read. A patch names the revision it was written against, so
// it can never silently overwrite an edit made since; and a patched rule always goes back to `draft`,
// so what is drawn only changes after someone has looked at the result.
import { parseCardRule, type CardRule, type CardRuleRationale } from '../plugins/cardTemplates'

export const PATCH_MAX_OPERATIONS = 20
export type CardPatchOperation =
  | { readonly op: 'set-title'; readonly title: string }
  | { readonly op: 'set-tone'; readonly tone: unknown }
  | { readonly op: 'replace-block'; readonly index: number; readonly block: unknown }
  | { readonly op: 'insert-block'; readonly index: number; readonly block: unknown }
  | { readonly op: 'remove-block'; readonly index: number }
  | { readonly op: 'set-rationale'; readonly rationale: CardRuleRationale }
export type CardPatch = { readonly baseRevision: number; readonly operations: readonly CardPatchOperation[] }

export class PatchConflictError extends Error { constructor(readonly current: number, readonly base: number) { super(`the rule is at revision ${current} but the patch was written against revision ${base}: read it again and redo the change`); this.name = 'PatchConflictError' } }

export const currentRevision = (rule: Pick<CardRule, 'revision'>): number => rule.revision ?? 1

/** A patch from untrusted data, or the reasons it is not one. */
export function parseCardPatch(raw: unknown): { patch: CardPatch | null; problems: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { patch: null, problems: ['a patch is an object'] }
  const p = raw as { baseRevision?: unknown; operations?: unknown }
  const problems: string[] = []
  if (!Number.isInteger(p.baseRevision) || (p.baseRevision as number) < 1) problems.push('baseRevision must be the positive integer revision the rule had when you read it')
  if (!Array.isArray(p.operations) || !p.operations.length || p.operations.length > PATCH_MAX_OPERATIONS) problems.push(`operations must be 1 to ${PATCH_MAX_OPERATIONS} entries`)
  else p.operations.forEach((operation, i) => {
    const o = operation as { op?: unknown; index?: unknown; title?: unknown; block?: unknown } | null
    const needsIndex = o?.op === 'replace-block' || o?.op === 'insert-block' || o?.op === 'remove-block'
    if (!o || !['set-title', 'set-tone', 'replace-block', 'insert-block', 'remove-block', 'set-rationale'].includes(String(o.op))) problems.push(`operations[${i}] has unknown op "${String((o as { op?: unknown } | null)?.op).slice(0, 30)}"`)
    else if (needsIndex && !(Number.isInteger(o.index) && (o.index as number) >= 0)) problems.push(`operations[${i}].index must be a non-negative integer`)
    else if (o.op === 'set-title' && typeof o.title !== 'string') problems.push(`operations[${i}].title must be a string`)
    else if ((o.op === 'replace-block' || o.op === 'insert-block') && (!o.block || typeof o.block !== 'object')) problems.push(`operations[${i}].block must be a block`)
  })
  return problems.length ? { patch: null, problems } : { patch: { baseRevision: p.baseRevision as number, operations: p.operations as CardPatchOperation[] }, problems: [] }
}

/** The rule a patch makes, as plain data to be validated and written. Does not touch disk. */
export function applyCardPatch(rule: CardRule, patch: CardPatch): { candidate: Record<string, unknown>; summary: string } {
  if (patch.baseRevision !== currentRevision(rule)) throw new PatchConflictError(currentRevision(rule), patch.baseRevision)
  let title = rule.title, tone: unknown = rule.tone, rationale: unknown = rule.rationale
  const blocks: unknown[] = [...rule.blocks]
  const notes: string[] = []
  for (const [i, operation] of patch.operations.entries()) {
    if (operation.op === 'set-title') { title = operation.title; notes.push('title') }
    else if (operation.op === 'set-tone') { tone = operation.tone; notes.push('tone') }
    else if (operation.op === 'set-rationale') { rationale = operation.rationale; notes.push('rationale') }
    else if (operation.op === 'insert-block') { if (operation.index > blocks.length) throw new Error(`operations[${i}]: cannot insert at ${operation.index}, the card has ${blocks.length} blocks`); blocks.splice(operation.index, 0, operation.block); notes.push(`+block ${operation.index}`) }
    else { if (operation.index >= blocks.length) throw new Error(`operations[${i}]: there is no block ${operation.index}, the card has ${blocks.length}`); if (operation.op === 'replace-block') { blocks[operation.index] = operation.block; notes.push(`block ${operation.index}`) } else { blocks.splice(operation.index, 1); notes.push(`-block ${operation.index}`) } }
  }
  // Whatever the operations did, the rule keeps its identity and target, and goes back to review.
  const candidate = { ...rule, title, tone, blocks, rationale, status: 'draft', samples: rule.samples, overridesNative: rule.overridesNative }
  return { candidate, summary: `patch (${notes.join(', ')}) against revision ${patch.baseRevision}` }
}

/** Validate a patched candidate with the same parser a file goes through; the reasons if it fails. */
export function checkPatched(candidate: Record<string, unknown>): { rule: CardRule | null; problems: string[] } { return parseCardRule(candidate) }
