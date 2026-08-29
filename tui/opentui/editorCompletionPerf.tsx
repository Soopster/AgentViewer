/** @jsxImportSource @opentui/react */
// Deterministic input-to-menu benchmark for the project editor. It uses the
// real EditorPopover and LSP transport against an immediate local fake server,
// so the result includes the 160ms automatic-completion debounce, request,
// React commit, and terminal render.
import React, { act } from 'react'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'

const SAMPLE_COUNT = 6
const P95_BUDGET_MS = Number.parseInt(process.env.EDITOR_COMPLETION_P95_BUDGET_MS ?? '', 10) || 400
const workspace = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-completion-perf-'))
const sourcePath = join(workspace, 'main.ts')
const serverPath = join(workspace, 'tsc')
const originalServer = process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
let handleKey: ((key: EditorKeyEvent) => boolean) | null = null

const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex(DARK_THEME.violet), bold: true },
  default: { fg: RGBA.fromHex(DARK_THEME.text) },
})

async function settle(setup: Awaited<ReturnType<typeof testRender>>, durationMs: number): Promise<void> {
  const deadline = performance.now() + durationMs
  while (performance.now() < deadline) {
    await act(async () => {
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 8))
    })
  }
}

try {
  await writeFile(serverPath, String.raw`#!/usr/bin/env node
let input = Buffer.alloc(0)
let documentText = ''
function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body)
}
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk])
  while (true) {
    const headerEnd = input.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const match = /Content-Length:\s*(\d+)/i.exec(input.subarray(0, headerEnd).toString('ascii'))
    if (!match) return
    const length = Number(match[1])
    const start = headerEnd + 4
    if (input.length < start + length) return
    const message = JSON.parse(input.subarray(start, start + length).toString('utf8'))
    input = input.subarray(start + length)
    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { completionProvider: { resolveProvider: true } } } })
    if (message.method === 'textDocument/didOpen') documentText = message.params.textDocument.text
    if (message.method === 'textDocument/didChange') documentText = message.params.contentChanges[0].text
    if (message.method === 'textDocument/completion') {
      const position = message.params.position
      const line = (documentText.split('\n')[position.line] || '').slice(0, position.character)
      const prefix = /[A-Za-z_$][\w$]*$/.exec(line)?.[0] || ''
      const labels = prefix === 'short' ? ['shortOne', 'shortTwo', 'shortThree'] : ['sampleCompletion']
      send({ jsonrpc: '2.0', id: message.id, result: labels.map((label, index) => ({
        label, kind: 2, preselect: index === 0, sortText: String(index).padStart(3, '0'),
        detail: label === 'shortTwo' ? 'DETAIL_SHORT_TWO' : 'number',
        textEdit: { range: { start: { line: position.line, character: position.character - prefix.length }, end: position }, newText: label },
      })) })
    }
    if (message.method === 'completionItem/resolve') {
      setTimeout(() => send({ jsonrpc: '2.0', id: message.id, result: {
        ...message.params,
        additionalTextEdits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: '// resolved completion\n' }],
      } }), 25)
    }
  }
})
`, 'utf8')
  await chmod(serverPath, 0o755)
  await writeFile(sourcePath, 'const seed = 0\n', 'utf8')
  process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = serverPath

  const setup = await testRender(
    <EditorPopover
      cwd={workspace}
      initialPath={sourcePath}
      theme={DARK_THEME}
      width={100}
      height={30}
      syntaxStyle={syntaxStyle}
      onClose={() => {}}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
    />,
    { width: 100, height: 30 },
  )

  try {
    await settle(setup, 700)
    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (!editor || !handleKey) throw new Error('Editor completion benchmark did not mount the real editor')

    act(() => { editor.gotoBufferEnd() })
    await act(async () => { await setup.mockInput.typeText('short') })
    const layoutDeadline = performance.now() + 700
    while (performance.now() < layoutDeadline && !setup.captureCharFrame().includes('completions 1/3')) {
      await settle(setup, 8)
    }
    act(() => { handleKey?.({ name: 'down', ctrl: false, shift: false, sequence: '\u001b[B' }) })
    await settle(setup, 40)
    const layoutFrame = setup.captureCharFrame()
    const layoutLines = setup.captureSpans().lines
    const cyan = RGBA.fromHex(DARK_THEME.cyan).toString()
    const amber = RGBA.fromHex(DARK_THEME.amber).toString()
    const detailLabelRow = layoutLines.findIndex((line) => line.spans.some((span) => (
      span.text.includes('shortTwo') && span.fg.toString() === cyan
    )))
    const detailSignatureRow = layoutLines.findIndex((line) => line.spans.some((span) => (
      span.text.includes('DETAIL_SHORT_TWO') && span.fg.toString() === amber
    )))
    if (!layoutFrame.includes('completions 2/3')
      || detailLabelRow < 0 || detailSignatureRow < 0 || detailLabelRow === detailSignatureRow) {
      throw new Error(`Completion detail pane overlapped its label and signature:\n${layoutFrame}`)
    }
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    await setup.flush()

    const latencies: number[] = []
    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      act(() => {
        editor.replaceText(`const seed = ${sample}\n`)
        editor.gotoBufferEnd()
      })
      await settle(setup, 40)
      const startedAt = performance.now()
      await act(async () => { await setup.mockInput.typeText('smp') })
      const deadline = startedAt + P95_BUDGET_MS + 300
      while (performance.now() < deadline && !setup.captureCharFrame().includes('sampleCompletion')) {
        await settle(setup, 8)
      }
      if (!setup.captureCharFrame().includes('sampleCompletion')) {
        throw new Error(`Autocomplete sample ${sample + 1} did not render a completion menu:\n${setup.captureCharFrame()}`)
      }
      latencies.push(performance.now() - startedAt)

      if (sample === 0) {
        act(() => { handleKey?.({ name: 'tab', ctrl: false, shift: false, sequence: '\t' }) })
        const acceptanceDeadline = performance.now() + 500
        while (performance.now() < acceptanceDeadline
          && (!editor.plainText.includes('// resolved completion') || !editor.plainText.includes('sampleCompletion'))) {
          await settle(setup, 8)
        }
        if (!editor.plainText.includes('// resolved completion') || !editor.plainText.includes('sampleCompletion')) {
          throw new Error('Immediate completion acceptance lost resolve-time additional edits')
        }
      } else {
        act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
        await setup.flush()
      }
    }

    const sorted = [...latencies].sort((left, right) => left - right)
    const p50 = sorted[Math.ceil(sorted.length * 0.5) - 1]!
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!
    if (p95 > P95_BUDGET_MS) {
      throw new Error(`Editor autocomplete p95 ${p95.toFixed(1)}ms exceeded ${P95_BUDGET_MS}ms budget: ${JSON.stringify(latencies)}`)
    }
    console.log('Completion detail label and signature rendered on distinct rows.')
    console.log(`Editor autocomplete latency p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms (${latencies.length} samples, budget=${P95_BUDGET_MS}ms)`)
    console.log('Immediate acceptance retained resolve-time completion edits.')
  } finally {
    act(() => setup.renderer.destroy())
  }
} finally {
  if (originalServer == null) delete process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
  else process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = originalServer
  syntaxStyle.destroy()
  await rm(workspace, { recursive: true, force: true })
}
