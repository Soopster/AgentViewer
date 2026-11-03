import assert from 'node:assert/strict'
import { parseTerminalAddressing, terminalHandle, cancelQueuedTerminalPrompts, encodeTerminalPrompt, queueTerminalPrompt, queuedTerminalPromptCount, sendTerminalPrompt, terminalAnswerBytes } from './terminalPrompt'

assert.equal(terminalAnswerBytes(''), '\r')
assert.equal(terminalAnswerBytes('2'), '2')
assert.equal(terminalAnswerBytes('Y'), 'Y')
assert.equal(terminalAnswerBytes('yes please'), null, 'prose is not an answer')
assert.equal(terminalAnswerBytes('10'), null)
assert.equal(encodeTerminalPrompt('a', true, true), 'a\r')
assert.ok(encodeTerminalPrompt('a\nb', true, true).startsWith('\x1b[200~'), 'multi-line is one bracketed paste')
assert.equal((await sendTerminalPrompt('shell-missing', 'x')).ok, false, 'a closed shell is an error, not a drop')

// A queued prompt for a terminal that is gone is released with that error, never held forever.
const result = await new Promise<{ ok: boolean }>(resolve => { queueTerminalPrompt('shell-missing', 'x', r => resolve(r)) })
assert.equal(result.ok, false)
assert.equal(queuedTerminalPromptCount('shell-missing'), 0)

queueTerminalPrompt('shell-other', 'y', () => {})
assert.equal(queuedTerminalPromptCount('shell-other'), 1)
assert.equal(cancelQueuedTerminalPrompts('shell-other'), 1)
assert.equal(queuedTerminalPromptCount('shell-other'), 0)
const t = (id: string, name: string, agent: string | null = 'claude') => ({ id, name, cwd: '/', agent, agentState: 'idle' })
const terms = [t('shell-1', 'Claude terminal'), t('shell-2', 'Codex'), t('shell-3', 'zsh', null), t('shell-4', 'Claude review')]
assert.equal(terminalHandle('Claude terminal'), 'claude-terminal')
const one = parseTerminalAddressing('@claude-terminal @codex run the tests', terms)!
assert.deepEqual(one.targets.map(x => x.id), ['shell-1', 'shell-2'])
assert.equal(one.text, 'run the tests')
assert.equal(parseTerminalAddressing('@claude fix it', terms), null, 'an ambiguous prefix addresses nothing')
assert.deepEqual(parseTerminalAddressing('@cod fix it', terms)!.targets.map(x => x.id), ['shell-2'])
assert.deepEqual(parseTerminalAddressing('@shell-3 ls', terms)!.targets.map(x => x.id), ['shell-3'])
assert.deepEqual(parseTerminalAddressing('@all status?', terms)!.targets.map(x => x.id), ['shell-1', 'shell-2', 'shell-4'], '@all is the agents, not a plain shell')
assert.equal(parseTerminalAddressing('@src/App.tsx explain this', terms), null, 'a file mention is not addressing')
assert.equal(parseTerminalAddressing('@codex @src/App.tsx explain', terms)!.text, '@src/App.tsx explain', 'addressing ends at the first word that matches nothing')
assert.equal(parseTerminalAddressing('hello @codex', terms), null, 'only leading handles address')
import { commandShell } from './processTree'
import { controlEndpoint } from './terminalControl'
const win = commandShell('npm run dev', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, 'win32')
assert.deepEqual(win.args, ['/d', '/s', '/c', 'npm run dev'])
assert.equal(win.file, 'C:\\Windows\\System32\\cmd.exe')
assert.deepEqual(commandShell('ls', { SHELL: '/bin/zsh' }, 'darwin'), { file: '/bin/zsh', args: ['-lc', 'ls'] })
const endpoint = controlEndpoint('/tmp/x', 42, 'win32')
assert.equal(endpoint.listenPath, '\\\\.\\pipe\\agent-viewer-terminal-42', 'Windows listens on a named pipe')
assert.ok(endpoint.registryFile.endsWith('terminal-42.json'))
assert.ok(controlEndpoint('/tmp/x', 42, 'linux').listenPath.endsWith('terminal-42.sock'))
console.log('terminalPromptSmoke ok')
process.exit(0)
