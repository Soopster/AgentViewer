// Open in IDE: detection, the argv each editor is given, path validation, a real
// detached launch, the file-open route in both renderers, and the route's
// refusal of callers that are not on this machine.
//   bun scripts/ideLaunchSmoke.ts
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'ide-smoke-'))
const bin = path.join(root, 'bin')
const repo = path.join(root, 'repo')
const record = path.join(root, 'argv.log')
mkdirSync(bin); mkdirSync(path.join(repo, '.git'), { recursive: true }); mkdirSync(path.join(repo, 'src'))
const file = path.join(repo, 'src', 'a.ts')
writeFileSync(file, 'export const a = 1\n')
for (const name of ['code', 'cursor', 'zed', 'idea', 'subl']) {
  const script = path.join(bin, name)
  writeFileSync(script, `#!/bin/sh\nprintf '%s' "${name}" >> "${record}"\nfor arg in "$@"; do printf '\\t%s' "$arg" >> "${record}"; done\nprintf '\\n' >> "${record}"\n`)
  chmodSync(script, 0o755)
}
process.env.PATH = `${bin}:/usr/bin:/bin`
process.env.AGENT_VIEWER_TEST = '1'
process.chdir(root)

let failures = 0
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`) }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
async function throwsWith(work: () => unknown, pattern: RegExp) {
  try { await work(); return false } catch (error) { return pattern.test(error instanceof Error ? error.message : String(error)) }
}

const launch = await import('../lib/ide/launch')
const env = { PATH: process.env.PATH, HOME: root }

const detected = launch.detectIdes(env, 'linux').map(entry => entry.id)
check('detects the editors on PATH', same(detected, ['vscode', 'cursor', 'zed', 'idea', 'sublime']), JSON.stringify(detected))

const argv = (ide: Parameters<typeof launch.ideCommand>[0], line: number | null, column: number | null = null) =>
  launch.ideCommand(ide, { path: file, line, column }, env, 'linux').argv.map(part => part.replace(bin, '$BIN'))
check('VS Code: workspace then -g file:line:col', same(argv('vscode', 39, 4), ['$BIN/code', repo, '-g', `${file}:39:4`]), JSON.stringify(argv('vscode', 39, 4)))
check('Cursor without a line opens the file in its workspace', same(argv('cursor', null), ['$BIN/cursor', repo, file]))
check('Zed: file:line', same(argv('zed', 7), ['$BIN/zed', `${file}:7`]))
check('JetBrains: --line N file', same(argv('idea', 7), ['$BIN/idea', '--line', '7', file]))
check('Sublime: file:line', same(argv('sublime', 7), ['$BIN/subl', `${file}:7`]))
check('a missing editor says how to install it', await throwsWith(() => launch.ideCommand('pycharm', { path: file }, env, 'linux'), /PyCharm is not installed.*pycharm/))

const nvim = launch.editorCommand(file, 39, { EDITOR: 'nvim' })
check('$EDITOR=nvim → +39 file, in a terminal', same(nvim.argv, ['nvim', '+39', file]) && nvim.terminal)
const codeWait = launch.editorCommand(file, 39, { VISUAL: 'code --wait', EDITOR: 'vim' })
check('$VISUAL wins and is split as argv', same(codeWait.argv, ['code', '--wait', '-g', `${file}:39`]) && !codeWait.terminal)

check('a relative path with no project is refused', await throwsWith(() => launch.resolveOpenPath({ path: 'src/a.ts' }), /relative/))
check('a relative path resolves against cwd', launch.resolveOpenPath({ path: 'src/a.ts', cwd: repo, line: 3 }).file === file)
check('a missing file is refused', await throwsWith(() => launch.resolveOpenPath({ path: path.join(repo, 'nope.ts') }), /does not exist/))
check('a NUL in the path is refused', await throwsWith(() => launch.resolveOpenPath({ path: `${file}\0x` }), /No file/))
check('a bad line is ignored, not passed on', launch.resolveOpenPath({ path: file, line: -3 }).line === null)

await launch.launchDetached(launch.ideCommand('zed', { path: file, line: 12 }, env, 'linux'))
for (let i = 0; i < 50 && !existsSync(record); i++) await new Promise(resolve => setTimeout(resolve, 20))
check('a detached launch runs the editor with that argv', existsSync(record) && readFileSync(record, 'utf8').trim() === `zed\t${file}:12`, existsSync(record) ? readFileSync(record, 'utf8') : 'not run')
check('a launch that cannot start rejects with a reason', await throwsWith(() => launch.launchDetached({ argv: [path.join(bin, 'gone')], terminal: false, label: 'Gone' }), /Gone.*not found/))

// The native service and the preference file (tui.json under this cwd).
const { nativeIde } = await import('../lib/ide/service')
const initial = await nativeIde.read()
check('no choice is saved at first', initial.preference === null)
await nativeIde.setPreference('cursor')
check('the choice is saved', (await nativeIde.read()).preference === 'cursor')
process.env.EDITOR = 'vim'
check('a terminal $EDITOR is refused from a detached launch', await throwsWith(() => nativeIde.open({ path: file, ide: 'editor' }), /runs in a terminal/))
delete process.env.EDITOR

// The route, as each renderer installs it.
const { routeFileOpen, effectiveIde } = await import('../lib/plugins/openInIde')
const { createIdeController } = await import('../plugins/open-in-ide/store')
check('with no route a file opens the host way', routeFileOpen({ path: file }) === false)
check('the TUI keeps its own editor until one is chosen', effectiveIde({ detected: [{ id: 'zed', label: 'Zed' }], preference: null, editor: null }, 'tui') === 'builtin')
check('the web uses the first editor installed until one is chosen', effectiveIde({ detected: [{ id: 'zed', label: 'Zed' }], preference: null, editor: null }, 'web') === 'zed')

function fakeService(preference: 'builtin' | 'cursor' | null, fail = false) {
  const opened: unknown[] = []
  return { opened, service: {
    read: async () => ({ detected: [{ id: 'cursor' as const, label: 'Cursor' }], preference, editor: null }),
    setPreference: async () => { throw new Error('unused') },
    open: async (input: unknown) => { opened.push(input); if (fail) throw new Error('Cursor did not start'); return { label: 'Cursor' } },
  } }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 10))

for (const [name, preference, expectClaim] of [['builtin chosen', 'builtin', false], ['nothing chosen', null, false]] as const) {
  const { service, opened } = fakeService(preference)
  const controller = createIdeController(service)
  const release = controller.activate('tui', () => {})
  await settle()
  let fellBack = false
  const claimed = routeFileOpen({ path: file, line: 9 }, () => { fellBack = true })
  await settle()
  check(`TUI, ${name}: the built-in editor opens it`, claimed === expectClaim && !opened.length && !fellBack)
  release()
}
{
  const { service, opened } = fakeService('cursor')
  const notices: string[] = []
  const controller = createIdeController(service)
  const release = controller.activate('tui', text => notices.push(text))
  await settle()
  const claimed = routeFileOpen({ path: file, line: 9 }, () => {})
  await settle()
  check('TUI, Cursor chosen: the route takes it at the line', claimed && same(opened, [{ path: file, line: 9, column: null, cwd: null, ide: 'cursor' }]), JSON.stringify(opened))
  check('and says where it opened', notices[0] === 'Opened src/a.ts:9 in Cursor', notices[0])
  release()
  check('turning the plugin off removes the route', routeFileOpen({ path: file }) === false)
}
{
  const { service } = fakeService('cursor', true)
  const notices: string[] = []
  const controller = createIdeController(service)
  const release = controller.activate('tui', text => notices.push(text))
  await settle()
  let fellBack = false
  routeFileOpen({ path: file }, () => { fellBack = true })
  await settle()
  check('TUI: a failed launch says why and falls back to the built-in editor', fellBack && notices[0] === 'Cursor did not start')
  release()
}
{
  const { service, opened } = fakeService(null)
  const controller = createIdeController(service)
  const release = controller.activate('web', () => {})
  // Before the first read lands: the web still takes the click and waits for the choice.
  const claimed = routeFileOpen({ path: file, line: 2 }, () => {})
  await settle()
  check('web, nothing chosen: opens in the editor installed', claimed && (opened[0] as { ide?: string })?.ide === 'cursor')
  release()
}

// The HTTP route: only a page served to this machine may launch an editor.
const route = await import('../app/api/ide/route')
const post = (body: unknown, headers: Record<string, string> = {}) => route.POST(new Request('http://localhost:3000/api/ide', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }))
check('POST open with no Origin is refused', (await post({ action: 'open', path: file, ide: 'zed' })).status === 403)
check('POST open from another origin is refused', (await post({ action: 'open', path: file, ide: 'zed' }, { origin: 'http://192.168.1.20:3000' })).status === 403)
const local = await post({ action: 'open', path: file, ide: 'zed', line: 5 }, { origin: 'http://localhost:3000' })
check('POST open from a local page launches', local.status === 200, String(local.status))
check('POST set rejects an unknown editor', (await post({ action: 'set', ide: 'notepad++' })).status === 400)

rmSync(root, { recursive: true, force: true })
if (failures) { console.error(`${failures} failed`); process.exit(1) }
console.log('ideLaunchSmoke: all passed')
