import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createScratchDir, isScratchDir } from '../lib/scratchSessions'
import { indexSession, groupByProject } from '../lib/sessionListModel'
import { formatSessionProject } from '../tui/format'
import type { Session } from '../lib/types'

const a = await createScratchDir()
const b = await createScratchDir()
try {
  assert.ok(existsSync(a) && a !== b)
  assert.ok(isScratchDir(a))
  assert.ok(!isScratchDir(process.cwd()))
  assert.ok(!isScratchDir(undefined))
  const mk = (sessionId: string, cwd: string): Session =>
    ({ sessionId, provider: 'claude', cwd, createdAt: 1, lastModified: 1, summary: 's' }) as Session
  const { groups } = groupByProject([mk('1', a), mk('2', b), mk('3', process.cwd())].map(indexSession))
  assert.equal(groups.length, 2, 'both scratch chats share one group')
  assert.equal(groups.find((g) => g.sessions.length === 2)?.projectName, 'Scratch')
  assert.equal(formatSessionProject(mk('1', a)), 'Scratch')
  console.log('scratchSessionsSmoke ok')
} finally {
  await rm(a, { recursive: true, force: true })
  await rm(b, { recursive: true, force: true })
}
