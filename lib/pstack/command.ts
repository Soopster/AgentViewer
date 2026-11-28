// What `/pstack ...` means. Pure.
import { parsePackCommand, type PackCommand } from '../skillPacks/command'

export const PSTACK_CONTEXT_TAG = 'pstack_context'
export const PSTACK_DEFAULT_SKILL = 'poteto-mode'
export const PSTACK_USAGE = 'Usage: /pstack <task>, or /pstack /<skill> <task> (for example /pstack /interrogate this branch). The pstack panel lists the skills.'

export type PstackCommand = PackCommand

/** null when the message is not a /pstack command. */
export const parsePstackCommand = (message: string, skills: readonly string[]) =>
  parsePackCommand(message, { name: 'pstack', defaultSkill: PSTACK_DEFAULT_SKILL, usage: PSTACK_USAGE }, skills)

/** The task stays first, so a session is titled after what the user asked. */
export function pstackMessage(params: { task: string; skill: string; root: string; adapter: string; roleTable: string }): string {
  return `${params.task}

<${PSTACK_CONTEXT_TAG} skill="${params.skill}">
Work in pstack style for this task. Before anything else read, in full:
1. ${params.adapter}
2. ${params.root}/skills/${params.skill}/SKILL.md
<pstack> is ${params.root}. If you cannot read these files, say so and stop.

Model roles:
${params.roleTable}
</${PSTACK_CONTEXT_TAG}>`
}
