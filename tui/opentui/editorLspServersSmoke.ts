import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findLspExecutable, resolveLspCommand } from './editorLspCommand'
import {
  clearEditorLspConfigCache,
  getEditorLspServerSpecs,
  loadEditorLspConfig,
  resolveLspWorkspaceRoot,
} from './editorLspServers'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// --- Windows command resolution, driven from any platform -------------------
// A language server installed by npm is a `.cmd` shim on Windows, and `spawn`
// cannot execute one. Every server in the table would be unreachable there, and
// nothing on a macOS or Linux machine would ever notice, so the platform is
// injected rather than read.

const windowsFiles = new Set([
  'C:\\tools\\bin\\gopls.exe',
  'C:\\Program Files\\node\\bash-language-server.cmd',
])
const windowsLookup = {
  platform: 'win32' as NodeJS.Platform,
  env: {
    PATH: 'C:\\tools\\bin;C:\\Program Files\\node',
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  } as unknown as NodeJS.ProcessEnv,
  // NTFS is case-insensitive, and PATHEXT is conventionally upper case while
  // the files on disk are not, so the model has to be too.
  isExecutable: (candidate: string) => [...windowsFiles].some((file) => file.toLowerCase() === candidate.toLowerCase()),
}

const exeFound = findLspExecutable('gopls', windowsLookup)
assert(exeFound?.toLowerCase() === 'c:\\tools\\bin\\gopls.exe', `PATHEXT lookup did not find gopls.exe: ${exeFound}`)

const nativeWindows = resolveLspCommand('gopls', [], windowsLookup)
assert(nativeWindows?.command.toLowerCase() === 'c:\\tools\\bin\\gopls.exe' && !nativeWindows.windowsVerbatimArguments,
  `A real Windows executable must be spawned directly: ${JSON.stringify(nativeWindows)}`)

const shim = resolveLspCommand('bash-language-server', ['start'], windowsLookup)
assert(shim?.command === 'C:\\Windows\\System32\\cmd.exe', `A .cmd shim must be run through cmd.exe: ${JSON.stringify(shim)}`)
assert(shim.windowsVerbatimArguments === true, 'cmd.exe invocation must set windowsVerbatimArguments')
// The default install path contains a space; unquoted, cmd.exe would run
// `C:\Program` and report that it is not recognised.
assert(shim.args.join(' ').toLowerCase() === '/d /s /c "\"c:\\program files\\node\\bash-language-server.cmd\" start"',
  `Shim command line was not quoted for cmd.exe: ${JSON.stringify(shim.args)}`)

assert(resolveLspCommand('definitely-not-installed', [], windowsLookup) === null,
  'A missing command must resolve to null rather than costing a failed spawn')

const posixLookup = {
  platform: 'linux' as NodeJS.Platform,
  env: { PATH: '/usr/bin:/usr/local/bin' } as unknown as NodeJS.ProcessEnv,
  isExecutable: (candidate: string) => candidate === '/usr/local/bin/rust-analyzer',
}
const posix = resolveLspCommand('rust-analyzer', [], posixLookup)
assert(posix?.command === '/usr/local/bin/rust-analyzer' && posix.args.length === 0,
  `POSIX resolution must return the found path unwrapped: ${JSON.stringify(posix)}`)
assert(findLspExecutable('rust-analyzer', { ...posixLookup, env: { PATH: '/usr/bin' } as unknown as NodeJS.ProcessEnv }) === null,
  'A command outside PATH must not resolve')

console.log('Editor LSP cross-platform command resolution smoke passed')

// --- Project configuration and workspace roots ------------------------------

const workspace = await mkdtemp(join(tmpdir(), 'agent-viewer-lsp-servers-'))
try {
  const typescript = getEditorLspServerSpecs('typescript')
  assert(typescript.some((spec) => spec.name === 'TypeScript 7' || spec.name === 'typescript-language-server'),
    `TypeScript has no server configured: ${JSON.stringify(typescript)}`)
  assert(!typescript.some((spec) => /(^|[/\\])tsc$/.test(spec.command) && spec.name !== 'TypeScript 7'),
    'Bare `tsc` is not a language server and must not be a fallback')
  assert(getEditorLspServerSpecs('rust')[0]?.command === 'rust-analyzer', 'rust lost its server')
  assert(getEditorLspServerSpecs('java').length > 0 && getEditorLspServerSpecs('markdown').length > 0
    && getEditorLspServerSpecs('terraform').length > 0 && getEditorLspServerSpecs('swift').length > 0,
    'Languages the filetype detector knows must have servers configured')
  assert(getEditorLspServerSpecs('not-a-language').length === 0, 'An unknown filetype must yield no servers')

  await mkdir(join(workspace, '.agent-viewer'), { recursive: true })
  await writeFile(join(workspace, '.agent-viewer', 'lsp.json'), `{
  // A project may name its own servers; comments and trailing commas are what
  // people actually write, so both are accepted.
  "servers": {
    "python": [{ "command": "my-python-lsp", "args": ["--stdio"], "name": "Project Python" }],
    "rust": [{ "command": "rust-analyzer-nightly", "extend": true }],
  },
  "disabled": ["yaml"],
  "rootMarkers": { "python": ["myproject.cfg"] },
}
`, 'utf8')
  clearEditorLspConfigCache()

  const loaded = loadEditorLspConfig(workspace)
  assert(loaded.error === null && loaded.source != null, `Project LSP config did not load: ${JSON.stringify(loaded)}`)

  const python = getEditorLspServerSpecs('python', workspace)
  assert(python.length === 1 && python[0]?.command === 'my-python-lsp' && python[0].name === 'Project Python',
    `A configured server must replace the built-ins: ${JSON.stringify(python)}`)
  const rust = getEditorLspServerSpecs('rust', workspace)
  assert(rust[0]?.command === 'rust-analyzer-nightly' && rust.some((spec) => spec.command === 'rust-analyzer'),
    `\`extend\` must prepend to the built-ins rather than replace them: ${JSON.stringify(rust)}`)
  assert(getEditorLspServerSpecs('yaml', workspace).length === 0, 'A disabled filetype must start no server')

  // Workspace roots: a server indexes its own project, and never escapes the
  // root the editor was opened at.
  await mkdir(join(workspace, 'services', 'api', 'src'), { recursive: true })
  await writeFile(join(workspace, 'services', 'api', 'go.mod'), 'module api\n', 'utf8')
  const goRoot = resolveLspWorkspaceRoot('go', join(workspace, 'services', 'api', 'src', 'main.go'), workspace)
  assert(goRoot === join(workspace, 'services', 'api'),
    `gopls must be rooted at the module, not the repository: ${goRoot}`)

  await mkdir(join(workspace, 'lib'), { recursive: true })
  const unrooted = resolveLspWorkspaceRoot('go', join(workspace, 'lib', 'stray.go'), workspace)
  assert(unrooted === workspace, `A file with no project around it must fall back to the editor root: ${unrooted}`)

  await mkdir(join(workspace, 'pkg', 'app'), { recursive: true })
  await writeFile(join(workspace, 'pkg', 'app', 'myproject.cfg'), '', 'utf8')
  const configuredRoot = resolveLspWorkspaceRoot('python', join(workspace, 'pkg', 'app', 'main.py'), workspace)
  assert(configuredRoot === join(workspace, 'pkg', 'app'),
    `A configured root marker must be honoured: ${configuredRoot}`)

  const unknownLanguageRoot = resolveLspWorkspaceRoot('not-a-language', join(workspace, 'lib', 'x.q'), workspace)
  assert(unknownLanguageRoot === workspace, `A language with no markers must use the editor root: ${unknownLanguageRoot}`)

  console.log('Editor LSP server registry, project config and workspace-root smoke passed')
} finally {
  clearEditorLspConfigCache()
  await rm(workspace, { recursive: true, force: true })
}
