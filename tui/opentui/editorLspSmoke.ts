import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EditorLspClient, getEditorLspServerSpecs, type EditorDiagnostic, type EditorLspStatus } from './editorLsp'

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-lsp-'))
const serverPath = join(cwd, 'fake-lsp.mjs')
const slowServerPath = join(cwd, 'slow-lsp.mjs')
const sourcePath = join(cwd, 'main.ts')

const fakeServer = String.raw`
let input = Buffer.alloc(0)
const cancelledRequests = new Set()
function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body)
}
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk])
  while (true) {
    const headerEnd = input.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const header = input.subarray(0, headerEnd).toString('ascii')
    const match = /Content-Length:\s*(\d+)/i.exec(header)
    if (!match) return
    const length = Number(match[1])
    const start = headerEnd + 4
    if (input.length < start + length) return
    const message = JSON.parse(input.subarray(start, start + length).toString('utf8'))
    input = input.subarray(start + length)
    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { completionProvider: { triggerCharacters: ['.'], resolveProvider: true } } } })
    if (message.method === 'textDocument/didOpen') send({
      jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: {
        uri: message.params.textDocument.uri,
        diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 2, source: 'fake-lsp', message: 'smoke warning' }],
      },
    })
    if (message.method === '$/cancelRequest') cancelledRequests.add(message.params.id)
    if (message.method === 'textDocument/completion') {
      const response = {
        jsonrpc: '2.0', id: message.id, result: message.params.position.character === 18
          ? [{ label: 'cancel-observed-' + cancelledRequests.size }]
          : message.params.context.triggerKind === 2 && message.params.context.triggerCharacter === '.' ? {
        isIncomplete: false,
        itemDefaults: {
          editRange: { start: { line: 0, character: 14 }, end: { line: 0, character: 17 } },
          data: { symbolId: 42 },
        },
        items: [{ label: 'answer', kind: 6, filterText: 'answer', sortText: '001', textEditText: 'answer', preselect: true }],
      } : [],
      }
      if (message.params.position.character === 99) {
        setTimeout(() => { if (!cancelledRequests.has(message.id)) send(response) }, 500)
      } else send(response)
    }
    if (message.method === 'completionItem/resolve') send(message.params.label === 'custom-insert'
      ? { jsonrpc: '2.0', id: message.id, result: { label: message.params.label, documentation: 'Resolved docs only.' } }
      : {
          jsonrpc: '2.0', id: message.id, result: {
            ...message.params,
            detail: 'number',
            documentation: { kind: 'markdown', value: '**The answer.**' },
            additionalTextEdits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'import answer\n' }],
          },
        })
    if (message.method === 'textDocument/hover') send({
      jsonrpc: '2.0', id: message.id, result: {
        contents: [{ language: 'typescript', value: 'const answer: number' }, 'The answer.'],
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
      },
    })
    if (message.method === 'textDocument/signatureHelp') send({
      jsonrpc: '2.0', id: message.id, result: {
        signatures: [{
          label: 'add(left: number, right: number): number',
          documentation: 'Adds two numbers.',
          parameters: [{ label: [4, 16] }, { label: 'right: number' }],
        }],
        activeSignature: 0,
        activeParameter: 1,
      },
    })
    if (message.method === 'textDocument/definition') send({
      jsonrpc: '2.0', id: message.id, result: {
        targetUri: message.params.textDocument.uri.replace('main.ts', 'definition.ts'),
        targetRange: { start: { line: 2, character: 0 }, end: { line: 2, character: 12 } },
        targetSelectionRange: { start: { line: 2, character: 6 }, end: { line: 2, character: 12 } },
      },
    })
    if (message.method === 'textDocument/references') send({
      jsonrpc: '2.0', id: message.id, result: [{
        uri: message.params.textDocument.uri,
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
      }],
    })
    if (message.method === 'textDocument/implementation') send({
      jsonrpc: '2.0', id: message.id, result: [{
        uri: message.params.textDocument.uri.replace('main.ts', 'implementation.ts'),
        range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } },
      }],
    })
    if (message.method === 'textDocument/prepareRename') send({
      jsonrpc: '2.0', id: message.id, result: {
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
        placeholder: 'value',
      },
    })
    if (message.method === 'textDocument/rename') send({
      jsonrpc: '2.0', id: message.id, result: {
        documentChanges: [{
          textDocument: { uri: message.params.textDocument.uri, version: 1 },
          edits: [{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } }, newText: message.params.newName }],
        }],
      },
    })
    if (message.method === 'textDocument/formatting') send({
      jsonrpc: '2.0', id: message.id, result: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        newText: 'const',
      }],
    })
    if (message.method === 'textDocument/codeAction') send({
      jsonrpc: '2.0', id: message.id, result: [
        { title: 'Second action', kind: 'quickfix', command: { command: 'fake.fix', arguments: [2] } },
        { title: 'Preferred fix', kind: 'quickfix', isPreferred: true, edit: { changes: {
          [message.params.textDocument.uri]: [{ range: message.params.range, newText: 'fixed' }],
        } } },
      ],
    })
    if (message.method === 'workspace/executeCommand') {
      send({ jsonrpc: '2.0', id: 900, method: 'workspace/applyEdit', params: { edit: { changes: {
        [message.params.arguments[0]]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: '// command edit\n' }],
      } } } })
      send({ jsonrpc: '2.0', id: message.id, result: null })
    }
  }
})
`

try {
  const typescriptServer = getEditorLspServerSpecs('typescript')[0]
  if (!/(^|[/\\])tsc(?:\.exe)?$/.test(typescriptServer?.command ?? '')
    || typescriptServer.args.join(' ') !== '--lsp --stdio'
    || typescriptServer.name !== 'TypeScript 7') {
    throw new Error(`TypeScript files are not configured for the native TypeScript 7 LSP server: ${JSON.stringify(typescriptServer)}`)
  }
  await writeFile(serverPath, fakeServer, 'utf8')
  await writeFile(slowServerPath, 'setInterval(() => {}, 1000)\n', 'utf8')
  await writeFile(sourcePath, 'const value = ans\n', 'utf8')
  let status: EditorLspStatus | null = null
  let diagnostics: EditorDiagnostic[] = []
  const client = new EditorLspClient(cwd, 'typescript', sourcePath, [
    { command: process.execPath, args: [serverPath], name: 'fake-lsp' },
  ])
  client.onStatus((next) => { status = next })
  client.onDiagnostics((next) => { diagnostics = next })
  let appliedCommandEdit = false
  client.onWorkspaceEdit(async (edit) => {
    appliedCommandEdit = edit.changes[0]?.edits[0]?.newText === '// command edit\n'
    return appliedCommandEdit
  })
  try {
    const started = await client.start('const value = ans\n')
    const initializedStatus = status as EditorLspStatus | null
    if (!started || initializedStatus?.state !== 'ready') throw new Error(`Fake LSP did not initialize: ${JSON.stringify(status)}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (diagnostics.length !== 1 || diagnostics[0]?.message !== 'smoke warning') {
      throw new Error(`Fake LSP diagnostic was not delivered: ${JSON.stringify(diagnostics)}`)
    }
    if (!client.isCompletionTriggerCharacter('.') || client.isCompletionTriggerCharacter(':')) {
      throw new Error('Fake LSP completion trigger characters were not retained')
    }
    const completions = await client.completion({ line: 0, character: 17 }, '.')
    const completion = completions[0]
    if (completion?.label !== 'answer' || completion.source !== 'lsp' || completion.preselect !== true
      || completion.textEdit?.range.start.character !== 14 || completion.rawItem?.data == null) {
      throw new Error(`Fake LSP completion was not delivered: ${JSON.stringify(completions)}`)
    }
    const resolvedCompletion = await client.resolveCompletion(completion)
    if (resolvedCompletion.documentation !== '**The answer.**' || resolvedCompletion.detail !== 'number'
      || resolvedCompletion.additionalTextEdits?.[0]?.newText !== 'import answer\n') {
      throw new Error(`Fake LSP completion resolve was not delivered: ${JSON.stringify(resolvedCompletion)}`)
    }
    const partialResolvedCompletion = await client.resolveCompletion({
      ...completion,
      label: 'custom-insert',
      insertText: 'insertedValue',
      textEdit: undefined,
      rawItem: { label: 'custom-insert' },
      resolved: false,
    })
    if (partialResolvedCompletion.insertText !== 'insertedValue' || partialResolvedCompletion.documentation !== 'Resolved docs only.') {
      throw new Error(`Documentation-only completion resolve changed insertion semantics: ${JSON.stringify(partialResolvedCompletion)}`)
    }
    const completionController = new AbortController()
    const cancellationStarted = performance.now()
    const cancelledCompletionPromise = client.completion({ line: 0, character: 99 }, undefined, completionController.signal)
    setTimeout(() => completionController.abort(), 25)
    const cancelledCompletions = await cancelledCompletionPromise
    const cancellationElapsed = performance.now() - cancellationStarted
    if (cancelledCompletions.length !== 0 || cancellationElapsed >= 400) {
      throw new Error(`Cancelled completion did not settle promptly: ${JSON.stringify({ cancelledCompletions, cancellationElapsed })}`)
    }
    const cancellationProof = await client.completion({ line: 0, character: 18 })
    if (cancellationProof[0]?.label !== 'cancel-observed-1') {
      throw new Error(`Completion cancellation was not forwarded to the language server: ${JSON.stringify(cancellationProof)}`)
    }
    const hover = await client.hover({ line: 0, character: 8 })
    if (!hover?.contents.includes('const answer') || hover.range?.start.character !== 6) {
      throw new Error(`Fake LSP hover was not delivered: ${JSON.stringify(hover)}`)
    }
    const signature = await client.signatureHelp({ line: 0, character: 17 }, '(')
    if (signature?.label !== 'add(left: number, right: number): number' || signature.activeParameter !== 1 || signature.parameters[0] !== 'left: number') {
      throw new Error(`Fake LSP signature help was not delivered: ${JSON.stringify(signature)}`)
    }
    const definitions = await client.definition({ line: 0, character: 8 })
    if (definitions.length !== 1 || !definitions[0]?.uri.endsWith('/definition.ts')
      || definitions[0].range.start.line !== 2 || definitions[0].range.start.character !== 6) {
      throw new Error(`Fake LSP definition location was not delivered: ${JSON.stringify(definitions)}`)
    }
    const references = await client.references({ line: 0, character: 8 })
    if (references.length !== 1 || references[0]?.range.start.character !== 6) {
      throw new Error(`Fake LSP reference location was not delivered: ${JSON.stringify(references)}`)
    }
    const implementations = await client.implementation({ line: 0, character: 8 })
    if (implementations.length !== 1 || !implementations[0]?.uri.endsWith('/implementation.ts')
      || implementations[0].range.start.line !== 4) {
      throw new Error(`Fake LSP implementation location was not delivered: ${JSON.stringify(implementations)}`)
    }
    const preparedRename = await client.prepareRename({ line: 0, character: 8 })
    if (preparedRename?.placeholder !== 'value' || preparedRename.range.start.character !== 6) {
      throw new Error(`Fake LSP prepare rename was not delivered: ${JSON.stringify(preparedRename)}`)
    }
    const rename = await client.rename({ line: 0, character: 8 }, 'renamedValue')
    if (rename?.changes[0]?.edits[0]?.newText !== 'renamedValue') {
      throw new Error(`Fake LSP workspace rename edit was not normalized: ${JSON.stringify(rename)}`)
    }
    const formatting = await client.formatting()
    if (formatting?.changes[0]?.edits[0]?.newText !== 'const') {
      throw new Error(`Fake LSP formatting edits were not delivered: ${JSON.stringify(formatting)}`)
    }
    const actions = await client.codeActions({
      start: { line: 0, character: 6 },
      end: { line: 0, character: 11 },
    }, diagnostics)
    if (actions[0]?.title !== 'Preferred fix' || actions[0].edit?.changes[0]?.edits[0]?.newText !== 'fixed'
      || actions[1]?.command?.command !== 'fake.fix') {
      throw new Error(`Fake LSP code actions were not normalized and preferred-first: ${JSON.stringify(actions)}`)
    }
    await client.executeCommand({ command: 'fake.fix', arguments: [sourcePath.startsWith('/') ? `file://${sourcePath}` : sourcePath] })
    await new Promise((resolve) => setTimeout(resolve, 30))
    if (!appliedCommandEdit) throw new Error('Server-initiated workspace/applyEdit was not acknowledged and applied')
    client.change('const value = answer\n')
    client.saved('const value = answer\n')
    console.log('Editor LSP completion/navigation/rename/format/code-action/workspace-edit smoke passed')
  } finally {
    client.stop()
  }

  let slowStatus: EditorLspStatus | null = null
  const slowClient = new EditorLspClient(cwd, 'typescript', sourcePath, [
    { command: process.execPath, args: [slowServerPath], name: 'slow-lsp' },
  ])
  slowClient.onStatus((next) => { slowStatus = next })
  const slowStart = slowClient.start('const value = 1\n')
  await new Promise((resolve) => setTimeout(resolve, 25))
  slowClient.stop()
  if (await slowStart || (slowStatus as EditorLspStatus | null)?.state === 'error') {
    throw new Error(`Stopping an initializing LSP leaked a stale error: ${JSON.stringify(slowStatus)}`)
  }

  const nativeSource = 'const broken: string = 1\nMath.\n'
  await writeFile(sourcePath, nativeSource, 'utf8')
  let nativeStatus: EditorLspStatus | null = null
  let nativeDiagnostics: EditorDiagnostic[] = []
  const nativeClient = new EditorLspClient(cwd, 'typescript', sourcePath)
  nativeClient.onStatus((next) => { nativeStatus = next })
  nativeClient.onDiagnostics((next) => { nativeDiagnostics = next })
  try {
    const started = await nativeClient.start(nativeSource)
    await new Promise((resolve) => setTimeout(resolve, 300))
    const completions = await nativeClient.completion({ line: 1, character: 5 }, '.')
    const hover = await nativeClient.hover({ line: 1, character: 1 })
    if (!started || (nativeStatus as EditorLspStatus | null)?.state !== 'ready'
      || !completions.some((item) => item.label === 'abs')
      || !hover?.contents.includes('Math')
      || !nativeDiagnostics.some((diagnostic) => diagnostic.message.includes("not assignable to type 'string'"))) {
      throw new Error(`Native TypeScript 7 LSP did not provide real language features: ${JSON.stringify({ nativeStatus, nativeDiagnostics, completionCount: completions.length, hover })}`)
    }
  } finally {
    nativeClient.stop()
  }
  console.log('Editor real TypeScript 7 LSP startup/completion/hover/diagnostics/shutdown smoke passed')
} finally {
  await rm(cwd, { recursive: true, force: true })
}
