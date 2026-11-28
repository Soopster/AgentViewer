// The two pstack skills that are fixed fan-outs, as Coordinator playbooks.
// (swarm's slices depend on the task, so it stays a skill.)
import { parseRunPlaybook, type RunPlaybook } from '../agentProtocol'
import type { WorkflowPack } from '../plugins/workflowPacks'

const task = (key: string, title: string, detail: string, role: 'lead' | 'teammate' = 'teammate', dependsOn?: string[]) => ({ key, title, detail, role, dependsOn })
const playbook = (name: string, description: string, phases: RunPlaybook['phases']): RunPlaybook =>
  parseRunPlaybook({ name, description, argsHint: 'The change or task, the repository paths involved, and what success looks like.', maxAgents: 4, phases })

const breaker = (key: string, angle: string) => task(key, `Break it: ${angle}`,
  `Adversarial review of {{args}}, concentrating on ${angle}. Try to break the change. Prove each finding with a run against the real code (a failing test, a repro script, or command output) and report the exact command, its output, and what the intent requires. Leave out anything you did not run. Do not fix anything in the shared checkout. No findings is a valid result.`)
const candidate = (n: number) => task(`candidate-${n}`, `Candidate ${n}`,
  `Produce your own complete solution to {{args}} in your own worktree, without reading other candidates' work. Finish with a short rationale naming the alternatives you rejected, and the checks you actually ran.`)

export const PSTACK_PACK: WorkflowPack = {
  id: 'pstack', title: 'pstack', version: '1.0.0', description: 'pstack\'s interrogate and arena fan-outs as Coordinator playbooks.',
  sources: ['https://github.com/cursor/plugins/tree/main/pstack'],
  playbooks: [
    playbook('pstack-interrogate', 'Adversarial review: only findings proven by a run survive.', [
      { title: 'Attack', tasks: [breaker('behavior', 'behavior and edge cases'), breaker('state', 'state, concurrency and failure handling'), breaker('boundaries', 'inputs, permissions and external interfaces')] },
      { title: 'Verify', tasks: [task('verdict', 'Rerun every finding', 'For each finding on {{args}}, rerun its command. Keep it only if the output shows the failure and the failure breaks the intent. Merge findings with one root cause. Report intent, verified findings with command and output, and what was dropped and why. Do not apply fixes.', 'lead', ['behavior', 'state', 'boundaries'])] },
    ]),
    playbook('pstack-arena', 'Competing attempts, one base, the best parts of the rest grafted in.', [
      { title: 'Fan out', tasks: [candidate(1), candidate(2), candidate(3)] },
      { title: 'Pick and graft', tasks: [task('synthesis', 'Pick a base and graft', 'Write 3-6 gradeable criteria for {{args}}, then read every candidate end to end and score each. Pick the base a maintainer can extend most easily, graft the few worthwhile parts of the others by hand, and verify the result. Report the base and why, each graft and its source, and the verification output.', 'lead', ['candidate-1', 'candidate-2', 'candidate-3'])] },
    ]),
  ],
}
