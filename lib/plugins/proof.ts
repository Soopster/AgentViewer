/** Browser-safe Proof contract. Execution and persistence live behind renderer adapters. */
export type ProofCheck = { id: string; label: string; executable: string; args: string[]; cwd: string; timeoutMs: number }
export type ProofConfig = { version: string; checks: ProofCheck[] }
export type ProofResult = {
  check: ProofCheck; status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'timeout' | 'interrupted'
  startedAt?: number; finishedAt?: number; exitCode?: number | null; error?: string
  before?: string | null; after?: string | null; truncated?: boolean
}
export type ProofRun = { id: string; cwd: string; createdAt: number; finishedAt?: number; pid?: number; configVersion: string; origin?: { provider: string; providerInstanceId?: string; sessionId: string }; results: ProofResult[] }
export type ProofSnapshot = { cwd: string; config: ProofConfig; suggestions: ProofCheck[]; runs: ProofRun[]; fingerprint: string | null; fingerprintError?: string }
export type ProofService = {
  read(cwd: string, signal?: AbortSignal): Promise<ProofSnapshot>
  configure(cwd: string, checks: ProofCheck[], version: string): Promise<ProofConfig>
  start(cwd: string, ids: string[], version: string, origin?: ProofRun['origin']): Promise<{ id: string }>
  cancel(cwd: string, id: string): Promise<void>
  output(cwd: string, id: string, checkId: string, signal?: AbortSignal): Promise<string>
}
export function proofFreshness(result: ProofResult, snapshot: ProofSnapshot): 'current' | 'stale' | 'unstable' | 'unknown' {
  if (!result.before || !result.after || !snapshot.fingerprint) return 'unknown'
  if (result.before !== result.after) return 'unstable'
  const configured = snapshot.config.checks.find(check => check.id === result.check.id)
  return result.after === snapshot.fingerprint && JSON.stringify(configured) === JSON.stringify(result.check) ? 'current' : 'stale'
}
export function proofSummary(snapshot: ProofSnapshot): string {
  const run = snapshot.runs[0]
  if (!run) return 'unchecked'
  if (!run.finishedAt) return 'running'
  if (run.results.some(result => result.status !== 'passed')) return 'failed'
  const freshness = run.results.map(result => proofFreshness(result, snapshot))
  if (freshness.includes('unknown')) return 'unknown'
  if (freshness.some(value => value !== 'current')) return 'stale'
  if (snapshot.config.checks.some(check => !run.results.some(result => result.check.id === check.id))) return 'partially checked'
  return 'passed'
}
export function proofFixPrompt(run: ProofRun, result: ProofResult, freshness: string, output: string): string {
  return `Fix this verification failure in ${run.cwd}.\nCheck: ${result.check.label}\nCommand: ${JSON.stringify([result.check.executable, ...result.check.args])}\nWorking directory: ${result.check.cwd}\nResult: ${result.status}; exit ${result.exitCode ?? 'unavailable'}\nEvidence freshness: ${freshness}. Inspect the current code before editing.\n\n${output.slice(-12_000)}\n\nRerun the relevant checks and report what remains unverified.`
}

export function proofRunLabel(run: ProofRun): string { return `${new Date(run.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC · ${run.id.slice(0, 8)}` }
