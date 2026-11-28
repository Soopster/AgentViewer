// What `/matt ...` means. Pure.
import { parsePackCommand } from '../skillPacks/command'

export const MATT_CONTEXT_TAG = 'matt_skills_context'
/** Upstream's router: it names the skill or flow that fits. */
export const MATT_DEFAULT_SKILL = 'ask-matt'
export const MATT_SETUP_SKILL = 'setup-matt-pocock-skills'
export const MATT_USAGE = 'Usage: /matt <what you are doing> to be pointed at a skill, or /matt /<skill> <task> (for example /matt /grill-with-docs a new export feature). The Matt Pocock skills panel lists them.'

/** null when the message is not a /matt command. */
export const parseMattCommand = (message: string, skills: readonly string[]) =>
  parsePackCommand(message, { name: 'matt', defaultSkill: MATT_DEFAULT_SKILL, usage: MATT_USAGE }, skills)

/** The task stays first, so a session is titled after what the user asked. */
export function mattMessage(params: { task: string; skill: string; root: string; adapter: string; configured: boolean }): string {
  return `${params.task}

<${MATT_CONTEXT_TAG} skill="${params.skill}">
The user started the ${params.skill} skill. Before anything else read, in full:
1. ${params.adapter}
2. ${params.root}/skills/${params.skill}/SKILL.md
<matt> is ${params.root}. If you cannot read these files, say so and stop.

Repository setup: ${params.configured ? 'done, read docs/agents/ for the issue tracker and doc layout.' : `not run (no docs/agents/issue-tracker.md). /matt /${MATT_SETUP_SKILL} runs it.`}
</${MATT_CONTEXT_TAG}>`
}
