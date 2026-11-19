import type { ComposerSkill } from './types'

/** Higher is a better match; 0 is no match. Tiers are far apart so frecency only breaks ties. */
export function matchTier(skill: ComposerSkill, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const name = skill.name.toLowerCase()
  if (name === q) return 7
  if (name.startsWith(q)) return 6
  if (name.split(/[-_\s:./]+/).some(word => word.startsWith(q))) return 5
  if (name.includes(q)) return 4
  if (skill.description.toLowerCase().includes(q)) return 3
  // Subsequence over the name: "cos" finds chief-of-staff.
  let at = 0
  for (const char of name) if (char === q[at] && ++at === q.length) return 2
  return 0
}

/**
 * Match quality first; among equals the skill used most and most recently
 * (`frecency`, higher first); then A–Z. A typed query still finds a skill never used.
 */
export function rankSkills(
  skills: readonly ComposerSkill[],
  query: string,
  frecency: (skill: ComposerSkill) => number = () => 0,
): ComposerSkill[] {
  return skills
    .map(skill => ({ skill, tier: matchTier(skill, query), use: frecency(skill) }))
    .filter(entry => entry.tier > 0)
    .sort((a, b) => b.tier - a.tier || b.use - a.use || a.skill.name.localeCompare(b.skill.name))
    .map(entry => entry.skill)
}

const STOP = new Set('the and for with that this from have has are was were you your use using when what into how can will not but all any out our their then than them its who why too'.split(' '))

export function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2 && !STOP.has(word))
}

/**
 * Skills whose name or description share vocabulary with the draft. Lexical on purpose:
 * it runs as the person types, so it must be cheap and must never call a model.
 * A name word in the draft counts triple; a lone shared common word is not enough.
 */
export function suggestSkills(skills: readonly ComposerSkill[], draft: string, limit = 3): ComposerSkill[] {
  const draftWords = new Set(tokens(draft))
  if (draftWords.size < 2) return []
  const scored: Array<{ skill: ComposerSkill; score: number }> = []
  for (const skill of skills) {
    const nameWords = new Set(tokens(skill.name))
    const descWords = new Set(tokens(skill.description))
    let hits = 0
    let score = 0
    for (const word of draftWords) {
      if (nameWords.has(word)) { score += 3; hits += 1 } else if (descWords.has(word)) { score += 1; hits += 1 }
    }
    // Normalised by description length so a long description does not win by volume.
    const normalised = score / Math.sqrt(Math.max(descWords.size, 4))
    if (hits >= 2 || (hits === 1 && score >= 3)) scored.push({ skill, score: normalised })
  }
  return scored.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name)).slice(0, limit).map(entry => entry.skill)
}
