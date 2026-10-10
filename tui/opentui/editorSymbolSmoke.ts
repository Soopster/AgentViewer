import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EditorLspClient, type EditorSymbol } from './editorLsp'
import { disposeAllLspSessions } from './editorLspSession'

// `textDocument/documentSymbol` has two legal response shapes and the server
// picks. A client that understands only one gets an empty outline from half the
// servers in the table — and an empty outline is indistinguishable from a file
// with no symbols, so it reads as "this feature does not work here" rather than
// as a bug. Both shapes are pinned here, against one server that answers
// hierarchically (gopls, rust-analyzer, tsserver) and one that answers flat
// (older servers, and several of the vscode-* family).

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-symbols-'))
const sourcePath = join(cwd, 'main.ts')

function serverSource(shape: 'hierarchical' | 'flat'): string {
  const hierarchical = `[
    { name: 'Widget', kind: 5, range: RANGE(0), selectionRange: RANGE(0), children: [
      { name: 'render', kind: 6, detail: '(): void', range: RANGE(1), selectionRange: RANGE(1), children: [
        { name: 'inner', kind: 12, range: RANGE(2), selectionRange: RANGE(2) }
      ] }
    ] },
    { name: 'helper', kind: 12, range: RANGE(3), selectionRange: RANGE(3) }
  ]`
  const flat = `[
    { name: 'Widget', kind: 5, location: { uri: DOC_URI, range: RANGE(0) } },
    { name: 'render', kind: 6, containerName: 'Widget', location: { uri: DOC_URI, range: RANGE(1) } },
    { name: 'helper', kind: 12, location: { uri: DOC_URI, range: RANGE(3) } }
  ]`
  return String.raw`
let input = Buffer.alloc(0)
let documentUri = ''
function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body)
}
const RANGE = (line) => ({ start: { line, character: 0 }, end: { line, character: 8 } })
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
    if (message.method === 'initialize') {
      const capabilities = message.params.capabilities.textDocument
      if (capabilities.documentSymbol?.hierarchicalDocumentSymbolSupport !== true) process.exit(31)
      if (!message.params.capabilities.workspace.symbol) process.exit(32)
      send({ jsonrpc: '2.0', id: message.id, result: { capabilities: {
        documentSymbolProvider: true, workspaceSymbolProvider: true,
      } } })
    }
    if (message.method === 'textDocument/didOpen') documentUri = message.params.textDocument.uri
    const DOC_URI = documentUri
    if (message.method === 'textDocument/documentSymbol') {
      send({ jsonrpc: '2.0', id: message.id, result: ${shape === 'hierarchical' ? hierarchical : flat} })
    }
    if (message.method === 'workspace/symbol') {
      // Answer only what the query asks for, so an unfiltered request is visible.
      const all = [
        { name: 'Widget', kind: 5, containerName: 'widget.ts', location: { uri: 'file:///elsewhere/widget.ts', range: RANGE(9) } },
        { name: 'helper', kind: 12, location: { uri: 'file:///elsewhere/util.ts', range: RANGE(4) } },
      ]
      send({ jsonrpc: '2.0', id: message.id, result: all.filter((entry) => entry.name.includes(message.params.query)) })
    }
  }
})
`
}

async function symbolsFrom(shape: 'hierarchical' | 'flat'): Promise<{
  document: EditorSymbol[]
  workspace: EditorSymbol[]
  empty: EditorSymbol[]
}> {
  const serverPath = join(cwd, `${shape}-lsp.mjs`)
  await writeFile(serverPath, serverSource(shape), 'utf8')
  const client = new EditorLspClient(cwd, 'typescript', sourcePath, [
    { command: process.execPath, args: [serverPath], name: `${shape}-lsp` },
  ])
  try {
    assert(await client.start('class Widget {}\n'), `${shape} server did not start`)
    return {
      document: await client.documentSymbols(),
      workspace: await client.workspaceSymbols('Widget'),
      empty: await client.workspaceSymbols('   '),
    }
  } finally {
    client.stop()
    disposeAllLspSessions()
  }
}

try {
  await writeFile(sourcePath, 'class Widget {}\n', 'utf8')

  const hierarchical = await symbolsFrom('hierarchical')
  assert(hierarchical.document.length === 4,
    `A hierarchical outline must be flattened whole: ${JSON.stringify(hierarchical.document.map((s) => s.name))}`)
  const [widget, render, inner, helper] = hierarchical.document
  assert(widget?.name === 'Widget' && widget.depth === 0, `Top-level symbol wrong: ${JSON.stringify(widget)}`)
  assert(render?.name === 'render' && render.depth === 1 && render.container === 'Widget' && render.detail === '(): void',
    `A nested symbol must carry its depth, container and detail: ${JSON.stringify(render)}`)
  assert(inner?.name === 'inner' && inner.depth === 2 && inner.container === 'render',
    `Nesting must go deeper than one level: ${JSON.stringify(inner)}`)
  assert(helper?.name === 'helper' && helper.depth === 0,
    `A sibling after a nested tree must return to depth 0: ${JSON.stringify(helper)}`)
  // selectionRange, not range: jumping to a class must land on its name, not on
  // the first line of a body that may be hundreds of lines long.
  assert(render.range.start.line === 1, `A symbol must use its selectionRange: ${JSON.stringify(render.range)}`)
  assert(widget.uri.endsWith('/main.ts'), `A hierarchical symbol must inherit the document uri: ${widget.uri}`)

  const flat = await symbolsFrom('flat')
  assert(flat.document.length === 3,
    `A flat SymbolInformation[] response must also produce an outline: ${JSON.stringify(flat.document)}`)
  assert(flat.document[1]?.name === 'render' && flat.document[1].container === 'Widget',
    `A flat response's containerName must survive: ${JSON.stringify(flat.document[1])}`)
  assert(flat.document.every((symbol) => symbol.range.start.character === 0 && symbol.uri.endsWith('/main.ts')),
    'A flat response must read its position and uri out of `location`')

  for (const shape of [hierarchical, flat]) {
    assert(shape.workspace.length === 1 && shape.workspace[0]?.uri === 'file:///elsewhere/widget.ts',
      `A workspace symbol must keep its own file's uri: ${JSON.stringify(shape.workspace)}`)
    // An empty query makes several servers enumerate the entire workspace.
    assert(shape.empty.length === 0, 'A blank workspace-symbol query must not be sent to the server')
  }

  console.log('Editor LSP symbol smoke passed (hierarchical and flat outlines, workspace symbols)')
} finally {
  disposeAllLspSessions()
  await rm(cwd, { recursive: true, force: true })
}
