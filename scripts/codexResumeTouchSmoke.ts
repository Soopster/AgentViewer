// A resume this app makes bumps a Codex thread's updatedAt; listings must not
// read that bump as the user's activity, and must drop the override the moment
// real work moves updatedAt on. Hermetic: the store is a file under a temp cwd.
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-codex-touch-')))
const { recordCodexResumeTouch, codexActivityUpdatedAt } = await import('../lib/codexResumeTouch')

const fail = (message: string): never => { throw new Error(message) }
const thread = { updatedAt: 2_000, recencyAt: 1_000 }

if (codexActivityUpdatedAt('codex:t1', thread) !== 2_000) fail('an unrecorded thread must report its own updatedAt')
recordCodexResumeTouch('codex:t1', 2_000)
if (codexActivityUpdatedAt('codex:t1', thread) !== 1_000) fail('a thread still at our resume bump must report its last turn')
if (codexActivityUpdatedAt('codex:t1', { updatedAt: 2_500, recencyAt: 2_400 }) !== 2_500) fail('real work after the resume must be reported')
if (codexActivityUpdatedAt('codex:t2', thread) !== 2_000) fail('a touch must not leak onto another thread')
if (codexActivityUpdatedAt('codex:t1', { updatedAt: 2_000, recencyAt: null }) !== 2_000) fail('with no last turn to report, keep updatedAt')

// Another isolate or process records into the same file; this one must see it.
const file = path.join(process.cwd(), '.agent-viewer-data', 'codex-resume-touches.json')
mkdirSync(path.dirname(file), { recursive: true })
await new Promise((resolve) => setTimeout(resolve, 20))
writeFileSync(file, JSON.stringify({ version: 1, entries: { 'codex:t1': 2_000, 'codex:t3': 9_000 } }))
if (codexActivityUpdatedAt('codex:t3', { updatedAt: 9_000, recencyAt: 8_000 }) !== 8_000) fail('a touch recorded by another process was not read')

console.log('codex resume touch smoke passed (bump hidden, real work shown, per thread, shared across processes)')
