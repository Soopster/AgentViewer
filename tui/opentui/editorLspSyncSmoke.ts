// Incremental didChange has no failure mode that shows up as an error. If the
// range is wrong, the server's copy of the document silently diverges from the
// editor's and every completion, diagnostic, hover and rename after that is
// computed against a file nobody is looking at — with the editor showing
// plausible, wrong answers.
//
// So this covers it twice: a randomised property check that a conforming
// server's reconstruction always equals the editor's text, and an end-to-end
// run of the real client against a server that advertises incremental sync,
// rebuilds the document from the ranges it receives, and is asked to report
// what it ended up holding.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EditorLspClient } from './editorLsp'
import {
  applyLspContentChange,
  LSP_SYNC_FULL,
  LSP_SYNC_INCREMENTAL,
  LSP_SYNC_NONE,
  lspContentChanges,
  lspSyncKind,
} from './editorLspSync'

// --- capability parsing -----------------------------------------------------

if (lspSyncKind(2) !== LSP_SYNC_INCREMENTAL) throw new Error('A bare sync kind must be read as itself')
if (lspSyncKind({ openClose: true, change: 2 }) !== LSP_SYNC_INCREMENTAL) throw new Error('Sync options must be read through `change`')
if (lspSyncKind({ openClose: true, change: 1 }) !== LSP_SYNC_FULL) throw new Error('A server asking for full documents must get them')
if (lspSyncKind(0) !== LSP_SYNC_NONE) throw new Error('A server asking for no sync must be believed')
// A server that says nothing keeps the behaviour this client had before it
// read the capability at all.
if (lspSyncKind(undefined) !== LSP_SYNC_FULL) throw new Error('A silent server must default to full documents')
if (lspSyncKind({ openClose: true }) !== LSP_SYNC_FULL) throw new Error('Sync options without `change` must default to full documents')
if (lspContentChanges('a', 'b', LSP_SYNC_NONE).length !== 0) throw new Error('No-sync must produce no changes')
console.log('Server sync capability is read from the handshake, in both spellings.')

// --- the reconstruction property --------------------------------------------

const SEED_DOCUMENTS = [
  'const alpha = 1\nconst bravo = 2\nconst charlie = 3\n',
  'line\n',
  '',
  // Astral characters, so a range boundary has surrogate pairs to land inside.
  'const emoji = "🙂🚀🙂"\nconst tail = 1\n',
  `${Array.from({ length: 400 }, (_, index) => `export const value${index} = ${index}`).join('\n')}\n`,
]

// A deterministic generator: a failure has to be reproducible to be fixable.
let seed = 0x2f6e2b1
function random(): number {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return Math.abs(seed) / 0x7fffffff
}
function randomInt(bound: number): number {
  return bound <= 0 ? 0 : Math.min(bound - 1, Math.floor(random() * bound))
}

const INSERTIONS = ['x', 'const ', '\n', '\n\n  ', '🙂', 'ab\ncd', '  // note\n', '🚀🙂']

let editCount = 0
for (const seedDocument of SEED_DOCUMENTS) {
  // `server` mirrors what a conforming server holds; `editor` is the truth.
  let editor = seedDocument
  let server = seedDocument
  for (let step = 0; step < 300; step += 1) {
    const previous = editor
    const kind = randomInt(5)
    if (kind === 0 || editor.length === 0) {
      const at = randomInt(editor.length + 1)
      editor = `${editor.slice(0, at)}${INSERTIONS[randomInt(INSERTIONS.length)]}${editor.slice(at)}`
    } else if (kind === 1) {
      const at = randomInt(editor.length)
      editor = `${editor.slice(0, at)}${editor.slice(at + 1 + randomInt(8))}`
    } else if (kind === 2) {
      // A replacement spanning lines, standing in for a paste or a formatter.
      const at = randomInt(editor.length)
      const end = at + randomInt(Math.max(1, editor.length - at))
      editor = `${editor.slice(0, at)}${INSERTIONS[randomInt(INSERTIONS.length)]}${editor.slice(end)}`
    } else if (kind === 3) {
      editor = editor.toUpperCase() === editor ? editor.toLowerCase() : editor.toUpperCase()
    } else {
      const at = randomInt(editor.length + 1)
      editor = `${editor.slice(0, at)}x${editor.slice(at)}`
    }

    for (const change of lspContentChanges(previous, editor, LSP_SYNC_INCREMENTAL)) {
      if ('range' in change) {
        const { start, end } = change.range
        if (start.line > end.line || (start.line === end.line && start.character > end.character)) {
          throw new Error(`Produced an inverted range: ${JSON.stringify(change.range)}`)
        }
      }
      server = applyLspContentChange(server, change)
    }
    editCount += 1
    if (server !== editor) {
      throw new Error(
        `A server rebuilding from incremental changes diverged from the editor after edit ${editCount}.\n`
        + `  before: ${JSON.stringify(previous.slice(0, 120))}\n`
        + `  editor: ${JSON.stringify(editor.slice(0, 120))}\n`
        + `  server: ${JSON.stringify(server.slice(0, 120))}`,
      )
    }
  }
}
console.log(`A conforming server's document matches the editor's across ${editCount} randomised edits.`)

// A lone surrogate must never be sent: half a character is unrecoverable.
for (const [before, after] of [
  ['🙂🚀', '🙂'],
  ['🙂', '🙂🙂'],
  ['a🙂b', 'a🚀b'],
  ['🙂', ''],
] as const) {
  for (const change of lspContentChanges(before, after, LSP_SYNC_INCREMENTAL)) {
    if (!('range' in change)) continue
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(change.text)) {
      throw new Error(`Change text split a surrogate pair: ${JSON.stringify(change.text)}`)
    }
  }
}
console.log('Edits around astral characters never send half a surrogate pair.')

// --- end to end against a real client ---------------------------------------

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-lsp-sync-'))
try {
  const serverPath = join(cwd, 'fake-lsp.mjs')
  const sourcePath = join(cwd, 'main.ts')
  // The server rebuilds the document from whatever changes it is sent, and
  // hands its own copy back as a completion label. If the client's ranges are
  // wrong, the label will not match what the editor holds.
  const serverSource = String.raw`
let input = Buffer.alloc(0)
let document = ''
let sawFullDocument = false
function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body)
}
function offsetOf(text, position) {
  let line = 0
  let index = 0
  while (line < position.line && index < text.length) {
    if (text.charCodeAt(index) === 10) line += 1
    index += 1
  }
  return Math.min(text.length, index + position.character)
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
    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: { capabilities: {
        textDocumentSync: { openClose: true, change: 2 },
        completionProvider: {},
      } } })
    }
    if (message.method === 'textDocument/didOpen') document = message.params.textDocument.text
    if (message.method === 'textDocument/didChange') {
      for (const change of message.params.contentChanges) {
        if (change.range === undefined) { sawFullDocument = true; document = change.text; continue }
        document = document.slice(0, offsetOf(document, change.range.start))
          + change.text
          + document.slice(offsetOf(document, change.range.end))
      }
    }
    if (message.method === 'textDocument/completion') {
      send({ jsonrpc: '2.0', id: message.id, result: [
        { label: 'DOC:' + document },
        { label: 'FULLDOC:' + sawFullDocument },
      ] })
    }
  }
})
`
  await writeFile(serverPath, serverSource, 'utf8')

  const original = 'const alpha = 1\nconst bravo = 2\nconst charlie = 3\n'
  await writeFile(sourcePath, original, 'utf8')

  const client = new EditorLspClient(cwd, 'typescript', sourcePath, [
    { command: process.execPath, args: [serverPath], name: 'fake-incremental' },
  ])
  try {
    if (!await client.start(original)) throw new Error('Fake incremental server did not start')

    // A sequence a person would actually produce: type mid-file, delete, paste
    // across lines, and edit next to an astral character.
    let document = original
    const steps = [
      document.replace('bravo = 2', 'bravo = 22'),
      document.replace('bravo = 2', 'bravo = 22').replace('const alpha', '// lead\nconst alpha'),
      'const alpha = 1\n',
      'const alpha = 1\nconst emoji = "🙂🚀"\nconst tail = 3\n',
      'const alpha = 1\nconst emoji = "🙂"\nconst tail = 3\n',
    ]
    for (const next of steps) {
      document = next
      client.change(document)
    }

    const completions = await client.completion({ line: 0, character: 0 })
    const documentLabel = completions.find((item) => item.label.startsWith('DOC:'))?.label.slice(4)
    const sawFull = completions.find((item) => item.label.startsWith('FULLDOC:'))?.label.slice(8)
    if (sawFull !== 'false') {
      throw new Error('The client still sent a whole document to a server that asked for incremental sync')
    }
    if (documentLabel !== document) {
      throw new Error(
        'The server\'s document diverged from the editor\'s over a real edit sequence.\n'
        + `  editor: ${JSON.stringify(document)}\n`
        + `  server: ${JSON.stringify(documentLabel)}`,
      )
    }
    console.log('A server advertising incremental sync receives ranges, and rebuilds the editor\'s exact document.')
  } finally {
    client.stop()
  }

  // A server that asks for full documents must still get them.
  const fullServerPath = join(cwd, 'full-lsp.mjs')
  await writeFile(fullServerPath, serverSource.replace('change: 2', 'change: 1'), 'utf8')
  const fullClient = new EditorLspClient(cwd, 'typescript', sourcePath, [
    { command: process.execPath, args: [fullServerPath], name: 'fake-full' },
  ])
  try {
    if (!await fullClient.start(original)) throw new Error('Fake full-sync server did not start')
    const updated = original.replace('bravo = 2', 'bravo = 99')
    fullClient.change(updated)
    const completions = await fullClient.completion({ line: 0, character: 0 })
    const sawFull = completions.find((item) => item.label.startsWith('FULLDOC:'))?.label.slice(8)
    const documentLabel = completions.find((item) => item.label.startsWith('DOC:'))?.label.slice(4)
    if (sawFull !== 'true') throw new Error('A server asking for full documents was sent ranges instead')
    if (documentLabel !== updated) throw new Error('Full sync stopped delivering the document correctly')
    console.log('A server advertising full sync still receives whole documents.')
  } finally {
    fullClient.stop()
  }

  console.log('Editor LSP incremental sync smoke passed')
} finally {
  await rm(cwd, { recursive: true, force: true })
}
