/** @jsxImportSource @opentui/react */
// Asking an agent about a selection: the prompt it builds, and the lines the
// editor claims for it.
//
// Both halves fail silently. A prompt whose fence a backtick in the code can
// close renders as plausible markdown with the code spilling into prose; a
// selection that ends at the start of a line and claims that line too names a
// range one longer than what was selected — the agent then edits a line the
// user never pointed at.
import React from 'react'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRenderWithSyntaxStyle, act } from './testRender'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorAskRequest, type EditorKeyEvent } from './EditorPopover'
import { buildSelectionAskPrompt, codeFenceFor } from '../../lib/selectionAsk'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// ── The prompt ──────────────────────────────────────────────────────────────
{
  const code = 'const fence = "```"\nreturn fence'
  const prompt = buildSelectionAskPrompt({ intent: 'explain', filePath: 'lib/a.ts', startLine: 3, endLine: 4, code, language: 'typescript' })
  const fence = codeFenceFor(code)
  assert(fence === '````', `fence must outrun the code's longest backtick run, got ${fence}`)
  assert(prompt.includes(`${fence}typescript\n${code}\n${fence}`), `code is not fenced intact:\n${prompt}`)
  assert(prompt.includes('Lines: L3-L4'), `range missing:\n${prompt}`)
  assert(prompt.startsWith('Explain'), 'the instruction leads the prompt')
  console.log('A backtick run in the code cannot close its fence.')

  const ask = buildSelectionAskPrompt({ intent: 'ask', filePath: 'a.ts', startLine: 1, endLine: 1, code: 'x' })
  assert(ask.endsWith('Question: '), `a free question must end where the user types:\n${JSON.stringify(ask.slice(-30))}`)
  console.log('A free question puts the cursor after the context.')

  const why = buildSelectionAskPrompt({ intent: 'why', filePath: 'a.ts', startLine: 1, endLine: 2, code: 'x', history: [] })
  assert(why.includes('No recorded agent turn or commit wrote these lines.'), `an empty history must say so:\n${why}`)
  const withHistory = buildSelectionAskPrompt({
    intent: 'why', filePath: 'a.ts', startLine: 1, endLine: 2, code: 'x',
    history: [{ startLine: 1, endLine: 2, source: 'claude session 1234abcd', text: 'make it\n  faster', timestampMs: Date.UTC(2026, 9, 1, 12, 30) }],
  })
  assert(withHistory.includes('- L1-L2: claude session 1234abcd (2026-10-01 12:30) — "make it faster"'), `history entry malformed:\n${withHistory}`)
  console.log('"Why" names who wrote the lines, or says nobody recorded did.')
}

// ── The editor ──────────────────────────────────────────────────────────────
const workspace = await mkdtemp(join(tmpdir(), 'agent-viewer-selection-ask-'))
const sourcePath = join(workspace, 'notes.txt')
let handleKey: ((key: EditorKeyEvent) => boolean) | null = null
const requests: EditorAskRequest[] = []
let closes = 0
let syntaxStyle!: SyntaxStyle

try {
  await writeFile(sourcePath, 'alpha\nbravo\ncharlie\ndelta\necho\n', 'utf8')
  const setup = await testRenderWithSyntaxStyle({ default: { fg: RGBA.fromHex(DARK_THEME.text) } }, (style) => {
    syntaxStyle = style
    return (
      <EditorPopover
        cwd={workspace}
        initialPath={sourcePath}
        theme={DARK_THEME}
        width={110}
        height={30}
        syntaxStyle={style}
        onClose={() => { closes += 1 }}
        onKeyHandlerReady={(handler) => { handleKey = handler }}
        onAskAgent={(request) => { requests.push(request); return true }}
      />
    )
  }, { width: 110, height: 30 })
  const settle = async (durationMs: number) => {
    const deadline = performance.now() + durationMs
    while (performance.now() < deadline) {
      await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 8)) })
    }
  }
  const press = async (key: Partial<EditorKeyEvent> & { name: string }) => {
    act(() => { handleKey?.({ ctrl: false, shift: false, sequence: '', ...key }) })
    await settle(150)
  }

  try {
    await settle(800)
    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    assert(editor && handleKey, 'the editor did not mount')

    // "bravo\ncharlie\n": the selection ends at the start of line 4, which it does not claim.
    act(() => { editor.focus(); editor.setSelection(6, 20) })
    await settle(200)
    await press({ name: 'a', ctrl: true, sequence: '\x01' })
    assert(setup.captureCharFrame().includes('h history'), `^A did not show the ask keys:\n${setup.captureCharFrame()}`)
    await press({ name: 'return', sequence: '\r' })
    const frame = setup.captureCharFrame()
    for (const label of ['Agent: Explain', 'Agent: Why? (History)', 'Agent: Write Tests', 'Agent: File History']) {
      assert(frame.includes(label), `^A ⏎ did not list "${label}":\n${frame}`)
    }
    console.log('^A ⏎ opens the palette on the Agent commands.')
    await press({ name: 'return', sequence: '\r' })
    assert(requests.length === 1, `choosing an Agent command sent ${requests.length} requests`)
    const [first] = requests
    assert(first!.startLine === 2 && first!.endLine === 3, `selection claimed L${first!.startLine}-L${first!.endLine}, expected L2-L3`)
    assert(first!.code === 'bravo\ncharlie\n', `selection code was ${JSON.stringify(first!.code)}`)
    assert(first!.path === 'notes.txt' && first!.unsaved === false, `path/unsaved wrong: ${JSON.stringify(first)}`)
    assert(closes === 1, 'the editor did not close for the composer with nothing unsaved')
    console.log('A selection ending at a line start does not claim that line, and the editor makes way.')

    // No selection: the caret's whole line, and unsaved buffers keep the editor open.
    act(() => { editor.clearSelection(); editor.replaceText('alpha\nbravo\ncharlie\nDELTA\necho\n'); editor.setCursor(3, 2) })
    await settle(300)
    await press({ name: 'a', ctrl: true, sequence: '\x01' })
    await press({ name: 'e', sequence: 'e' })
    const second = requests[1]
    assert(second, 'the caret-line ask sent nothing')
    assert(second.startLine === 4 && second.endLine === 4 && second.code === 'DELTA', `caret ask was ${JSON.stringify(second)}`)
    assert(second.unsaved === true, 'an edited buffer was not reported as unsaved')
    assert(closes === 1, 'the editor closed over an unsaved buffer')
    console.log('With nothing selected the caret line goes, and an unsaved buffer keeps the editor open.')
    console.log('Selection ask smoke passed')
  } finally {
    act(() => setup.renderer.destroy())
  }
} finally {
  syntaxStyle?.destroy()
  await rm(workspace, { recursive: true, force: true })
}
