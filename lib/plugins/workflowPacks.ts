import { parseRunPlaybook, type RunPlaybook } from '../agentProtocol'
import type { PluginPlaybookService } from './playbooks'
export type WorkflowPack = { id: string; title: string; version: string; description: string; sources: string[]; playbooks: RunPlaybook[] }
const task = (key: string, title: string, detail: string, role: 'lead' | 'teammate' = 'teammate', dependsOn?: string[]) => ({ key, title, detail, role, dependsOn })
const playbook = (name: string, description: string, phases: RunPlaybook['phases'], planning = true): RunPlaybook => parseRunPlaybook({ name, description, argsHint: 'Describe the task, relevant repository paths, and acceptance criteria.', maxAgents: 4, requirePlanApproval: planning, requireReview: true, phases })
export const WORKFLOW_PACKS: WorkflowPack[] = [
  { id: 'deliberate-development', title: 'Deliberate Development', version: '1.0.0', description: 'Research, plan, implement, verify, and deliver with an independent review.', sources: ['https://github.com/obra/superpowers', 'https://github.com/EveryInc/compound-engineering-plugin'], playbooks: [playbook('pack-deliberate-development', 'Plan-first implementation with independent verification.', [
    { title: 'Research and plan', tasks: [task('plan', 'Agree on a concrete plan', 'Research {{args}} in the repository. Identify affected files, constraints, acceptance checks, and ownership. Ask only for missing product decisions. Produce a concrete plan before implementation.', 'lead')] },
    { title: 'Implement', tasks: [task('implement', 'Implement the approved scope', 'Implement {{args}} according to the agreed plan. Preserve unrelated work. Keep changes narrowly scoped; record changed files and focused verification.', 'teammate', ['plan'])] },
    { title: 'Verify', tasks: [task('review', 'Independently inspect the result', 'Review the implementation of {{args}} for correctness, regression risk, acceptance criteria, and test evidence. Distinguish checks actually run from assumptions. Report actionable findings; do not silently expand scope.', 'teammate', ['implement'])] },
    { title: 'Deliver', tasks: [task('deliver', 'Resolve findings and report evidence', 'Resolve material review findings for {{args}}, rerun affected checks, and report changed behavior and remaining limits. Propose reusable project lessons as drafts for human review.', 'lead', ['review'])] },
  ])] },
  { id: 'systematic-debugging', title: 'Systematic Debugging', version: '1.0.0', description: 'Reproduce a failure, investigate the cause, make a focused fix, and verify it.', sources: ['https://github.com/obra/superpowers'], playbooks: [playbook('pack-systematic-debugging', 'Evidence-led debugging with a regression check.', [
    { title: 'Reproduce', tasks: [task('reproduce', 'Capture a minimal failing case', 'Investigate {{args}}. Capture exact reproduction steps, expected and actual behavior, and the smallest failing check available. Do not patch before collecting evidence.', 'lead')] },
    { title: 'Diagnose', tasks: [task('diagnose', 'Find and test the root cause', 'Use the reproduction of {{args}} to inspect data flow and recent changes. State a falsifiable hypothesis and test it. Explain the root cause and the smallest fix.', 'teammate', ['reproduce'])] },
    { title: 'Fix', tasks: [task('fix', 'Apply the focused fix', 'Fix the demonstrated root cause of {{args}}. Add a meaningful regression check where appropriate, preserve unrelated edits, and avoid speculative refactors.', 'teammate', ['diagnose'])] },
    { title: 'Verify', tasks: [task('verify', 'Check reproduction and nearby behavior', 'Independently rerun the original reproduction for {{args}} and focused adjacent checks. Verify the fix addresses the cause. Report exact evidence and unverified environments.', 'teammate', ['fix'])] },
  ])] },
  { id: 'test-driven-development', title: 'Test-driven Development', version: '1.0.0', description: 'An explicit red, green, refactor, and independent verification sequence.', sources: ['https://github.com/obra/superpowers'], playbooks: [playbook('pack-test-driven-development', 'Behavior-first red/green/refactor workflow.', [
    { title: 'Red', tasks: [task('red', 'Write a meaningful failing test', 'Define the requested observable behavior for {{args}} using the repository’s existing test conventions. Add a focused test and demonstrate that it fails for the intended reason before changing production behavior. If the task is unsuitable for automated testing, explain the limitation instead of inventing a shallow test.')] },
    { title: 'Green', tasks: [task('green', 'Implement enough to pass', 'Implement the requested behavior for {{args}} with the smallest coherent production change. Run the focused test and report its result.', 'teammate', ['red'])] },
    { title: 'Refactor', tasks: [task('refactor', 'Improve clarity while preserving behavior', 'Review the change for {{args}} for duplication and unnecessary complexity. Refactor only where it improves the implemented scope and keep focused tests passing.', 'teammate', ['green'])] },
    { title: 'Verify', tasks: [task('verify', 'Independently verify behavior and evidence', 'Inspect the tests and implementation for {{args}}. Confirm the tests exercise the requested behavior, run relevant checks, and report any remaining gaps.', 'teammate', ['refactor'])] },
  ])] },
  { id: 'review-council', title: 'Review Council', version: '1.0.0', description: 'Independent correctness, security, and performance reviews with one consolidated report.', sources: ['https://github.com/EveryInc/compound-engineering-plugin'], playbooks: [playbook('pack-review-council', 'Read-only specialist reviews and a consolidated findings report.', [
    { title: 'Independent reviews', tasks: [
      task('correctness', 'Review correctness and regressions', 'Read-only review of {{args}}: inspect behavior, edge cases, and regression risks. Support findings with code references and concrete triggers. Do not edit files or publish comments.'),
      task('security', 'Review trust boundaries', 'Read-only review of {{args}}: inspect relevant input validation, permissions, secret handling, and external interfaces. Report concrete risks with evidence. Do not edit files or publish comments.'),
      task('performance', 'Review performance and maintainability', 'Read-only review of {{args}}: inspect actual performance risks, resource lifetimes, concurrency, and maintainability. Separate measured evidence from hypotheses. Do not edit files or publish comments.'),
    ] },
    { title: 'Synthesize', tasks: [task('synthesis', 'Consolidate and prioritize findings', 'Consolidate the independent reviews of {{args}}. Deduplicate findings, validate their evidence, rank by impact, and distinguish confirmed defects from questions. Return one report; do not modify code or publish comments.', 'lead', ['correctness', 'security', 'performance'])] },
  ], false)] },
]
export function parseWorkflowPack(text: string): WorkflowPack {
  if (text.length > 250_000) throw new Error('Pack JSON is limited to 250,000 characters')
  const value = JSON.parse(text) as Partial<WorkflowPack>
  if (!value || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id ?? '') || typeof value.title !== 'string' || !value.title.trim() || typeof value.version !== 'string' || !value.version.trim() || !Array.isArray(value.playbooks) || !value.playbooks.length || value.playbooks.length > 20) throw new Error('Pack needs id, title, version, and 1–20 playbooks')
  const playbooks = value.playbooks.map(parseRunPlaybook)
  if (new Set(playbooks.map(item => item.name)).size !== playbooks.length) throw new Error('Pack contains duplicate workflow names')
  if (playbooks.reduce((sum, item) => sum + item.phases.reduce((n, phase) => n + phase.tasks.length, 0), 0) > 200) throw new Error('Pack is limited to 200 tasks')
  return { id: value.id!, title: value.title.trim().slice(0, 200), version: value.version.trim().slice(0, 100), description: typeof value.description === 'string' ? value.description.slice(0, 2000) : '', sources: Array.isArray(value.sources) ? value.sources.filter(url => typeof url === 'string' && /^https:\/\//.test(url)).slice(0, 20) : [], playbooks }
}
export type WorkflowPackRow = { name: string; status: 'missing' | 'installed' | 'customized' | 'invalid'; reason?: string }
export async function inspectWorkflowPack(service: PluginPlaybookService, cwd: string, pack: WorkflowPack, signal?: AbortSignal): Promise<WorkflowPackRow[]> {
  const listing = await service.list(cwd, signal)
  return Promise.all(pack.playbooks.map(async playbook => {
    if (listing.invalid.some(item => item.file.endsWith(`/${playbook.name}.json`) || item.file.endsWith(`\\${playbook.name}.json`))) return { name: playbook.name, status: 'invalid' as const, reason: 'An existing file is invalid; inspect it in Playbooks.' }
    if (!listing.playbooks.some(item => item.name === playbook.name)) return { name: playbook.name, status: 'missing' as const }
    try { const installed = await service.read(cwd, playbook.name, signal); return { name: playbook.name, status: JSON.stringify(parseRunPlaybook(installed)) === JSON.stringify(parseRunPlaybook(playbook)) ? 'installed' as const : 'customized' as const } }
    catch (error) { return { name: playbook.name, status: 'invalid' as const, reason: String(error) } }
  }))
}
export async function installWorkflowPack(service: PluginPlaybookService, cwd: string, pack: WorkflowPack, signal?: AbortSignal) {
  const rows = await inspectWorkflowPack(service, cwd, pack, signal), installed: string[] = [], skipped: string[] = [], errors: string[] = []
  for (const row of rows) {
    signal?.throwIfAborted()
    if (row.status !== 'missing') { skipped.push(`${row.name}: ${row.status}`); continue }
    try { await service.write(cwd, pack.playbooks.find(playbook => playbook.name === row.name)!, undefined, signal); installed.push(row.name) }
    catch (error) { errors.push(`${row.name}: ${String(error)}`) }
  }
  return { installed, skipped, errors }
}
