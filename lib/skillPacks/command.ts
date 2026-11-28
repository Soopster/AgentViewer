// What `/<pack> <task>` and `/<pack> /<skill> <task>` mean. Pure.
export type PackCommand = { skill: string; task: string } | { error: string }

/** null when the message is not this pack's command. */
export function parsePackCommand(message: string, pack: { name: string; defaultSkill: string; usage: string }, skills: readonly string[]): PackCommand | null {
  const match = message.match(new RegExp(`^\\s*/${pack.name}(?:\\s+([\\s\\S]*))?$`))
  if (!match) return null
  const rest = (match[1] ?? '').trim()
  if (!rest) return { error: pack.usage }
  const named = rest.match(/^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/)
  if (!named) return { skill: pack.defaultSkill, task: rest }
  const skill = named[1]!
  if (!skills.includes(skill)) return { error: `${pack.name} has no skill "${skill.slice(0, 60)}". ${pack.usage}` }
  return { skill, task: named[2]?.trim() || `Run the ${pack.name} ${skill} skill.` }
}
