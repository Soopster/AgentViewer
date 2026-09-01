/** @jsxImportSource @opentui/react */
// Typing-latency benchmark for the project editor, swept across file sizes.
//
// A text editor's defining performance property is that a keystroke costs the
// same in a 6,000-line file as in a 200-line one. This harness types into the
// real EditorPopover at key-repeat speed and reports what a React Profiler
// around it saw: commits, how many blew the frame budget, and the worst one.
// It also reports "settle", the wall time from the last keystroke until the
// debounced syntax/occurrence work stops repainting — the lag a typist feels
// as the buffer catching up after they stop.
//
// Each file size runs in its OWN process: the syntax highlighter, the LSP
// client and the tree-sitter worker all carry state across a run, so sizes
// measured in one process are not comparable.
import React, { act, type ProfilerOnRenderCallback } from 'react'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { formatTuiFrameBudgetMs, TUI_FRAME_BUDGET_MS, TUI_TARGET_FPS } from './performanceBudget'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'

const SIZES = (process.env.EDITOR_TYPING_SIZES ?? '200,2000,6000')
  .split(',').map((value) => Number.parseInt(value.trim(), 10)).filter((value) => value > 0)
const KEYSTROKES = Number.parseInt(process.env.EDITOR_TYPING_KEYSTROKES ?? '', 10) || 40

// A minified bundle: few lines, each enormous. Everything that scans "the
// current line" — occurrence matching, bracket matching, indent detection —
// meets its worst case here rather than in a large well-formed file.
function sourceOfLongLines(lines: number): string {
  const out: string[] = []
  for (let index = 0; index < lines; index += 1) {
    const parts: string[] = []
    const parts_per_line = Number.parseInt(process.env.EDITOR_TYPING_PARTS ?? '', 10) || 400
    for (let part = 0; part < parts_per_line; part += 1) parts.push(`f${part}(a${part},b${part})`)
    out.push(`export const chunk${index}=[${parts.join(',')}];`)
  }
  return `${out.join('\n')}\n`
}

function sourceOfLines(lines: number): string {
  const out: string[] = ['export type Row = { id: number; label: string; total: number }', '']
  for (let index = 0; out.length < lines; index += 1) {
    out.push(
      `export function computeRow${index}(rows: Row[], factor: number): number {`,
      `  const scaled = rows.map((row) => row.total * factor + ${index})`,
      `  const label = scaled.length > 0 ? \`row-${index}\` : 'empty'`,
      '  return scaled.reduce((sum, value) => sum + value, label.length)',
      '}',
      '',
    )
  }
  return `${out.slice(0, lines).join('\n')}\n`
}

async function settle(setup: Awaited<ReturnType<typeof testRender>>, durationMs: number): Promise<void> {
  const deadline = performance.now() + durationMs
  while (performance.now() < deadline) {
    await act(async () => {
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 8))
    })
  }
}

async function runSize(lines: number): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-typing-perf-'))
  // No language server: this measures the editor's own per-keystroke cost, and
  // a real tsserver's latency would swamp it.
  const originalServer = process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
  process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = join(workspace, 'absent-language-server')
  // A `.txt` file has no tree-sitter filetype, so nothing highlights: running
  // the same scenario both ways separates the highlighter's cost from the rest
  // of the editor's per-keystroke work.
  const sourcePath = join(workspace, `main.${process.env.EDITOR_TYPING_EXT ?? 'ts'}`)
  const longLines = process.env.EDITOR_TYPING_LONG_LINES === '1'
  await writeFile(sourcePath, longLines ? sourceOfLongLines(lines) : sourceOfLines(lines), 'utf8')
  const syntaxStyle = SyntaxStyle.fromStyles({
    keyword: { fg: RGBA.fromHex(DARK_THEME.violet), bold: true },
    string: { fg: RGBA.fromHex(DARK_THEME.green) },
    default: { fg: RGBA.fromHex(DARK_THEME.text) },
  })
  const frames = { commits: 0, over: 0, worst: 0 }
  let recording = false
  const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration, _base, _start, commitTime) => {
    if (!recording) return
    const durationMs = actualDuration + Math.max(0, performance.now() - commitTime)
    frames.commits += 1
    frames.worst = Math.max(frames.worst, durationMs)
    if (durationMs > TUI_FRAME_BUDGET_MS) frames.over += 1
  }
  let handleKey: ((key: EditorKeyEvent) => boolean) | null = null

  const setup = await testRender(
    <React.Profiler id="EditorPopover" onRender={onRender}>
      <EditorPopover
        cwd={workspace}
        initialPath={sourcePath}
        theme={DARK_THEME}
        width={120}
        height={36}
        syntaxStyle={syntaxStyle}
        onClose={() => {}}
        onKeyHandlerReady={(handler) => { handleKey = handler }}
      />
    </React.Profiler>,
    { width: 120, height: 36 },
  )
  try {
    await settle(setup, 900)
    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (!editor || !handleKey) throw new Error(`Typing benchmark did not mount the editor for ${lines} lines`)
    if (editor.plainText.split('\n').length < lines) {
      throw new Error(`Editor loaded ${editor.plainText.split('\n').length} lines, expected ${lines}`)
    }
    void longLines
    // Type in the middle of the file, where a real edit happens, not at a
    // boundary the highlighter might treat cheaply.
    act(() => { editor.gotoBufferEnd() })
    await settle(setup, 250)

    const keystrokes: number[] = []
    // The debounced highlight work runs imperatively on timers and in the
    // tree-sitter worker thread, so a React Profiler cannot see it. Process
    // CPU does: it covers the parse, the highlight application, and the
    // render, across every thread. Cost-per-keystroke is the number that must
    // not grow with file size.
    const cpuBefore = process.cpuUsage()
    recording = true
    for (let index = 0; index < KEYSTROKES; index += 1) {
      const startedAt = performance.now()
      await act(async () => {
        await setup.mockInput.typeText('x')
        await setup.flush()
      })
      keystrokes.push(performance.now() - startedAt)
      // Key-repeat cadence: fast enough that debounced work overlaps typing,
      // which is exactly the condition that makes a slow editor feel slow.
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 16)) })
    }
    const lastKeystrokeAt = performance.now()
    // Settle: keep pumping until a full budget's worth of frames land under
    // budget, which is when the debounced work has drained.
    let quietSince = performance.now()
    const settleDeadline = performance.now() + 4_000
    let lastCommits = frames.commits
    while (performance.now() < settleDeadline) {
      await settle(setup, 24)
      if (frames.commits !== lastCommits) { lastCommits = frames.commits; quietSince = performance.now() }
      else if (performance.now() - quietSince > 200) break
    }
    const settleMs = Math.max(0, quietSince - lastKeystrokeAt)
    const cpuAfter = process.cpuUsage(cpuBefore)
    const cpuMsPerKey = (cpuAfter.user + cpuAfter.system) / 1000 / KEYSTROKES
    recording = false

    const sorted = [...keystrokes].sort((left, right) => left - right)
    const p50 = sorted[Math.ceil(sorted.length * 0.5) - 1]!
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!
    console.log(JSON.stringify({
      lines, commits: frames.commits, over: frames.over, worst: frames.worst,
      keyP50: p50, keyP95: p95, settleMs, cpuMsPerKey,
    }))
  } finally {
    act(() => setup.renderer.destroy())
    syntaxStyle.destroy()
    if (originalServer == null) delete process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
    else process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = originalServer
    await rm(workspace, { recursive: true, force: true })
  }
}

const childSize = Number.parseInt(process.env.EDITOR_TYPING_ONE_SIZE ?? '', 10)
if (childSize > 0) {
  await runSize(childSize)
  process.exit(0)
}

console.log('Editor typing latency by file size')
console.log(`  target ${TUI_TARGET_FPS}fps (${formatTuiFrameBudgetMs()}ms frame budget), ${KEYSTROKES} keystrokes per size`)
console.log(`  ${'lines'.padStart(6)} ${'commits'.padStart(8)} ${`over-${formatTuiFrameBudgetMs()}ms`.padStart(12)} ${'worst'.padStart(9)} ${'key p50'.padStart(9)} ${'key p95'.padStart(9)} ${'settle'.padStart(9)} ${'cpu/key'.padStart(9)}`)
const rows: Array<{ lines: number; keyP50: number; cpuMsPerKey: number }> = []
for (const lines of SIZES) {
  const child = spawnSync('bun', ['run', fileURLToPath(import.meta.url)], {
    env: { ...process.env, EDITOR_TYPING_ONE_SIZE: String(lines) },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const line = (child.stdout ?? '').trim().split('\n').filter(Boolean).at(-1) ?? ''
  let parsed: Record<string, number>
  try { parsed = JSON.parse(line) } catch {
    console.error((child.stderr ?? '').split('\n').slice(-20).join('\n'))
    throw new Error(`Typing benchmark for ${lines} lines produced no result: ${line}`)
  }
  rows.push({ lines, keyP50: parsed.keyP50!, cpuMsPerKey: parsed.cpuMsPerKey! })
  console.log(
    `  ${String(lines).padStart(6)} ${String(parsed.commits).padStart(8)} ${String(parsed.over).padStart(12)}`
    + ` ${(parsed.worst!.toFixed(1) + 'ms').padStart(9)} ${(parsed.keyP50!.toFixed(1) + 'ms').padStart(9)}`
    + ` ${(parsed.keyP95!.toFixed(1) + 'ms').padStart(9)} ${(parsed.settleMs!.toFixed(0) + 'ms').padStart(9)}`
    + ` ${(parsed.cpuMsPerKey!.toFixed(1) + 'ms').padStart(9)}`,
  )
}
const smallest = rows[0]
const largest = rows.at(-1)
if (smallest && largest && largest !== smallest) {
  console.log(
    `  cost at ${largest.lines} lines vs ${smallest.lines}:`
    + ` keystroke ${(largest.keyP50 / Math.max(0.01, smallest.keyP50)).toFixed(2)}x,`
    + ` cpu/key ${(largest.cpuMsPerKey / Math.max(0.01, smallest.cpuMsPerKey)).toFixed(2)}x`,
  )
}
