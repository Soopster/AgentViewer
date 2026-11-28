// The code-review skill's fixed fan-out (two separate reviewers, then side by side) as a Coordinator playbook.
import { parseRunPlaybook, type RunPlaybook } from '../agentProtocol'
import type { WorkflowPack } from '../plugins/workflowPacks'

const task = (key: string, title: string, detail: string, role: 'lead' | 'teammate' = 'teammate', dependsOn?: string[]) => ({ key, title, detail, role, dependsOn })
const review: RunPlaybook = parseRunPlaybook({
  name: 'matt-code-review', description: 'Two-axis review: repository standards and the spec, judged separately.',
  argsHint: 'The fixed point to diff from (commit, branch or tag), and where the spec is, if there is one.', maxAgents: 3,
  phases: [
    { title: 'Review', tasks: [
      task('standards', 'Standards axis', 'For {{args}}, review `git diff <fixed-point>...HEAD` against every file in the repository that documents how code should be written, plus the Fowler smells (mysterious name, duplicated code, feature envy, data clumps, primitive obsession, repeated switches, shotgun surgery, divergent change, speculative generality, message chains, middle man, refused bequest). A documented standard overrides a smell; smells are judgement calls. Cite the file and rule, or name the smell and quote the hunk. Skip what tooling enforces. Do not edit files. Under 400 words.'),
      task('spec', 'Spec axis', 'For {{args}}, compare `git diff <fixed-point>...HEAD` with the originating spec or issue. Report requirements that are missing or partial, behaviour nobody asked for, and requirements implemented wrongly, quoting the spec line for each. If there is no spec, report "no spec available". Do not edit files. Under 400 words.'),
    ] },
    { title: 'Report', tasks: [task('report', 'Report both axes', 'For {{args}}, present both reports under "## Standards" and "## Spec". Do not merge or rerank them. End with one line: the number of findings on each axis and the worst one within each. Do not apply fixes.', 'lead', ['standards', 'spec'])] },
  ],
})

export const MATT_PACK: WorkflowPack = {
  id: 'matt-skills', title: 'Matt Pocock skills', version: '1.0.0', description: 'The two-axis code-review skill as a Coordinator playbook.',
  sources: ['https://github.com/mattpocock/skills'], playbooks: [review],
}
