#!/usr/bin/env node
// Copies mattpocock/skills (MIT) into plugins/matt-skills/vendor: the skills its own plugin manifest ships,
// without its buckets, so each is vendor/skills/<name>. File contents are not changed.
// Rerun against a fresh clone to update: node scripts/vendorMattSkills.mjs <path-to-clone>
import { cpSync, existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const clone = process.argv[2]
if (!clone || !existsSync(path.join(clone, '.claude-plugin', 'plugin.json'))) {
  console.error('usage: node scripts/vendorMattSkills.mjs <path-to-mattpocock-skills-clone>')
  process.exit(2)
}
const { version, skills } = JSON.parse(readFileSync(path.join(clone, '.claude-plugin', 'plugin.json'), 'utf8'))
const root = path.resolve(clone, 'skills') + path.sep
const target = fileURLToPath(new URL('../plugins/matt-skills/vendor', import.meta.url))
const names = new Set()
for (const entry of skills) {
  if (!path.resolve(clone, entry).startsWith(root)) throw new Error(`Refusing a skill path outside skills/: ${entry}`)
  if (names.has(path.basename(entry))) throw new Error(`Two skills are named ${path.basename(entry)}`)
  names.add(path.basename(entry))
}
rmSync(target, { recursive: true, force: true })
// No symlinks: one could make the app serve a file from outside the pack.
const keep = file => !/node_modules|\.DS_Store/.test(file) && !lstatSync(file).isSymbolicLink()
for (const entry of skills) cpSync(path.resolve(clone, entry), path.join(target, 'skills', path.basename(entry)), { recursive: true, filter: keep })
for (const item of ['LICENSE', 'README.md']) cpSync(path.join(clone, item), path.join(target, item), { filter: keep })
const commit = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
writeFileSync(path.join(target, 'VENDOR.json'), `${JSON.stringify({ source: 'https://github.com/mattpocock/skills', commit, version }, null, 2)}\n`)
console.log(`Vendored ${skills.length} skills (${version}) at ${commit.slice(0, 12)}`)
