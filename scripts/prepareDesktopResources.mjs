#!/usr/bin/env node
// Assembles the resources a packaged Tauri desktop build needs:
//   - a pruned Next.js standalone server (from `next build`'s
//     `output: 'standalone'`, plus the static/public assets it doesn't
//     trace but still needs to serve)
//   - the AHP Coordinator sidecar and the OpenTUI binary, each compiled to a
//     single native binary via `bun build --compile` so packaged installs
//     don't need Bun at all, only the Node.js already required for the web
//     server. The TUI binary is what the app's embedded-terminal page runs.
//
// Run via `npm run desktop:prepare` (also wired into `desktop:build`).
// Idempotent: safe to re-run, always rebuilds from the current .next output.

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const standaloneDir = path.join(repoRoot, '.next', 'standalone')
const staticDir = path.join(repoRoot, '.next', 'static')
const publicDir = path.join(repoRoot, 'public')
const resourcesDir = path.join(repoRoot, 'src-tauri', 'resources', 'next-standalone')
const binariesDir = path.join(repoRoot, 'src-tauri', 'binaries')
const typescriptLspSourceDir = path.join(
  repoRoot,
  'node_modules',
  '@typescript',
  `typescript-${process.platform}-${process.arch}`,
  'lib',
)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`)
  }
}

// Tauri's externalBin naming convention: "<name>-<rustc-host-triple>[.exe]".
function rustcHostTriple() {
  const result = spawnSync('rustc', ['-vV'], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error('rustc -vV failed — is the Rust toolchain installed?')
  }
  const match = result.stdout.match(/^host:\s*(\S+)$/m)
  if (!match) throw new Error('could not parse rustc host triple from `rustc -vV`')
  return match[1]
}

function main() {
  if (!existsSync(standaloneDir)) {
    throw new Error(
      `${standaloneDir} not found — run \`npm run build\` first (requires output: 'standalone' in next.config.ts).`,
    )
  }

  console.log('[prepare-desktop] assembling Next.js standalone resources...')
  rmSync(resourcesDir, { recursive: true, force: true })
  mkdirSync(resourcesDir, { recursive: true })
  cpSync(standaloneDir, resourcesDir, { recursive: true })
  // Standalone tracing intentionally excludes static/public assets — Next's
  // own docs require copying these in manually alongside server.js.
  cpSync(staticDir, path.join(resourcesDir, '.next', 'static'), { recursive: true })
  if (existsSync(publicDir)) {
    cpSync(publicDir, path.join(resourcesDir, 'public'), { recursive: true })
  }
  if (!existsSync(typescriptLspSourceDir)) {
    throw new Error(`TypeScript 7 LSP runtime not found at ${typescriptLspSourceDir} — run \`npm install\` first.`)
  }
  cpSync(typescriptLspSourceDir, path.join(resourcesDir, 'typescript-lsp'), { recursive: true })

  console.log('[prepare-desktop] compiling AHP sidecar with bun build --compile...')
  mkdirSync(binariesDir, { recursive: true })
  const triple = rustcHostTriple()
  const ahpOutfile = path.join(binariesDir, `agent-viewer-ahp-${triple}`)
  run('bun', [
    'build',
    path.join(repoRoot, 'bin', 'agent-viewer-ahp.ts'),
    '--compile',
    '--outfile',
    ahpOutfile,
  ])

  console.log('[prepare-desktop] compiling TUI with bun build --compile...')
  const tuiOutfile = path.join(binariesDir, `agent-viewer-tui-${triple}`)
  // The workers are passed as extra entrypoints so `bun build --compile`
  // embeds them in the binary under `$bunfs`, and `--root .` keys each one by
  // its repository path (`root/tui/opentui/threadingWorker.js`,
  // `root/plugins/analytics/tui/analyticsWorker.js`), which is what
  // tui/opentui/workerUrl.ts resolves. Without `--root` Bun keys them from the
  // entrypoints' common ancestor, which a plugin worker moves. Entrypoint paths
  // must be RELATIVE (cwd at the repo root). scripts/tuiWorkerEntrypointsSmoke.ts
  // checks this list against every worker the code starts.
  run(
    'bun',
    [
      'build',
      'tui/opentui/main.tsx',
      'tui/opentui/threadingWorker.ts',
      'tui/opentui/markdownBlocksWorker.ts',
      'plugins/analytics/tui/analyticsWorker.ts',
      'tui/opentui/editorProjectSearchWorker.ts',
      'tui/opentui/composerMentionWorker.ts',
      'tui/opentui/gitDiffHighlightWorker.ts',
      // Pins each embedded worker at its repository path (tui/opentui/workerUrl.ts).
      '--root',
      '.',
      '--compile',
      '--outfile',
      tuiOutfile,
    ],
    { cwd: repoRoot },
  )

  console.log(`[prepare-desktop] done. resources: ${resourcesDir}`)
  console.log(`[prepare-desktop] done. sidecar:   ${ahpOutfile}`)
  console.log(`[prepare-desktop] done. tui binary: ${tuiOutfile}`)
}

main()
