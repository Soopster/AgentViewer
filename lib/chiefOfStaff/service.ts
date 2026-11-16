import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { COS_DIGEST_PROMPTS, type CosDigestKind } from './digestPrompts'
import { digestBoard, formatBoardDigest, type BoardDigest } from './board'
import { installChiefOfStaffAssets } from './assets'
import { formatRoutingTable, parseRules, validateRules, type CosRule, type RulesProblem, type SelectionCheck } from './rules'
import { cosEntryForSession, readCosEntries, setCosEntry } from './store'

export interface ChiefOfStaffState {
  repoRoot: string
  rulesFile: string
  session: { sessionId: string; provider: string } | null
  /** Rules that passed validation: what the Chief of Staff is told. */
  rules: CosRule[]
  /** Every rule the file holds that could be read, valid or not: what an editor lists. */
  ruleList: CosRule[]
  problems: RulesProblem[]
  board: BoardDigest | null
  report: { text: string; at: number } | null
}

export const COS_CONTEXT_TAG = 'chief_of_staff_context'
const CHARTER = 'You are the Chief of Staff for this repository. Split the request into workstreams and delegate each with coord_delegate. Do not edit files yourself; your edit tools are refused. Report what needs the user first.'

async function repoRootOf(cwd: string): Promise<string> {
  const { findRepoRoot } = await import('../worktreeTasks')
  return (await findRepoRoot(cwd)) ?? path.resolve(cwd)
}

export function rulesFileFor(repoRoot: string): string {
  return path.join(repoRoot, '.agent-viewer', 'chief-of-staff.json')
}

async function readRulesSource(repoRoot: string): Promise<string | null> {
  try { return await readFile(rulesFileFor(repoRoot), 'utf-8') } catch { return null }
}

// Validation asks each provider for its model catalog, which is slow; the same file is not re-checked every turn.
const validated = new Map<string, { at: number; value: ValidatedRules }>()
type ValidatedRules = { valid: CosRule[]; all: CosRule[]; problems: RulesProblem[] }
export const COS_RULES_TTL_MS = 5 * 60_000

export async function readValidatedRules(repoRoot: string, check?: SelectionCheck, now = Date.now()): Promise<ValidatedRules> {
  const source = await readRulesSource(repoRoot)
  const key = `${repoRoot}\n${source ?? ''}`
  const hit = validated.get(key)
  if (hit && now - hit.at < COS_RULES_TTL_MS) return hit.value
  const parsed = parseRules(source)
  const checker = check ?? (async (provider, cwd, model, effort, instance) => (await import('../coordinatorCapabilities')).validateCoordinatorSelection(provider as never, cwd, model, effort, instance))
  const result = await validateRules(parsed.rules, repoRoot, checker)
  const value = { valid: result.valid, all: parsed.rules, problems: [...parsed.problems, ...result.problems] }
  validated.set(key, { at: now, value })
  if (validated.size > 20) validated.delete(validated.keys().next().value!)
  return value
}

async function readBoard(sessionId: string, provider: string): Promise<BoardDigest | null> {
  try {
    const { readSessionCoordinator } = await import('../agentCoordination')
    return digestBoard(await readSessionCoordinator(sessionId, provider as never))
  } catch {
    return null
  }
}

export async function readChiefOfStaff(cwd: string): Promise<ChiefOfStaffState> {
  const repoRoot = await repoRootOf(cwd)
  const entry = readCosEntries()[repoRoot]
  const { valid, all, problems } = await readValidatedRules(repoRoot)
  return {
    repoRoot,
    rulesFile: rulesFileFor(repoRoot),
    session: entry ? { sessionId: entry.sessionId, provider: entry.provider } : null,
    rules: valid,
    ruleList: all.map(rule => ({ ...rule })),
    problems,
    board: entry ? await readBoard(entry.sessionId, entry.provider) : null,
    report: entry?.report ?? null,
  }
}

/** The text appended to a Chief of Staff turn: charter, routing table and the live board. */
export async function chiefOfStaffContext(sessionId: string): Promise<string | null> {
  const found = cosEntryForSession(sessionId)
  if (!found) return null
  const { valid, problems } = await readValidatedRules(found.repoRoot)
  const board = await readBoard(sessionId, found.entry.provider)
  return [`<${COS_CONTEXT_TAG}>`, CHARTER, '', formatRoutingTable(valid, problems), '', board ? formatBoardDigest(board) : 'Board: not available.', `</${COS_CONTEXT_TAG}>`].join('\n')
}

/** Sends one turn and lets it run to its end with no client attached (the schedules engine's approach). */
export async function sendChiefOfStaffTurn(sessionId: string, provider: string, message: string): Promise<void> {
  const [backend, coordination] = await Promise.all([import('../sessionBackend'), import('../agentCoordination')])
  const response = await coordination.withCooperativeInbox(sessionId, { message }, body =>
    backend.streamViewSessionTurn({ sessionId, signal: new AbortController().signal, body, provider: provider as never }))
  if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`)
  await response.body?.pipeTo(new WritableStream({ write() {} })).catch(() => {})
}

async function sessionExists(sessionId: string, provider: string): Promise<boolean> {
  try { return Boolean(await (await import('../sessionReads')).readViewSessionInfo(sessionId, provider as never)) } catch { return false }
}

/** Starts (or reuses) this repository's Chief of Staff, then hands it the request. */
export async function startChiefOfStaff(params: { cwd: string; provider: string; request?: string }): Promise<{ sessionId: string; provider: string; created: boolean }> {
  const repoRoot = await repoRootOf(params.cwd)
  const existing = readCosEntries()[repoRoot]
  let sessionId: string
  let provider: string
  let created = false
  if (existing && await sessionExists(existing.sessionId, existing.provider)) {
    ;({ sessionId, provider } = existing)
  } else {
    const backend = await import('../sessionBackend')
    const session = await backend.createNewViewSession({ provider: params.provider as never, cwd: repoRoot })
    sessionId = session.sessionId
    provider = session.provider
    created = true
    setCosEntry(repoRoot, { sessionId, provider, cwd: repoRoot, createdAt: Date.now() })
  }
  await installChiefOfStaffAssets(repoRoot)
  const { configureInteractiveCoordinator } = await import('../agentCoordination')
  await configureInteractiveCoordinator({ sessionId, provider: provider as never, cwd: repoRoot, autoContinue: true, useWorktrees: true })
  const request = params.request?.trim()
  if (request) {
    // The first turn can run for minutes: the caller gets the session now, a failure becomes an attention note.
    void sendChiefOfStaffTurn(sessionId, provider, request).catch(async error => {
      const { postViewerAttention } = await import('../viewerAttention')
      postViewerAttention({ sessionId, title: 'Chief of Staff could not start', detail: error instanceof Error ? error.message : String(error) })
    })
  }
  return { sessionId, provider, created }
}

export { COS_DIGEST_PROMPTS, type CosDigestKind } from './digestPrompts'

/** Sends a standing digest to every repository's Chief of Staff; one failing does not stop the rest. */
export async function runChiefOfStaffDigest(kind: CosDigestKind): Promise<{ sent: number; failed: string[] }> {
  let sent = 0
  const failed: string[] = []
  for (const [repoRoot, entry] of Object.entries(readCosEntries())) {
    try {
      await sendChiefOfStaffTurn(entry.sessionId, entry.provider, COS_DIGEST_PROMPTS[kind])
      sent += 1
    } catch (error) {
      failed.push(`${path.basename(repoRoot)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { sent, failed }
}

/**
 * Replaces the rules file with these rules. They are cleaned the way a hand-written file is (an entry with no
 * match or an unknown provider is refused outright, so an editor cannot save a rule nothing can read), and the file
 * is rewritten whole: comments in a hand-edited file do not survive an edit made here.
 */
export async function saveChiefOfStaffRules(cwd: string, rules: readonly CosRule[]): Promise<ChiefOfStaffState> {
  const clean = parseRules(JSON.stringify({ rules }))
  if (clean.problems.length) throw new Error(clean.problems.map(problem => `${problem.rule ? `Rule ${problem.rule}: ` : ''}${problem.message}`).join('; '))
  const repoRoot = await repoRootOf(cwd)
  const file = rulesFileFor(repoRoot)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify({ rules: clean.rules.map(({ at, ...rule }: CosRule & { at?: number }) => rule) }, null, 2)}\n`, 'utf-8')
  await rename(temporary, file)
  return readChiefOfStaff(cwd)
}
