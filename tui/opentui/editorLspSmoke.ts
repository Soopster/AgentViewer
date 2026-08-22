import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EditorLspClient, type EditorDiagnostic, type EditorLspStatus } from './editorLsp'

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-lsp-'))
const serverPath = join(cwd, 'fake-lsp.mjs')
const sourcePath = join(cwd, 'main.ts')

const fakeServer = String.raw`
let input = Buffer.alloc(0)
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
    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { completionProvider: {} } } })
    if (message.method === 'textDocument/didOpen') send({
      jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: {
        uri: message.params.textDocument.uri,
        diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 2, source: 'fake-lsp', message: 'smoke warning' }],
      },
    })
    if (message.method === 'textDocument/completion') send({
      jsonrpc: '2.0', id: message.id, result: [{ label: 'answer', kind: 6, detail: 'number', insertText: 'answer' }],
    })
  }
})
`

try {
  await writeFile(serverPath, fakeServer, 'utf8')
  await writeFile(sourcePath, 'const value = ans\n', 'utf8')
  let status: EditorLspStatus | null = null
  let diagnostics: EditorDiagnostic[] = []
  const client = new EditorLspClient(cwd, 'typescript', sourcePath, [
    { command: process.execPath, args: [serverPath], name: 'fake-lsp' },
  ])
  client.onStatus((next) => { status = next })
  client.onDiagnostics((next) => { diagnostics = next })
  try {
    const started = await client.start('const value = ans\n')
    const initializedStatus = status as EditorLspStatus | null
    if (!started || initializedStatus?.state !== 'ready') throw new Error(`Fake LSP did not initialize: ${JSON.stringify(status)}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (diagnostics.length !== 1 || diagnostics[0]?.message !== 'smoke warning') {
      throw new Error(`Fake LSP diagnostic was not delivered: ${JSON.stringify(diagnostics)}`)
    }
    const completions = await client.completion({ line: 0, character: 17 })
    if (completions[0]?.label !== 'answer' || completions[0]?.source !== 'lsp') {
      throw new Error(`Fake LSP completion was not delivered: ${JSON.stringify(completions)}`)
    }
    client.change('const value = answer\n')
    client.saved('const value = answer\n')
    console.log('Editor LSP initialize/diagnostics/completion smoke passed')
  } finally {
    client.stop()
  }
} finally {
  await rm(cwd, { recursive: true, force: true })
}
