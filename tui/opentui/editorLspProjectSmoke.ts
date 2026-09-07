import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EditorLspClient, type EditorDiagnostic } from './editorLsp'
import { editorLspStartupNotifications } from './editorLspServers'
import { disposeAllLspSessions } from './editorLspSession'

// Two things a C# buffer needs that no other server in the table does, both
// verified against real roslyn-language-server before being pinned here.
//
// Roslyn will not compile anything until it is told which project the file
// belongs to (`solution/open` / `project/open` — Microsoft extensions, not
// standard LSP). Without that it analyses C# as a loose "miscellaneous file"
// and the editor looks like it is working: hover, definition and an outline all
// answer, completion returns the file's own members — but there are **no
// compiler errors at all**, and `workspace/symbol` is empty. Measured on a real
// project: 1 style hint and 2 completions before, 5 diagnostics including two
// genuine CS0029 errors and 6 completions after.
//
// And loading a project takes seconds, so whatever was pulled at startup is
// stale. Roslyn announces readiness with `workspace/projectInitializationComplete`;
// the standard spelling is `workspace/diagnostic/refresh`. Ignoring either
// leaves the buffer showing the pre-load answer forever.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// --- which notifications a server gets, and when ---------------------------

const roslyn = { command: 'roslyn-language-server', args: ['--stdio'], name: 'Roslyn' }
const gopls = { command: 'gopls', args: [], name: 'gopls' }

const workspace = await mkdtemp(join(tmpdir(), 'agent-viewer-lsp-project-'))
try {
  assert(editorLspStartupNotifications(roslyn, workspace).length === 0,
    'A directory with no project must produce no startup notifications')
  assert(editorLspStartupNotifications(gopls, workspace).length === 0,
    'Only Roslyn takes these notifications; another server must never be sent them')

  await writeFile(join(workspace, 'App.csproj'), '<Project/>\n', 'utf8')
  const projectOnly = editorLspStartupNotifications(roslyn, workspace)
  assert(projectOnly.length === 1 && projectOnly[0]!.method === 'project/open',
    `A bare project must be opened with project/open: ${JSON.stringify(projectOnly)}`)
  const projects = (projectOnly[0]!.params as { projects: string[] }).projects
  assert(projects.length === 1 && projects[0]!.startsWith('file://') && projects[0]!.endsWith('App.csproj'),
    `project/open must name the project by file uri: ${JSON.stringify(projects)}`)

  // A solution describes every project in it, so it wins over the projects.
  await writeFile(join(workspace, 'App.sln'), '\n', 'utf8')
  const withSolution = editorLspStartupNotifications(roslyn, workspace)
  assert(withSolution.length === 1 && withSolution[0]!.method === 'solution/open',
    `A solution must be preferred over its projects: ${JSON.stringify(withSolution)}`)

  console.log('Editor LSP project-open selection smoke passed')
} finally {
  await rm(workspace, { recursive: true, force: true })
}

// --- the whole handshake, against a server with Roslyn's semantics ----------

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-lsp-project-run-'))
const serverPath = join(cwd, 'roslyn-like.mjs')
const sourcePath = join(cwd, 'Program.cs')

// Answers pull diagnostics with a style hint until it is told about a project,
// then announces readiness and answers with the real error — exactly what the
// live server does.
const roslynLike = String.raw`
let input = Buffer.alloc(0)
let projectOpened = false
function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body)
}
const diagnostic = (severity, message) => ({
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
  severity, message, source: 'roslyn-like',
})
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
      send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { diagnosticProvider: {} } } })
    }
    if (message.method === 'project/open') {
      // Loading takes seconds in the real server, so the pull that happens at
      // startup still gets the pre-load answer. The state only flips when the
      // readiness notification goes out — which is what makes ignoring that
      // notification observable here rather than accidentally harmless.
      setTimeout(() => {
        projectOpened = true
        send({ jsonrpc: '2.0', method: 'workspace/projectInitializationComplete' })
      }, 120)
    }
    if (message.method === 'textDocument/diagnostic') {
      send({ jsonrpc: '2.0', id: message.id, result: { items: projectOpened
        ? [diagnostic(1, "Cannot implicitly convert type 'int' to 'string'")]
        : [diagnostic(3, 'Use primary constructor')] } })
    }
  }
})
`

try {
  await writeFile(serverPath, roslynLike, 'utf8')
  await writeFile(join(cwd, 'App.csproj'), '<Project/>\n', 'utf8')
  await writeFile(sourcePath, 'class C { string s = 42; }\n', 'utf8')

  let diagnostics: EditorDiagnostic[] = []
  const client = new EditorLspClient(cwd, 'csharp', sourcePath, [
    { command: process.execPath, args: [serverPath], name: 'Roslyn' },
  ])
  client.onDiagnostics((next) => { diagnostics = next })
  try {
    assert(await client.start('class C { string s = 42; }\n'), 'The Roslyn-like server did not start')

    const deadline = Date.now() + 5_000
    while (Date.now() < deadline && !diagnostics.some((entry) => entry.severity === 1)) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert(diagnostics.some((entry) => entry.severity === 1 && entry.message.includes('Cannot implicitly convert')),
      `The compiler error never arrived — the project was not opened, or the readiness notification was ignored: ${JSON.stringify(diagnostics)}`)
    assert(!diagnostics.some((entry) => entry.message === 'Use primary constructor'),
      `The pre-load answer was left on screen after the project loaded: ${JSON.stringify(diagnostics)}`)

    console.log('Editor LSP project-open handshake smoke passed (errors appear once the project loads)')
  } finally {
    client.stop()
    disposeAllLspSessions()
  }
} finally {
  await rm(cwd, { recursive: true, force: true })
}
