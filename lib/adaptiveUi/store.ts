// Where card rules live: one JSON file per rule in a recipes directory. Files
// rather than a database so a rule can be written by an agent with its ordinary
// file tools, reviewed in a diff, and shared by copying it. Every read validates
// (parseCardRule); a file that fails is listed with its reasons and never rendered.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseCardRule, type CardRule, type CardRuleStatus } from '../plugins/cardTemplates'

export type InvalidRuleFile = { readonly file: string; readonly problems: readonly string[] }
export type LoadedCardRules = { readonly dir: string; readonly rules: readonly CardRule[]; readonly invalid: readonly InvalidRuleFile[] }

const MAX_FILES = 500
const MAX_FILE_BYTES = 64 * 1024

export type EffectiveCardRules = { readonly dir: string; readonly rules: readonly CardRule[]; readonly invalid: readonly InvalidRuleFile[]; /** Rule id to the mod it came from; absent for the person's own rules. */ readonly origins: Readonly<Record<string, string>> }

/**
 * The rules in force: the person's own, and those a mod ships in its `ui-recipes/` folder (read-only
 * here, since the mod owns the files). A mod is already trusted code, so its rules are as trusted as
 * its hooks. The person's rule wins over a mod's with the same id, and a mod's rule file may name any
 * status: a mod that ships `active` rules is choosing what its own tools look like.
 */
export function loadEffectiveCardRules(modDirs: readonly { readonly id: string; readonly dir: string }[] = []): EffectiveCardRules {
  const own = loadCardRules()
  const rules: CardRule[] = [...own.rules]
  const invalid: InvalidRuleFile[] = [...own.invalid]
  const origins: Record<string, string> = {}
  const taken = new Set(rules.map(rule => rule.id))
  for (const mod of modDirs) {
    const loaded = loadCardRules(join(mod.dir, 'ui-recipes'))
    for (const rule of loaded.rules) { if (taken.has(rule.id)) continue; taken.add(rule.id); origins[rule.id] = mod.id; rules.push(rule) }
    for (const entry of loaded.invalid) invalid.push({ file: `${mod.id}/${entry.file}`, problems: entry.problems })
  }
  return { dir: own.dir, rules, invalid, origins }
}

export function recipesDir(): string {
  return process.env.AGENT_VIEWER_UI_RECIPES_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'agent-viewer', 'ui-recipes')
}

const cache = new Map<string, { signature: string; value: LoadedCardRules }>()

/** A cheap fingerprint of the directory: names, sizes and mtimes. Re-parsing happens only when it changes. */
function signatureOf(dir: string): string | null {
  try {
    return readdirSync(dir).filter(name => name.endsWith('.json')).sort().slice(0, MAX_FILES).map(name => { const s = statSync(join(dir, name)); return `${name}:${s.size}:${s.mtimeMs}` }).join('|')
  } catch { return null }
}

export function loadCardRules(dir = recipesDir()): LoadedCardRules {
  const signature = signatureOf(dir)
  if (signature === null) return { dir, rules: [], invalid: [] }
  const hit = cache.get(dir)
  if (hit?.signature === signature) return hit.value
  const rules: CardRule[] = []
  const invalid: InvalidRuleFile[] = []
  const seen = new Set<string>()
  for (const name of readdirSync(dir).filter(file => file.endsWith('.json')).sort().slice(0, MAX_FILES)) {
    try {
      const path = join(dir, name)
      if (statSync(path).size > MAX_FILE_BYTES) { invalid.push({ file: name, problems: [`larger than ${MAX_FILE_BYTES} bytes`] }); continue }
      const { rule, problems } = parseCardRule(JSON.parse(readFileSync(path, 'utf8')))
      if (!rule) { invalid.push({ file: name, problems }); continue }
      if (name !== `${rule.id}.json`) { invalid.push({ file: name, problems: [`the file must be named ${rule.id}.json`] }); continue }
      if (seen.has(rule.id)) { invalid.push({ file: name, problems: ['duplicate id'] }); continue }
      seen.add(rule.id); rules.push(rule)
    } catch (error) { invalid.push({ file: name, problems: [`not readable JSON: ${error instanceof Error ? error.message.slice(0, 120) : 'error'}`] }) }
  }
  const value = { dir, rules, invalid }
  cache.set(dir, { signature, value })
  return value
}

/** Atomic write of one rule, after it validates. Throws with the reasons if it does not. */
export function writeCardRule(rule: unknown, dir = recipesDir()): CardRule {
  const parsed = parseCardRule(rule)
  if (!parsed.rule) throw new Error(`card rule refused: ${parsed.problems.join('; ')}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, `${parsed.rule.id}.json`)
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(parsed.rule, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
  cache.delete(dir)
  return parsed.rule
}

export function setCardRuleStatus(id: string, status: CardRuleStatus, dir = recipesDir()): CardRule {
  const rule = loadCardRules(dir).rules.find(entry => entry.id === id)
  if (!rule) throw new Error(`no card rule "${id.slice(0, 64)}"`)
  return writeCardRule({ ...rule, status }, dir)
}

export function deleteCardRule(id: string, dir = recipesDir()): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) throw new Error('not a rule id')
  rmSync(join(dir, `${id}.json`), { force: true })
  cache.delete(dir)
}
