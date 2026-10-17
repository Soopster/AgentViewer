// Pins what the rail's ⇧Y hides. A false positive hides a real conversation,
// so the negative cases matter more than the positive ones.
import type { Session } from '../../lib/types'
import { hideScratchSessions, isScratchSession } from './scratchSessions'

const session = (summary: string, extra: Partial<Session> = {}): Session => ({ sessionId: summary, summary, ...extra })
const failures: string[] = []
const expect = (cond: boolean, message: string) => { if (!cond) failures.push(message) }

for (const probe of [
  'Reply with the single word: pong. Do not use any tools.',
  'Reply with only the word OK',
  'Respond with exactly the number 4',
  'Output the literal text ETA followed by THETA',
  'This is a formatting test. Output the literal…',
  'hi', 'Hello!', 'test',
]) expect(isScratchSession(session(probe)), `not scratch: ${probe}`)

for (const real of [
  'Add Codex-style scrollback view',
  'Reply with a summary of the failing tests',
  'Say hello to the new teammate in the coordinator run',
  'hi, can you look at the build failure',
  'Test the seams of the editor save path',
  'Coordinated run · dusk',
]) expect(!isScratchSession(session(real)), `scratch: ${real}`)

expect(!isScratchSession(session('hi', { customTitle: 'Kickoff' })), 'a session the user named was scratch')

const list = [session('hi'), session('Real work'), session('pong', { summary: 'Reply with the single word: pong' }), session('Hello', { isPinned: true })]
const kept = hideScratchSessions(list, (s) => s.sessionId === 'pong')
expect(kept.hidden === 1 && kept.sessions.length === 3, `hid ${kept.hidden}, expected only the unprotected "hi"`)
const none = [session('Real work')]
expect(hideScratchSessions(none, () => false).sessions === none, 'nothing hidden but a new array was returned')

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('Scratch sessions smoke passed')
