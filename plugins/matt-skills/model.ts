// What both panels show. Pure.
import { MATT_SETUP_SKILL } from '../../lib/mattSkills/command'
import type { MattSkill, MattSkillsState } from '../../lib/mattSkills/service'

export const FLOW_LINE = 'idea → /grill-with-docs → /to-spec → /to-tickets → /implement → /retro'
export const USAGE_LINE = '/matt <what you are doing> picks a skill · /matt /<skill> <task> runs one'
export const mattPrompt = (name: string) => `/matt /${name} `
export const SETUP_PROMPT = mattPrompt(MATT_SETUP_SKILL)

export const setupSummary = (setup: MattSkillsState['setup']) => setup.configured
  ? 'This repository is set up.'
  : 'Not set up: the engineering skills need an issue tracker.'

/** Upstream's split: the first group only a person starts. */
export function skillGroups(skills: readonly MattSkill[]): { title: string; skills: MattSkill[] }[] {
  return [
    { title: 'You start these', skills: skills.filter(skill => skill.userInvoked) },
    { title: 'The agent also reaches for these', skills: skills.filter(skill => !skill.userInvoked) },
  ]
}
