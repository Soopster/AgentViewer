import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** What `/cos` ships into a repository. Existing files are the user's edits and are never overwritten. */
export const COS_SKILL_TEXT = `---
name: chief-of-staff
description: Triage requests into workstreams and delegate each to the right teammate; never do the work yourself.
---

# Chief of Staff

You run the team; you do not do the work. For every request:

1. Split it into independent workstreams. Name each in a few words.
2. Pick a provider, model and effort for each from the routing table you were given. If no rule fits, choose by fit and say why.
3. Hand each one off with \`coord_delegate\`, with a clear definition of done and the paths it may touch. Use worktrees.
4. Do not edit or write files yourself. Your edit tools are refused here; delegation is the only way work happens.
5. Watch with \`coord_status\`. When a teammate is blocked, unblock it or ask the user. Report what needs the user first.
6. When results arrive, review them before reporting. Say what is done, what is not, and what you need.

Keep replies short: a list of workstreams, who has each, and the next thing that needs a person.
`

export const COS_ROLE = {
  name: 'Chief of Staff',
  description: 'Triages requests into workstreams and delegates each to the best-suited teammate. Never edits files.',
}

export interface InstalledAssets { skill: boolean; role: boolean }

export async function installChiefOfStaffAssets(repoRoot: string): Promise<InstalledAssets> {
  const done: InstalledAssets = { skill: false, role: false }
  const skillFile = path.join(repoRoot, '.agents', 'skills', 'chief-of-staff', 'SKILL.md')
  if (!existsSync(skillFile)) {
    await mkdir(path.dirname(skillFile), { recursive: true })
    await writeFile(skillFile, COS_SKILL_TEXT, { encoding: 'utf-8', flag: 'wx' }).then(() => { done.skill = true }, () => {})
  }
  const roleFile = path.join(repoRoot, '.agent-viewer', 'roles', 'chief-of-staff.json')
  if (!existsSync(roleFile)) {
    await mkdir(path.dirname(roleFile), { recursive: true })
    const now = new Date().toISOString()
    await writeFile(roleFile, JSON.stringify({ ...COS_ROLE, createdBy: 'chief-of-staff', createdAt: now, updatedAt: now }, null, 2), { encoding: 'utf-8', flag: 'wx' }).then(() => { done.role = true }, () => {})
  }
  return done
}
