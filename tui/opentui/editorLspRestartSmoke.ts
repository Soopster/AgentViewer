import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EditorLspClient, type EditorLspStatus } from './editorLsp'
import { disposeAllLspSessions } from './editorLspSession'

// A language server crashing is ordinary — rust-analyzer and gopls both do it
// on a bad workspace state, and jdtls does it routinely. Before this, the
// buffer simply stopped answering: no completions, no diagnostics, no
// navigation, and the only cure was closing and reopening the file. The editor
// has to bring it back by itself, and it has to stop trying for a server that
// cannot start at all.

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-lsp-restart-'))
const serverPath = join(cwd, 'crashy-lsp.mjs')
const sourcePath = join(cwd, 'main.ts')
const runsPath = join(cwd, 'runs.txt')

// Crashes once, on demand, then serves normally. Each launch appends a line, so
// the test can count real processes rather than trusting a status message.
const crashyServer = String.raw`
import { appendFileSync, readFileSync } from 'node:fs'
appendFileSync(process.env.RUNS_PATH, 'start\n')
const runs = readFileSync(process.env.RUNS_PATH, 'utf8').trim().split('\n').length
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
    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { completionProvider: {} } } })
    }
    if (message.method === 'textDocument/didOpen') {
      // Report the text the client reopened with, so a restart that resurrects
      // stale content is visible rather than silent.
      send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: {
        uri: message.params.textDocument.uri,
        diagnostics: [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          severity: 3, source: 'run-' + runs, message: message.params.textDocument.text.trim(),
        }],
      } })
    }
    if (message.method === 'textDocument/completion') {
      if (runs === 1) process.exit(9)
      send({ jsonrpc: '2.0', id: message.id, result: [{ label: 'alive-run-' + runs }] })
    }
  }
})
`

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function waitFor(predicate: () => boolean, timeoutMs: number, description: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

process.env.RUNS_PATH = runsPath
try {
  await writeFile(serverPath, crashyServer, 'utf8')
  await writeFile(runsPath, '', 'utf8')
  await writeFile(sourcePath, 'const value = 1\n', 'utf8')

  const statuses: EditorLspStatus[] = []
  let diagnosticText: string | null = null
  let diagnosticSource: string | undefined
  const client = new EditorLspClient(cwd, 'typescript', sourcePath, [
    { command: process.execPath, args: [serverPath], name: 'crashy-lsp' },
  ])
  client.onStatus((status) => { statuses.push(status) })
  client.onDiagnostics((diagnostics) => {
    if (diagnostics.length === 0) return
    diagnosticText = diagnostics[0]!.message
    diagnosticSource = diagnostics[0]!.source
  })
  try {
    assert(await client.start('const value = 1\n'), 'Crashy server did not start')
    await waitFor(() => diagnosticSource === 'run-1', 2_000, 'the first server to report')

    // The user keeps typing; the restart must reopen what the buffer holds now.
    client.change('const value = 2\n')
    await client.completion({ line: 0, character: 1 }) // kills the server

    await waitFor(() => statuses.some((status) => status.state === 'error'), 2_000, 'the crash to be reported')
    await waitFor(() => diagnosticSource === 'run-2', 5_000, 'the server to come back on its own')
    assert(diagnosticText === 'const value = 2', `Restart reopened stale buffer content: ${diagnosticText}`)

    const completions = await client.completion({ line: 0, character: 1 })
    assert(completions[0]?.label === 'alive-run-2',
      `The restarted server is not answering requests: ${JSON.stringify(completions)}`)
    const ready = statuses.filter((status) => status.state === 'ready')
    assert(ready.length >= 2, `A recovered server must report itself ready again: ${JSON.stringify(statuses)}`)
    console.log('Editor LSP crash-recovery smoke passed (server restarted with current buffer content)')
  } finally {
    client.stop()
    disposeAllLspSessions()
  }

  // A server that cannot run at all must give up rather than respawn forever.
  await writeFile(runsPath, '', 'utf8')
  const brokenPath = join(cwd, 'broken-lsp.mjs')
  await writeFile(brokenPath, `import { appendFileSync } from 'node:fs'\nappendFileSync(process.env.RUNS_PATH, 'start\\n')\nprocess.exit(1)\n`, 'utf8')
  const brokenStatuses: EditorLspStatus[] = []
  const broken = new EditorLspClient(cwd, 'typescript', sourcePath, [
    { command: process.execPath, args: [brokenPath], name: 'broken-lsp' },
  ])
  broken.onStatus((status) => { brokenStatuses.push(status) })
  try {
    await broken.start('const value = 1\n')
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    const attempts = (await import('node:fs')).readFileSync(runsPath, 'utf8').trim().split('\n').filter(Boolean).length
    assert(attempts <= 4, `A server that never initializes was respawned ${attempts} times`)
    assert(brokenStatuses.at(-1)?.state === 'error' || brokenStatuses.at(-1)?.state === 'unavailable',
      `A server that cannot start must end in a failed state: ${JSON.stringify(brokenStatuses.at(-1))}`)
    console.log('Editor LSP restart-cap smoke passed (a server that cannot start is not respawned forever)')
  } finally {
    broken.stop()
    disposeAllLspSessions()
  }
} finally {
  await rm(cwd, { recursive: true, force: true })
}
