#!/usr/bin/env node
// Copies pstack (MIT, https://github.com/cursor/plugins/tree/main/pstack) into plugins/pstack/vendor.
// Rerun against a fresh clone to update: node scripts/vendorPstack.mjs <path-to-cursor-plugins-clone>
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const clone = process.argv[2]
if (!clone || !existsSync(path.join(clone, 'pstack', 'skills'))) {
  console.error('usage: node scripts/vendorPstack.mjs <path-to-cursor-plugins-clone>')
  process.exit(2)
}
const source = path.join(clone, 'pstack')
const target = fileURLToPath(new URL('../plugins/pstack/vendor', import.meta.url))
// Cursor-only, replaced by the Models panel (setup-pstack), or a TLA+ toolchain of several MB (statechart).
const EXCLUDED_SKILLS = ['make-bot-ui', 'setup-pstack', 'statechart']

rmSync(target, { recursive: true, force: true })
const keep = file => !/node_modules|\.DS_Store|\.(png|jpe?g)$/.test(file)
  && !EXCLUDED_SKILLS.some(name => file === path.join(source, 'skills', name))
for (const item of ['skills', 'agents', 'docs/guide', 'LICENSE', 'README.md']) {
  cpSync(path.join(source, item), path.join(target, item), { recursive: true, filter: keep })
}
const commit = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const { version } = JSON.parse(readFileSync(path.join(source, '.cursor-plugin', 'plugin.json'), 'utf8'))
writeFileSync(path.join(target, 'VENDOR.json'), `${JSON.stringify({ source: 'https://github.com/cursor/plugins/tree/main/pstack', commit, version, excludedSkills: EXCLUDED_SKILLS }, null, 2)}\n`)
console.log(`Vendored pstack ${version} at ${commit.slice(0, 12)}`)
