// A skill pack vendored under plugins/<id>: where it lives and which skills it ships. Node only.
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function skillPackLibrary(id: string, envVar: string) {
  const dir = () => {
    const shipped = process.env[envVar]?.trim()
    if (shipped) return shipped
    // A bundler may rewrite import.meta.url, so fall back to the checkout the process runs in.
    try {
      const beside = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugins', id)
      if (existsSync(path.join(beside, 'adapter.md'))) return beside
    } catch {}
    return path.join(process.cwd(), 'plugins', id)
  }
  const libraryDir = () => path.join(dir(), 'vendor')
  const skillsDir = () => path.join(libraryDir(), 'skills')
  const skillFile = (name: string) => path.join(skillsDir(), name, 'SKILL.md')
  const list = (): string[] => {
    try {
      return readdirSync(skillsDir(), { withFileTypes: true })
        .filter(entry => entry.isDirectory() && existsSync(skillFile(entry.name)))
        .map(entry => entry.name).sort()
    } catch { return [] }
  }
  return { dir, libraryDir, skillsDir, skillFile, list }
}
