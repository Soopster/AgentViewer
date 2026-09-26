// Live smoke for Claude's model list (lib/claudeModels.ts).
//
// The list belongs to the install, but it was read on every session opened,
// each read spawned a Claude CLI that booted every configured MCP server, and
// the warm slot re-spawned one after each use — so one idle CLI tree (~1.6GB
// here) was always alive and browsing spawned another per selection. None of
// that shows in a frame, so this counts processes.
//
//   bun run ./scripts/claudeModelListSmoke.ts   (needs a working Claude CLI)
import { execFileSync } from 'node:child_process'
import { readClaudeSupportedModels } from '../lib/claudeModels'
import { consumeReadModelsWarmQuery, primeReadModelsWarmQuery } from '../lib/sdkControlQuery'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}
function descendants(pid: number): number[] {
  let children: number[] = []
  try {
    children = execFileSync('pgrep', ['-P', String(pid)]).toString().trim().split('\n').filter(Boolean).map(Number)
  } catch { /* pgrep exits 1 when there are none */ }
  return children.flatMap((child) => [child, ...descendants(child)])
}

// Sample the tree while the first (cold) listing runs. The CLI's own plugin
// hooks (SessionStart) legitimately run on any start and are left alone —
// skipping them would mean skipping settings, which can change the list — so
// this looks for MCP servers by command line, which is how they are named.
const mcpSeen = new Set<string>()
const sampler = setInterval(() => {
  for (const pid of descendants(process.pid)) {
    try {
      const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)]).toString().trim()
      // The CLI's own argv names its (empty) MCP config; only its children count.
      if (/mcp/i.test(command) && !command.includes('claude-agent-sdk')) mcpSeen.add(command.slice(0, 120))
    } catch { /* exited between listing and reading */ }
  }
}, 100)
const first = await readClaudeSupportedModels()
clearInterval(sampler)
check('the model list is non-empty', first.length > 0, `${first.length} models`)
check('listing starts no MCP servers', mcpSeen.size === 0, [...mcpSeen].join(' | '))

const t0 = performance.now()
const second = await readClaudeSupportedModels()
const elapsed = performance.now() - t0
check('a second read is served from the cache', elapsed < 50 && second === first, `${elapsed.toFixed(1)}ms`)

primeReadModelsWarmQuery()
const warm = await consumeReadModelsWarmQuery()
warm?.query((async function* () {})()).close()
await Bun.sleep(2500)
check('nothing is left running after a warm slot is consumed', descendants(process.pid).length === 0,
  `${descendants(process.pid).length} process(es)`)

console.log(failures === 0 ? 'claude model list: ok' : `claude model list: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
