/** @jsxImportSource @opentui/react */
// The process pane: processes that outlive their view, output read the way it
// was meant, the newest stack trace found and handed over, file:line links.
//
// Each defect here looks fine on screen. A trace finder that stops one line
// short drops the message that says what failed; a stop that signals only the
// shell leaves the dev server holding its port; a pane that kills its children
// on unmount kills the server the user only meant to hide.
import React from 'react'
import { mkdtemp, realpath, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { ProcessPane, type ProcessPaneKey } from './ProcessPane'
import { addProcess, getProcesses, resetProcessesForTest, startProcess, stopProcess, stripAnsi } from './processStore'
import { readProcessConfig } from './processConfig'
import { buildStackTracePrompt, findLatestStackTrace, parseStackFrame } from '../../lib/stackTraces'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(predicate: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && !predicate()) await wait(25)
  assert(predicate(), what)
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

// ── Stack traces ────────────────────────────────────────────────────────────
{
  const node = [
    'GET / 200 in 12ms',
    '/repo/src/server.ts:41',
    '    throw new Error("boom")',
    '    ^',
    '',
    'Error: boom',
    '    at handler (/repo/src/server.ts:41:11)',
    '    at Layer.handle (/repo/node_modules/express/lib/router/layer.js:95:5)',
    '    at node:internal/process/task_queues:105:5',
    'GET /health 200 in 1ms',
  ]
  const trace = findLatestStackTrace(node)
  assert(trace, 'a Node trace was not found')
  assert(trace.lines[0] === '/repo/src/server.ts:41' && trace.lines.at(-1)!.includes('task_queues'), `node trace bounds: ${JSON.stringify(trace.lines)}`)
  assert(trace.headline === 'Error: boom', `headline ${trace.headline}`)
  assert(trace.frames[0]!.path === '/repo/src/server.ts' && trace.frames[0]!.line === 41 && !trace.frames[0]!.external, 'own frame first')
  assert(trace.frames.find((frame) => frame.path.includes('node_modules'))?.external, 'a dependency frame is external')
  assert(trace.frames.find((frame) => frame.path.startsWith('node:'))?.external, 'a runtime frame is external')

  const python = [
    'Traceback (most recent call last):',
    '  File "/app/main.py", line 8, in <module>',
    '    run()',
    '  File "/app/jobs.py", line 3, in run',
    '    1 / 0',
    'ZeroDivisionError: division by zero',
    'INFO shutting down',
  ]
  const py = findLatestStackTrace(python)!
  assert(py.lines[0]!.startsWith('Traceback') && py.lines.at(-1) === 'ZeroDivisionError: division by zero', `python bounds: ${JSON.stringify(py.lines)}`)
  assert(py.frames.map((frame) => `${frame.path}:${frame.line}`).join(',') === '/app/main.py:8,/app/jobs.py:3', 'python frames')

  // A message line that reads as nothing ("boom" thrown as a string) is still the trace's top.
  const bare = findLatestStackTrace(['ready', 'boom', '    at run (/r/a.js:1:1)'])!
  assert(bare.lines[0] === 'boom', `the message above the first frame was dropped: ${JSON.stringify(bare.lines)}`)

  // The newest of two errors is the one returned.
  const two = findLatestStackTrace(['Error: first', '    at a (/r/a.ts:1:1)', 'ok', 'TypeError: second', '    at b (/r/b.ts:2:2)'])!
  assert(two.headline === 'TypeError: second' && two.frames.length === 1, 'the newest trace must win')

  const tsc = parseStackFrame('src/app.ts(12,5): error TS2322: Type string is not assignable')
  assert(tsc?.path === 'src/app.ts' && tsc.line === 12 && tsc.column === 5, 'tsc location')
  const go = findLatestStackTrace(['panic: runtime error: index out of range', '', 'goroutine 1 [running]:', 'main.main()', '\t/src/main.go:9 +0x1d'])!
  assert(go.frames[0]?.path === '/src/main.go' && go.frames[0].line === 9, `go frame: ${JSON.stringify(go)}`)
  assert(parseStackFrame('error: upgraded from 1.2.3:4 to 2.0') === null, 'a version number is not a location')
  assert(findLatestStackTrace(['compiled', 'ready on :3000']) === null, 'clean output has no error')

  const prompt = buildStackTracePrompt({ trace, processName: 'web', command: 'npm run dev', cwd: '/repo' })
  assert(prompt.includes('`web` process (`npm run dev`') && prompt.includes('- /repo/src/server.ts:41:11'), `prompt context:\n${prompt}`)
  assert(!prompt.includes('- /repo/node_modules'), 'dependency frames are not listed as the project\'s')
  assert(prompt.includes('Error: boom\n    at handler'), 'the trace is in the prompt verbatim')
  console.log('Traces: Node, Python, Go, tsc; the newest wins; the message line is kept; own frames first.')
}

assert(stripAnsi('\x1b[32mready\x1b[0m in \x1b]8;;http://x\x07link\x1b]8;;\x07') === 'ready in link', 'ANSI not stripped')

const workspace = await realpath(await mkdtemp(join(tmpdir(), 'agent-viewer-process-pane-')))
try {
  // ── Config: declared beats suggested; suggestions follow the lockfile ──────
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { dev: 'x', build: 'y' } }))
  await writeFile(join(workspace, 'pnpm-lock.yaml'), '')
  const suggested = await readProcessConfig(workspace)
  assert(suggested.source === null && suggested.definitions.map((entry) => entry.command).join() === 'pnpm dev', `suggestions: ${JSON.stringify(suggested.definitions)}`)
  await mkdir(join(workspace, '.agent-viewer'))
  await writeFile(join(workspace, '.agent-viewer', 'processes.json'), '{ // mine\n "processes": [{ "name": "api", "command": "make api", "cwd": "svc" },],\n}')
  const declared = await readProcessConfig(workspace)
  assert(declared.definitions.length === 1 && declared.definitions[0]!.cwd === join(workspace, 'svc') && declared.definitions[0]!.declared, `declared: ${JSON.stringify(declared)}`)
  console.log('processes.json is read leniently and replaces the suggestions.')

  // ── Stopping signals the whole group ─────────────────────────────────────
  const grandchild = addProcess({ name: 'group', command: 'sleep 30 & echo "child $!"; wait', cwd: workspace })
  startProcess(grandchild)
  await until(() => getProcesses().find((entry) => entry.id === grandchild)!.lines.some((line) => line.startsWith('child ')), 'the group did not start')
  const childPid = Number(getProcesses().find((entry) => entry.id === grandchild)!.lines.find((line) => line.startsWith('child '))!.slice(6))
  assert(alive(childPid), 'grandchild not running')
  stopProcess(grandchild)
  await until(() => getProcesses().find((entry) => entry.id === grandchild)!.status === 'exited', 'stop did not end the process')
  await until(() => !alive(childPid), `the shell's child ${childPid} outlived a stop`)
  console.log('Stop ends the shell and what it started.')

  // ── Output: carriage returns redraw, ANSI is stripped ────────────────────
  const progress = addProcess({ name: 'progress', command: "printf '10%%\\r50%%\\r100%%\\n\\033[31mred\\033[0m\\n'", cwd: workspace })
  startProcess(progress)
  await until(() => getProcesses().find((entry) => entry.id === progress)!.status !== 'running', 'printf did not finish')
  const out = getProcesses().find((entry) => entry.id === progress)!.lines
  assert(JSON.stringify(out.slice(1)) === JSON.stringify(['100%', 'red', '— exit 0']), `output: ${JSON.stringify(out)}`)
  console.log('A redrawn progress line keeps its last state; colour codes are gone.')
  await resetProcessesForTest()

  // ── The pane ─────────────────────────────────────────────────────────────
  let handleKey: ((key: ProcessPaneKey) => void) | null = null
  let capture: string = 'none'
  // Read through a call: TypeScript narrows a local across awaits, and the pane writes it from a callback.
  const captured = () => capture
  const asks: string[] = []
  const opened: Array<{ path: string; line?: number }> = []
  const notices: string[] = []
  const script = join(workspace, 'serve.sh')
  await writeFile(script, [
    'echo "listening on :3000"',
    `echo "Error: boom"`,
    'echo "    at handler (src/server.ts:41:11)"',
    'while true; do sleep 0.05; echo tick; done',
  ].join('\n'))

  const pane = (
    <ProcessPane
      theme={DARK_THEME}
      width={100}
      height={18}
      focused
      cwd={workspace}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
      onCaptureChange={(value) => { capture = value }}
      onAskAgent={(prompt) => { asks.push(prompt) }}
      onOpenFile={(path, line) => { opened.push({ path, line }) }}
      onNotice={(_, text) => { notices.push(text) }}
    />
  )
  const setup = await testRender(pane, { width: 100, height: 18 })
  const settle = async (ms: number) => {
    const deadline = performance.now() + ms
    while (performance.now() < deadline) await act(async () => { await setup.flush(); await wait(10) })
  }
  const press = async (sequence: string, name = sequence) => {
    act(() => { handleKey?.({ name, ctrl: false, shift: sequence !== sequence.toLowerCase(), sequence }) })
    await settle(120)
  }
  const frame = () => setup.captureCharFrame()
  const locate = (needle: string) => {
    const lines = frame().split('\n')
    for (let y = 0; y < lines.length; y += 1) {
      const x = lines[y]!.indexOf(needle)
      if (x >= 0) return { x, y }
    }
    throw new Error(`could not find ${JSON.stringify(needle)}:\n${frame()}`)
  }

  try {
    await settle(300)
    assert(frame().includes('api'), `the declared process is not listed:\n${frame()}`)

    await press('n')
    assert(captured() === 'input', 'n did not open the command input')
    await act(async () => { await setup.mockInput.typeText(`sh ${script}`) })
    await settle(80)
    act(() => { setup.mockInput.pressEnter() })
    await settle(400)
    assert(captured() === 'none', 'running a command left the input open')
    await settle(300)
    if (process.env.DUMP_FRAME) console.log(frame())
    assert(frame().includes('tick') && frame().includes('running'), `the command is not running in the pane:\n${frame()}`)
    console.log('n runs a command, and its output streams into the pane.')

    // Scrolled back, new output must not drag the view.
    await until(() => (getProcesses().find((entry) => entry.command === `sh ${script}`)?.lines.length ?? 0) > 40, 'not enough output to scroll')
    await settle(150)
    await press('k', 'k')
    await press('k', 'k')
    const anchored = frame().split('\n').slice(1, 4).join('\n')
    await settle(400)
    assert(frame().split('\n').slice(1, 4).join('\n') === anchored, `a scrolled-back view moved with new output:\n${anchored}\n---\n${frame()}`)
    await press('G')
    console.log('A scrolled-back log holds still while output arrives; G follows again.')

    await press('e')
    assert(asks.length === 1, `e sent ${asks.length} prompts (${notices.join(' | ')})`)
    assert(asks[0]!.includes('Error: boom') && asks[0]!.includes('- src/server.ts:41:11'), `prompt:\n${asks[0]}`)
    assert(frame().includes('Error: boom'), 'the trace was not scrolled into view')
    const link = locate('server.ts:41')
    const url = (setup.renderer as unknown as { getLinkAt(x: number, y: number): string | null }).getLinkAt(link.x, link.y)
    assert(url === `file://${workspace}/src/server.ts#L41`, `the frame is not a file link: ${url}`)
    await act(async () => { await setup.mockMouse.click(link.x + 1, link.y) })
    await settle(100)
    assert(opened.length === 1 && opened[0]!.path === `${workspace}/src/server.ts` && opened[0]!.line === 41, `click opened ${JSON.stringify(opened)}`)
    console.log('e hands the newest trace to an agent; its file:line opens the editor.')

    const running = getProcesses().find((entry) => entry.command === `sh ${script}`)!
    assert(running.status === 'running', 'the server stopped early')
    act(() => setup.renderer.destroy())
    await wait(300)
    assert(getProcesses().find((entry) => entry.id === running.id)?.status === 'running', 'closing the view killed the process')
    console.log('The process keeps running after its view is gone.')
  } finally {
    try { act(() => setup.renderer.destroy()) } catch { /* already */ }
  }
  console.log('Process pane smoke passed')
} finally {
  await resetProcessesForTest()
  await rm(workspace, { recursive: true, force: true })
}
