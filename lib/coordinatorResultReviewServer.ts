import { createHash } from 'node:crypto'
import type { AgentProvider } from './types'
import { readSessionCoordinator, readInteractiveCoordinator, readInteractiveRecoveries, sessionCoordinatorIdentity, runExternalProtocolIdempotent, validateWorktreeTaskLocks } from './agentCoordination'
import { findWorktreeTaskForCwd, mergeWorktreeTask } from './worktreeTasks'
import { readViewSessionRunning } from './sessionBackend'
import { coordinatorCheckoutRevision, resultGit } from './coordinatorResultGit'
import { resultVerification, type CoordinatorResultReview } from './coordinatorResultReview'

export async function readCoordinatorResultReview(sessionId: string, provider: AgentProvider, taskId: string): Promise<CoordinatorResultReview> {
  const snapshot = await readSessionCoordinator(sessionId, provider)
  const task = snapshot?.tasks.find(task => task.id === taskId)
  if (!snapshot || !task) throw new Error('Coordinator result not found')
  const agent = snapshot.agents.find(agent => agent.id === task.ownerAgentId)
  const review: CoordinatorResultReview = {
    task, runReview: snapshot.run.review,
    findings: snapshot.events.filter(event => event.taskId === taskId && ['finding', 'review.requested', 'task.failed', 'agent.blocked'].includes(event.type)).map(event => ({ summary: event.summary || event.type, detail: event.detail })),
    checkout: null, verification: resultVerification(task), integrationBlockers: [],
  }
  const block = (reason: string) => review.integrationBlockers.push(reason)
  if (task.status !== 'completed') block('Only completed tasks can be integrated.')
  if (!snapshot.agents.some(entry => entry.role === 'lead' && entry.sessionId === sessionId)) block('Open the lead conversation to integrate.')
  if ((await readInteractiveCoordinator(sessionId)).executionElsewhere) block('Execution belongs to another host; inspect and integrate there.')
  if (!agent) { block('The task has no checkout owner.'); return review }
  if (agent.turnActive || readViewSessionRunning(agent.sessionId).running || snapshot.tasks.some(other => other.ownerAgentId === agent.id && !['completed', 'failed', 'cancelled'].includes(other.status))) block('The teammate still has active work.')
  if ((await readInteractiveRecoveries(snapshot.run.id)).includes(agent.id)) block('Reconcile the teammate execution before integrating.')
  if (task.receipt?.needsDecision.some(decision => decision.status === 'open')) block('Resolve open decisions first.')
  if (snapshot.run.requireReview && snapshot.run.review.status !== 'approved') block('The required run review is not approved.')
  // A foreign host's paths may coincidentally exist on this machine. Do not inspect them.
  if (review.integrationBlockers.some(reason => reason.includes('another host'))) return review
  try {
    const worktree = await findWorktreeTaskForCwd(agent.worktreePath)
    if (!worktree || !agent.worktreeBranch) block('Shared checkout: changes are already in place; there is no separate branch to integrate.')
    const cwd = agent.worktreePath
    const target = worktree?.repoRoot ?? cwd
    const revision = await coordinatorCheckoutRevision(cwd)
    const [head, branch, base, targetRevision] = await Promise.all([
      resultGit(cwd, ['rev-parse', 'HEAD']), resultGit(cwd, ['branch', '--show-current']),
      worktree ? resultGit(cwd, ['merge-base', 'HEAD', (await resultGit(target, ['rev-parse', 'HEAD'])).trim()]) : resultGit(cwd, ['rev-parse', 'HEAD']),
      coordinatorCheckoutRevision(target),
    ])
    const [changed, untracked, diff, targetStatus] = await Promise.all([
      resultGit(cwd, ['diff', '--name-only', '-z', base.trim(), '--']),
      resultGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
      resultGit(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', base.trim(), '--']),
      resultGit(target, ['status', '--porcelain=v1', '--untracked-files=all']),
    ])
    if (revision !== await coordinatorCheckoutRevision(cwd)) throw new Error('Checkout changed while reading; refresh before reviewing.')
    const files = [...new Set([...changed.split('\0'), ...untracked.split('\0')].filter(Boolean))]
    review.checkout = { path: cwd, branch: branch.trim(), head: head.trim(), base: base.trim(), target, files, diff: diff.slice(0, 200_000), diffTruncated: diff.length > 200_000, revision,
      token: createHash('sha256').update(JSON.stringify([revision, targetRevision, task.updatedAt, task.receipt, snapshot.run.review])).digest('hex') }
    review.verification = resultVerification(task, revision)
    if (!files.length) block('No changes to integrate.')
    if (worktree && targetStatus.trim()) block('The target checkout has local changes; commit or stash them before integrating.')
    if (worktree && branch.trim() !== worktree.branch) block('The checkout branch changed; inspect it before integrating.')
    if (['failed', 'stale', 'unbound'].includes(review.verification)) block(`Verification is ${review.verification}; complete the task again with checks against the current checkout.`)
    if (worktree) { const validation = await validateWorktreeTaskLocks(worktree, { completedTaskId: task.id, changedFiles: files }); if (!validation.ok) block(validation.message) }
  } catch (error) {
    review.checkout = null
    review.error = error instanceof Error ? error.message : 'Checkout unavailable'
    block('Could not read a stable checkout. Refresh after resolving the error.')
  }
  return review
}

const integrations = new Map<string, Promise<unknown>>()
export async function integrateCoordinatorResult(sessionId: string, provider: AgentProvider, taskId: string, token: string, requestId: string): Promise<{ staged: boolean }> {
  const identity = await sessionCoordinatorIdentity(sessionId, provider)
  return runExternalProtocolIdempotent(identity, 'integrate_result', requestId, async () => {
    const initial = await readCoordinatorResultReview(sessionId, provider, taskId)
    const key = initial.checkout?.target ?? identity.runId
    if (integrations.has(key)) throw new Error('Another integration is in progress. Refresh when it finishes.')
    const operation = (async () => {
      const review = await readCoordinatorResultReview(sessionId, provider, taskId)
      if (review.integrationBlockers.length) throw new Error(review.integrationBlockers.join(' '))
      if (!review.checkout || review.checkout.token !== token) throw new Error('Result or target changed since review. Refresh and inspect before integrating.')
      const worktree = await findWorktreeTaskForCwd(review.checkout.path)
      if (!worktree) throw new Error('Worktree no longer exists')
      return mergeWorktreeTask(worktree)
    })()
    integrations.set(key, operation)
    try { return await operation } finally { integrations.delete(key) }
  })
}
