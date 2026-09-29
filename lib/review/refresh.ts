import { fetchGitData, parseGitDiffSource } from '../gitProvider'
import { fetchSourceStatus } from '../gitDiffSources'
import { runGitCommand } from '../gitNodeProvider'
import { fetchGitReviewStream } from './gitStream'
import { mutateReview, readReview } from './store'

/** Refresh the exact live Git view an agent inspected, preserving its identity. */
export async function refreshReview(input: { cwd: string; source: string; viewId: string; requestId: string }) {
  if (!/^(working|branch|turn:)/.test(input.source)) throw new Error('This review source cannot refresh its own patch')
  const state = await readReview(input.cwd, input.source)
  const view = state.views.find(item => item.id === input.viewId && Date.now() - item.seenAt < 15_000)
  if (!view) throw new Error('Review view is closed or no longer active. Read the open reviews again.')
  const [kind, sha] = input.source.split(':')
  const source = parseGitDiffSource(kind, sha)
  const entries = source.kind === 'working'
    ? (await fetchGitData(input.cwd, runGitCommand)).status
    : await fetchSourceStatus(input.cwd, runGitCommand, source)
  const patch = await fetchGitReviewStream(input.cwd, runGitCommand, source, entries)
  return mutateReview({ cwd: input.cwd, source: input.source, requestId: input.requestId,
    publish: { patch, viewId: view.id, surface: view.surface } })
}
