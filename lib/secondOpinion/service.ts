// Second opinions on agent turns: which turn, which reviewer, the run, and the
// record kept per repository. A turn is the interval from its checkpoint to the
// next one in the same worktree — or to the working tree, for the newest turn,
// whose review goes stale once the working tree moves on.
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { diffSinceCheckpoint, listTurnCheckpoints, type TurnCheckpoint } from '../checkpoints'
import { findRepoRoot } from '../worktreeTasks'
import type { SecondOpinionRecord, SecondOpinionService, SecondOpinionSettings, SecondOpinionSnapshot, SecondOpinionStartInput } from '../plugins/secondOpinion'
import { buildSecondOpinionPrompt, defaultReviewerFor, normalizeSecondOpinion, splitUnifiedDiff, SECOND_OPINION_REVIEWERS, type DiffFile, type SecondOpinionReviewer } from './review'
import { ReviewerUnavailableError, SECOND_OPINION_DEFAULT_MODELS, SECOND_OPINION_REVIEWER_CALLS, type ReviewerCall } from './reviewers'

const REVIEW_TIMEOUT_MS = 5 * 60_000
const MAX_RECORDS = 60

const directory = () => process.env.AGENT_VIEWER_SECOND_OPINION_DIR ?? path.join(process.cwd(), '.agent-viewer-data', 'second-opinion')
const fileFor = (root: string) => path.join(directory(), `${createHash('sha256').update(root).digest('hex').slice(0, 32)}.json`)

type StoreFile = { version: 1; settings: SecondOpinionSettings; reviews: SecondOpinionRecord[] }

const defaultSettings = (): SecondOpinionSettings => ({ autoReview: false, reviewer: 'auto', models: { ...SECOND_OPINION_DEFAULT_MODELS } })

type RunState = { controller: AbortController; promise: Promise<void> }
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerSecondOpinion: { running: Map<string, RunState>; writes: Map<string, Promise<unknown>> } | undefined
}
const state = () => (globalThis.__agentViewerSecondOpinion ??= { running: new Map(), writes: new Map() })

async function repositoryRoot(cwd: string): Promise<string> {
  const root = await findRepoRoot(cwd)
  if (!root) throw new Error(`${cwd} is not inside a git repository`)
  return root
}

async function load(root: string): Promise<StoreFile> {
  try {
    const parsed = JSON.parse(await readFile(fileFor(root), 'utf8')) as Partial<StoreFile>
    const settings = { ...defaultSettings(), ...parsed.settings, models: { ...defaultSettings().models, ...parsed.settings?.models } }
    return { version: 1, settings, reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [] }
  } catch { return { version: 1, settings: defaultSettings(), reviews: [] } }
}

const LOCK_STALE_MS = 10_000
/** A lock file beside the store: a daemon and a TUI can both write one repository's reviews. */
async function withFileLock<T>(target: string, work: () => Promise<T>): Promise<T> {
  const lock = `${target}.lock`
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(lock, 'wx', 0o600)
      await handle.close()
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      // A holder that died leaves its lock; one older than any write could take is taken over.
      const age = await stat(lock).then(info => Date.now() - info.mtimeMs).catch(() => 0)
      if (age > LOCK_STALE_MS || attempt > 200) await unlink(lock).catch(() => {})
      else await new Promise(resolve => setTimeout(resolve, 15))
    }
  }
  try { return await work() } finally { await unlink(lock).catch(() => {}) }
}

/** Read-modify-write under the lock, serialized per repository within this process, written temp-and-rename. */
function update<T>(root: string, change: (file: StoreFile) => T): Promise<T> {
  const writes = state().writes
  const previous = writes.get(root) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    await mkdir(directory(), { recursive: true })
    const target = fileFor(root)
    return withFileLock(target, async () => {
      const file = await load(root)
      const result = change(file)
      file.reviews = file.reviews.slice(0, MAX_RECORDS)
      const temporary = `${target}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, target)
      return result
    })
  })
  writes.set(root, next)
  void next.finally(() => { if (writes.get(root) === next) writes.delete(root) }).catch(() => {})
  return next
}

/** A turn's checkpoint and the next one in the same worktree, if any. */
export async function turnRange(cwd: string, checkpointSha: string): Promise<{ checkpoint: TurnCheckpoint; next: TurnCheckpoint | null }> {
  const root = await repositoryRoot(cwd)
  const checkpoints = (await listTurnCheckpoints(cwd)).filter(entry => !entry.worktree || entry.worktree === root)
  const checkpoint = checkpoints.find(entry => entry.sha === checkpointSha)
  if (!checkpoint) throw new Error('That turn has no checkpoint in this checkout any more.')
  const next = checkpoints.filter(entry => entry.createdAt > checkpoint.createdAt).sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
  return { checkpoint, next }
}

/**
 * The app's own state is not the agent's work. A checkpoint snapshots everything git does not
 * ignore, so in a repository that does not ignore `.agent-viewer-data/` its files (this store
 * included) were in the diff the reviewer read — and writing a review moved the working tree,
 * so every newest-turn review read as stale the moment it was saved. Found live.
 */
const APP_DATA_PREFIX = '.agent-viewer-data/'
const isAppData = (file: DiffFile) => file.path === '.agent-viewer-data' || file.path.startsWith(APP_DATA_PREFIX)

/** A turn's files as the reviewer reads them, and a signature of exactly that text. */
export async function readTurnDiff(cwd: string, checkpointSha: string, untilSha: string | null): Promise<{ files: DiffFile[]; signature: string }> {
  const files = splitUnifiedDiff(await diffSinceCheckpoint(cwd, checkpointSha, undefined, untilSha ?? undefined)).filter(file => !isAppData(file))
  const hash = createHash('sha256')
  for (const file of files) hash.update(file.path).update('\u0000').update(file.patch).update('\u0000')
  return { files, signature: hash.digest('hex') }
}

const describeReply = (reply: unknown) => reply === null || reply === undefined ? 'empty reply' : typeof reply === 'object' ? `keys: ${Object.keys(reply as object).slice(0, 6).join(', ') || 'none'}` : `a ${typeof reply}`

export type SecondOpinionOptions = { reviewers?: Partial<Record<SecondOpinionReviewer, ReviewerCall>>; onFinished?: (record: SecondOpinionRecord) => void }

export function createSecondOpinionService(options: SecondOpinionOptions = {}): SecondOpinionService & {
  /** Start a review and resolve when it settles (the auto-review path and smokes). */
  run(cwd: string, input: SecondOpinionStartInput & { auto?: boolean }): Promise<SecondOpinionRecord>
} {
  const calls = { ...SECOND_OPINION_REVIEWER_CALLS, ...options.reviewers }

  async function begin(cwd: string, input: SecondOpinionStartInput & { auto?: boolean }): Promise<{ id: string; done: Promise<SecondOpinionRecord> }> {
    const root = await repositoryRoot(cwd)
    const { checkpoint, next } = await turnRange(cwd, input.checkpointSha)
    // What the review reads, and the signature that later says whether the code under it moved.
    const turnDiff = await readTurnDiff(cwd, checkpoint.sha, next?.sha ?? null)
    const endTree = turnDiff.signature
    const { settings, reviews } = await load(root)
    // One review of the same code by the same reviewer at a time: a second ask joins it.
    const preferred: SecondOpinionReviewer = input.reviewer ?? (settings.reviewer === 'auto' ? defaultReviewerFor(checkpoint.provider) : settings.reviewer)
    const existing = reviews.find(record => record.status === 'running' && record.checkpointSha === checkpoint.sha && record.endTree === endTree && (record.reviewer === preferred || record.fellBackFrom === preferred) && state().running.has(record.id))
    if (existing) return { id: existing.id, done: state().running.get(existing.id)!.promise.then(async () => (await load(root)).reviews.find(record => record.id === existing.id)!) }
    const record: SecondOpinionRecord = {
      id: randomUUID(), checkpointSha: checkpoint.sha, untilSha: next?.sha ?? null, endTree, turnLabel: checkpoint.label,
      sessionId: checkpoint.sessionId, authorProvider: checkpoint.provider, reviewer: preferred, model: settings.models[preferred] ?? '',
      auto: input.auto === true, status: 'running', startedAt: Date.now(), dismissed: [],
    }
    await update(root, file => { file.reviews.unshift(record) })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS)
    timeout.unref?.()
    const promise = (async () => {
      let finished: Partial<SecondOpinionRecord>
      try {
        const files = turnDiff.files
        if (!files.length) {
          finished = { status: 'done', review: { summary: 'The turn changed no files.', findings: [], unread: [], files: [] } }
        } else {
          const prompt = buildSecondOpinionPrompt({ label: checkpoint.label, authorProvider: checkpoint.provider }, files, input.instructions)
          let reviewer = preferred
          let reply: unknown
          try {
            reply = await calls[reviewer]({ prompt, model: settings.models[reviewer] ?? '', signal: controller.signal })
          } catch (error) {
            if (!(error instanceof ReviewerUnavailableError)) throw error
            const other = SECOND_OPINION_REVIEWERS.find(candidate => candidate !== reviewer)!
            reviewer = other
            Object.assign(record, { reviewer: other, fellBackFrom: preferred, model: settings.models[other] ?? '' })
            await update(root, file => { const entry = file.reviews.find(item => item.id === record.id); if (entry) Object.assign(entry, { reviewer: other, fellBackFrom: preferred, model: record.model }) })
            reply = await calls[other]({ prompt, model: settings.models[other] ?? '', signal: controller.signal })
          }
          let review = normalizeSecondOpinion(reply, files)
          // A reply that is not a review at all (structured output dropped, prose instead) is asked for once more.
          if (!review && !controller.signal.aborted) {
            reply = await calls[reviewer]({ prompt, model: settings.models[reviewer] ?? '', signal: controller.signal })
            review = normalizeSecondOpinion(reply, files)
          }
          finished = review ? { status: 'done', review } : { status: 'failed', error: `The reviewer returned no usable review (${describeReply(reply)}). Try again.` }
        }
      } catch (error) {
        finished = controller.signal.aborted
          ? { status: 'cancelled', error: Date.now() - record.startedAt >= REVIEW_TIMEOUT_MS ? 'The review timed out.' : undefined }
          : { status: 'failed', error: error instanceof Error ? error.message.slice(0, 500) : String(error) }
      } finally {
        clearTimeout(timeout)
      }
      const settled = await update(root, file => {
        let entry = file.reviews.find(item => item.id === record.id)
        // Written over by a writer that never saw it: put it back rather than lose the review.
        if (!entry) { entry = { ...record }; file.reviews.unshift(entry) }
        Object.assign(entry, finished, { finishedAt: Date.now() })
        return { ...entry }
      })
      Object.assign(record, settled)
      options.onFinished?.(settled)
    })().finally(() => state().running.delete(record.id))
    state().running.set(record.id, { controller, promise })
    return { id: record.id, done: promise.then(() => ({ ...record })) }
  }

  return {
    async read(cwd) {
      const root = await repositoryRoot(cwd)
      const { settings, reviews } = await load(root)
      const running = state().running
      // A run this process does not hold, older than any run could last, died with its host.
      for (const record of reviews) {
        if (record.status === 'running' && !running.has(record.id) && Date.now() - record.startedAt > REVIEW_TIMEOUT_MS + 60_000) record.status = 'interrupted'
      }
      // Only the newest turn's reviews can go stale, and only by the working tree moving.
      if (reviews.some(record => record.untilSha === null && record.status === 'done')) {
        const signatures = new Map<string, string | null>()
        for (const record of reviews) {
          if (record.untilSha !== null || record.status !== 'done') continue
          if (!signatures.has(record.checkpointSha)) signatures.set(record.checkpointSha, await readTurnDiff(cwd, record.checkpointSha, null).then(diff => diff.signature).catch(() => null))
          const signature = signatures.get(record.checkpointSha)
          if (signature) record.stale = record.endTree !== signature
        }
      }
      const snapshot: SecondOpinionSnapshot = { cwd, settings, reviews }
      return snapshot
    },
    async start(cwd, input) {
      const { id } = await begin(cwd, input)
      return { id }
    },
    async run(cwd, input) {
      return (await begin(cwd, input)).done
    },
    async cancel(_cwd, id) {
      state().running.get(id)?.controller.abort()
    },
    async dismiss(cwd, id, findingId) {
      await update(await repositoryRoot(cwd), file => {
        const entry = file.reviews.find(item => item.id === id)
        if (entry && !entry.dismissed.includes(findingId)) entry.dismissed.push(findingId)
      })
    },
    async configure(cwd, next) {
      return update(await repositoryRoot(cwd), file => {
        if (typeof next.autoReview === 'boolean') file.settings.autoReview = next.autoReview
        if (next.reviewer === 'auto' || SECOND_OPINION_REVIEWERS.includes(next.reviewer as SecondOpinionReviewer)) file.settings.reviewer = next.reviewer!
        for (const reviewer of SECOND_OPINION_REVIEWERS) {
          const model = next.models?.[reviewer]
          if (typeof model === 'string') file.settings.models[reviewer] = model.trim().slice(0, 120)
        }
        return file.settings
      })
    },
  }
}

export const nativeSecondOpinion = createSecondOpinionService({
  onFinished: record => {
    if (!record.auto || !record.sessionId || !record.review) return
    const serious = record.review.findings.filter(finding => finding.severity !== 'nit').length
    if (!serious) return
    void import('../viewerAttention').then(({ postViewerAttention }) => postViewerAttention({
      sessionId: record.sessionId!,
      provider: record.authorProvider as import('../types').AgentProvider | undefined,
      title: `Second opinion: ${serious} finding${serious === 1 ? '' : 's'} on the last turn`,
      detail: record.review!.findings.slice(0, 3).map(finding => `${finding.severity}: ${finding.title}`).join('\n'),
    })).catch(() => {})
  },
})

/** For auto-review: is it on for this checkout. */
export async function secondOpinionAutoReview(cwd: string): Promise<boolean> {
  try { return (await load(await repositoryRoot(cwd))).settings.autoReview } catch { return false }
}
