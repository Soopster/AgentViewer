// The Windows terminal path, driven from any machine: a fake ConPTY module behind
// the real adapter, plus the pure shell, executable and quoting choices.
import assert from 'node:assert/strict'
import { ConPtyProcess, clampPtySize, resizePty, setConPtyLoaderForTest, spawnPty, type ConPtyHandle } from '../lib/ptyBridge'
import { hostShell, resolveWindowsExecutable } from '../lib/hostShell'
import { quoteArgv, shellDialectFor } from '../lib/shellQuote'

// ── The adapter, behind a fake ConPTY ───────────────────────────────────────
const spawned: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = []
const writes: string[] = []
const resizes: Array<[number, number]> = []
let killed = 0
let emitData: (data: string) => void = () => {}
let emitExit: (event: { exitCode: number; signal?: number }) => void = () => {}
const restore = setConPtyLoaderForTest(() => ({
  spawn(file, args, options) {
    spawned.push({ file, args, options })
    const handle: ConPtyHandle = {
      pid: 4242,
      onData: (listener) => { emitData = listener },
      onExit: (listener) => { emitExit = listener },
      write: (data) => { writes.push(data) },
      resize: (cols, rows) => { resizes.push([cols, rows]) },
      kill: () => { killed += 1 },
    }
    return handle
  },
}))

const proc = spawnPty({ exec: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: ['-NoLogo'], cols: 100, rows: 30, cwd: 'C:\\work', env: { PATH: 'x', KEEP: '1' }, platform: 'win32' })
assert.ok(proc instanceof ConPtyProcess)
assert.equal(spawned[0].file, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'); assert.deepEqual(spawned[0].args, ['-NoLogo'])
assert.equal((spawned[0].options as { cols: number }).cols, 100)
assert.equal((spawned[0].options as { env: Record<string, string> }).env.TERM, 'xterm-256color')
assert.equal((spawned[0].options as { env: Record<string, string> }).env.KEEP, '1')
assert.equal(proc.pid, 4242); assert.equal(proc.stderr, null, 'a pseudoconsole has one stream')

const chunks: Buffer[] = []
proc.stdout!.on('data', (chunk: Buffer) => { chunks.push(chunk) })
emitData('héllo ✓')
assert.ok(Buffer.isBuffer(chunks[0])); assert.equal(chunks[0].toString('utf8'), 'héllo ✓', 'output reaches consumers as Buffers, as the shim gave them')

proc.stdin!.write('dir\r')
assert.deepEqual(writes, ['dir\r'])
assert.equal(resizePty(proc, 120, 40), true); assert.deepEqual(resizes, [[120, 40]])
resizePty(proc, 9999, 1); assert.deepEqual(resizes[1], [500, 2], 'a resize is clamped like the shim\'s')

const events: string[] = []
proc.on('exit', (code: number) => events.push(`exit:${code}`))
proc.on('close', () => events.push('close'))
emitExit({ exitCode: 3 }); emitExit({ exitCode: 9 })
assert.deepEqual(events, ['exit:3', 'close'], 'exit is reported once')
assert.equal(resizePty(proc, 80, 24), false, 'a finished pty cannot be resized')
assert.equal(proc.kill(), false)

const second = spawnPty({ exec: 'C:\\cmd.exe', args: [], cols: 80, rows: 24, platform: 'win32' })
second.kill(); assert.equal(killed, 1)
assert.throws(() => spawnPty({ exec: 'definitely-not-installed', args: [], cols: 80, rows: 24, platform: 'win32' }), /Could not find/)
setConPtyLoaderForTest(restore)
assert.equal(clampPtySize(NaN, 80), 80)

// ── Executable and shell choice ─────────────────────────────────────────────
const present = (...files: string[]) => (file: string) => files.includes(file)
const env = { PATH: 'C:\\a;C:\\b', PATHEXT: '.COM;.EXE;.CMD', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
assert.equal(resolveWindowsExecutable('tool', env, present('C:\\b\\tool.CMD', 'C:\\a\\tool.EXE')), 'C:\\a\\tool.EXE', 'earlier PATH entry and earlier PATHEXT win')
assert.equal(resolveWindowsExecutable('tool.cmd', env, present('C:\\b\\tool.cmd')), 'C:\\b\\tool.cmd')
assert.equal(resolveWindowsExecutable('D:\\x\\y.exe', env, present()), 'D:\\x\\y.exe', 'a path is not searched')
assert.equal(resolveWindowsExecutable('nope', env, present()), null)

assert.deepEqual(hostShell({ SHELL: '/bin/zsh' }, 'darwin'), { exec: '/bin/zsh', args: ['-l'], name: 'zsh' })
assert.deepEqual(hostShell({}, 'linux'), { exec: '/bin/sh', args: ['-l'], name: 'sh' })
assert.equal(hostShell(env, 'win32', present('C:\\a\\pwsh.EXE')).name, 'pwsh', 'PowerShell 7 first')
assert.equal(hostShell(env, 'win32', present('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).name, 'powershell')
assert.deepEqual(hostShell(env, 'win32', present()), { exec: 'C:\\Windows\\System32\\cmd.exe', args: [], name: 'cmd' })

// ── Quoting: a value never becomes syntax ───────────────────────────────────
assert.equal(shellDialectFor('/usr/bin/zsh'), 'posix'); assert.equal(shellDialectFor('C:\\x\\pwsh.exe'), 'powershell')
assert.equal(shellDialectFor('powershell'), 'powershell'); assert.equal(shellDialectFor('C:\\Windows\\System32\\cmd.exe'), 'cmd')
assert.equal(quoteArgv(['npm', 'test', "it's", '$(rm -rf ~)'], 'posix'), `npm test 'it'\\''s' '$(rm -rf ~)'`)
assert.equal(quoteArgv(['git', 'commit', '-m', "it's $(x) `y`; & z"], 'powershell'), `& 'git' 'commit' '-m' 'it''s $(x) \`y\`; & z'`)
assert.equal(quoteArgv(['C:\\Program Files\\x.exe', 'a&b', 'plain'], 'cmd'), '"C:\\Program Files\\x.exe" "a&b" plain')
assert.throws(() => quoteArgv(['echo', '%PATH%'], 'cmd'), /cannot be quoted safely/)
assert.throws(() => quoteArgv(['echo', 'say "hi"'], 'cmd'), /cannot be quoted safely/)
for (const dialect of ['posix', 'powershell', 'cmd'] as const) assert.throws(() => quoteArgv(['a\nb'], dialect), /line break/)
console.log('windowsPtySmoke ok')
