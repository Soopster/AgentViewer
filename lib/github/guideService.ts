// Writing and keeping review guides. A guide is kept per pull request for everyone
// using this checkout, and is stale once the head commit moves.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fetchPullRequestWorkspace } from '../githubPr'
import { parseJsonObject, runStructuredQuery } from '../oneShotLlm'
import { buildPrGuidePrompt, normalizePrGuide, PR_GUIDE_SCHEMA, type PrGuide } from './guide'
import { fetchGithubPr } from './prs'

const WRITE_TIMEOUT_MS = 5 * 60_000
const directory = () => process.env.AGENT_VIEWER_PR_GUIDE_DIR ?? path.join(process.cwd(), '.agent-viewer-data', 'pr-guides')
const fileFor = (cwd: string, number: number) => path.join(directory(), `${createHash('sha256').update(`${cwd}\u0000${number}`).digest('hex').slice(0, 32)}.json`)

export async function readPrGuide(cwd: string, number: number): Promise<PrGuide | null> {
  try {
    const parsed = JSON.parse(await readFile(fileFor(cwd, number), 'utf8')) as PrGuide
    return parsed?.number === number && Array.isArray(parsed.stops) ? parsed : null
  } catch { return null }
}

export type PrGuideModel = (prompt: string, model: string, signal: AbortSignal) => Promise<unknown>

const askModel: PrGuideModel = async (prompt, model, signal) => {
  // Tool-less and single-turn: the diff is somebody else's text, and there is nothing it could make this call do.
  const result = await runStructuredQuery({ prompt, schema: PR_GUIDE_SCHEMA, model, signal })
  return result.structuredOutput ?? parseJsonObject(result.text)
}

const writing = new Map<string, Promise<PrGuide>>()

export const guideModelName = () => process.env.AGENT_VIEWER_GUIDE_MODEL?.trim() || 'claude-sonnet-5-5'

/** Single-flight per pull request: two readers asking at once share one model call. */
export function writePrGuide(cwd: string, number: number, options: { ask?: PrGuideModel; load?: typeof loadPullRequest } = {}): Promise<PrGuide> {
  const key = fileFor(cwd, number)
  let running = writing.get(key)
  if (running) return running
  running = (async () => {
    const { pr, repo, threads } = await (options.load ?? loadPullRequest)(cwd, number)
    const model = guideModelName()
    const reply = await (options.ask ?? askModel)(buildPrGuidePrompt(pr, threads), model, AbortSignal.timeout(WRITE_TIMEOUT_MS))
    const guide = normalizePrGuide(reply, pr, { repo, model, writtenAt: Date.now() })
    if (!guide) throw new Error('The model returned no usable guide. Try again.')
    await mkdir(directory(), { recursive: true })
    const temporary = `${key}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(guide), 'utf8')
    await rename(temporary, key)
    return guide
  })().finally(() => writing.delete(key))
  writing.set(key, running)
  return running
}

export const isWritingPrGuide = (cwd: string, number: number) => writing.has(fileFor(cwd, number))

async function loadPullRequest(cwd: string, number: number) {
  const workspace = await fetchPullRequestWorkspace(cwd, number)
  if (!workspace.selected || !workspace.repo) throw new Error(workspace.error ?? `Unable to read pull request #${number}.`)
  // Resolved conversations are left out of a guide; the thread read is what knows which are.
  const threads = await fetchGithubPr(cwd, number).then(pr => pr.threads.filter(thread => !thread.resolved && !thread.outdated)).catch(() => [])
  return { pr: workspace.selected, repo: workspace.repo, threads }
}
