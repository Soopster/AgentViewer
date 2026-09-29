import type { ProtocolTask, ProtocolRunSnapshot } from './agentProtocol'

export type CoordinatorResultReview = {
  task: ProtocolTask
  findings: { summary: string; detail?: string }[]
  runReview: ProtocolRunSnapshot['run']['review']
  checkout: null | {
    path: string; branch: string; head: string; base: string; target: string
    files: string[]; diff: string; diffTruncated: boolean; revision: string; token: string
  }
  verification: 'current' | 'stale' | 'unbound' | 'missing' | 'failed'
  integrationBlockers: string[]
  error?: string
}

export function resultVerification(task: ProtocolTask, revision?: string): CoordinatorResultReview['verification'] {
  if (!task.receipt?.verification.length) return 'missing'
  if (task.receipt.verification.some(check => !check.passed)) return 'failed'
  if (!task.receipt.verificationRevision || !revision) return 'unbound'
  return task.receipt.verificationRevision === revision ? 'current' : 'stale'
}

/** Shared by web and terminal readers; presence in this view never marks reviewed. */
export function coordinatorResultLines(review: CoordinatorResultReview): string[] {
  const { task, checkout } = review
  return [
    `${task.title} · ${task.status}`,
    task.resultSummary || 'No result summary supplied.',
    ...(task.resultDetail ? [task.resultDetail] : []),
    `Verification: ${review.verification}${task.receipt ? ` · recorded ${task.receipt.recordedAt}` : ''}`,
    ...(!task.receipt?.verification.length ? ['No executed checks recorded.'] : task.receipt.verification.map(check =>
      `${check.passed ? 'PASS' : 'FAIL'} ${check.command}${check.exitCode !== undefined ? ` · exit ${check.exitCode}` : ''}${check.summary ? `\n${check.summary}` : ''}`)),
    'Reported files (teammate receipt):', ...(task.receipt?.filesChanged.length ? task.receipt.filesChanged : ['None reported.']),
    'Reported commands:', ...(task.receipt?.commandsRun.length ? task.receipt.commandsRun : ['None reported.']),
    'Findings in the available task history:', ...(review.findings.length ? review.findings.map(finding => `${finding.summary}${finding.detail ? `\n${finding.detail}` : ''}`) : ['None recorded.']),
    ...((task.receipt?.needsDecision ?? []).filter(decision => decision.status === 'open').map(decision => `OPEN: ${decision.question} · ${decision.impactIfWrong}`)),
    `Run review: ${review.runReview?.status ?? 'not recorded'}${review.runReview?.summary ? ` · ${review.runReview.summary}` : ''}`,
    ...(checkout ? [`Checkout: ${checkout.path}`, `Branch: ${checkout.branch} · HEAD ${checkout.head}`, `Base: ${checkout.base}`, `Target: ${checkout.target}`, 'Actual checkout changes (entire branch, including later tasks):', ...checkout.files] : []),
    ...(review.error ? [review.error] : []),
    ...review.integrationBlockers.map(reason => `Integration unavailable: ${reason}`),
  ]
}
