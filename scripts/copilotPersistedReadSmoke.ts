// Copilot's read path must not start the session's runtime.
//
// Resuming a Copilot session to read it costs 1.4-7.8s and appends a synthetic
// `session.resume` event to the history it then hands back, so browsing a
// session changed what the session was made of. SDK 1.0.13's
// `sessions.readPersistedEvents` answers from the durable journal instead
// (1-7ms, no activation), and lib/adapters/copilot.ts now uses it for the
// transcript, the session info, and the model badge.
//
// None of that is visible in the UI: a regression here just makes browsing
// slow again and quietly re-appends resume events, which is exactly why it
// needs a test. Two halves are pinned:
//
//   1. No read leaves a runtime behind (peekCopilotSession stays null).
//   2. The journal's events are the activating reader's events, minus the one
//      resume that reader causes itself.
//
// Runs against your real local Copilot sessions and SKIPs when there are none
// or the CLI is unavailable — the same contract as npm run adapters:smoke.

import assert from 'node:assert/strict'
import { copilotAdapter } from '../lib/adapters/copilot'
import { evictCopilotSession, getCopilotClient, peekCopilotSession } from '../lib/copilotClient'
import { mapCopilotEventsToSessionMessages } from '../lib/copilotMapper'
import type { SessionEvent } from '@github/copilot-sdk'

type PersistedEventReader = {
  sessions?: {
    readPersistedEvents?: (params: { sessionId: string; cursor?: string; max?: number }) => Promise<{
      events: SessionEvent[]
      cursor: string
      hasMore: boolean
    }>
  }
}

function skip(reason: string): never {
  console.log(`copilot persisted-read smoke: SKIP (${reason})`)
  process.exit(0)
}

const client = await getCopilotClient().catch((error: unknown) => {
  skip(`Copilot CLI unavailable: ${error instanceof Error ? error.message : String(error)}`)
})

const read = (client.rpc as PersistedEventReader)?.sessions?.readPersistedEvents
if (typeof read !== 'function') skip('runtime predates sessions.readPersistedEvents')

const sessions = await copilotAdapter.listSessions!({ limit: 3, offset: 0 })
if (sessions.length === 0) skip('no local Copilot sessions')

for (const session of sessions) {
  const { sessionId } = session

  // Start from a cold pool so "a runtime exists afterwards" can only mean this
  // read created one.
  await evictCopilotSession(sessionId).catch(() => {})
  assert.equal(peekCopilotSession(sessionId), null, `${sessionId}: expected no warm runtime before the read`)

  const info = await copilotAdapter.readSessionInfo!(sessionId)
  assert.ok(info, `${sessionId}: persisted session info is missing`)
  assert.equal(peekCopilotSession(sessionId), null, `${sessionId}: readSessionInfo started a runtime`)

  const { messages } = await copilotAdapter.readAllMessages!(sessionId)
  assert.equal(peekCopilotSession(sessionId), null, `${sessionId}: readAllMessages started a runtime`)

  const models = await copilotAdapter.readModels!(sessionId)
  assert.equal(peekCopilotSession(sessionId), null, `${sessionId}: readModels started a runtime`)

  // A cold read has no runtime to ask for the context tier, and the journal
  // does not record one. Reporting a tier here would be a guess the composer
  // would then send back, downgrading a long-context session.
  assert.equal(models.currentContextTier ?? null, null, `${sessionId}: cold readModels invented a context tier`)

  // The journal is the whole journal, not a first page.
  const journal: SessionEvent[] = []
  let cursor: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const batch = await read({ sessionId, max: 1000, ...(cursor ? { cursor } : {}) })
    journal.push(...batch.events)
    if (!batch.hasMore || batch.events.length === 0) break
    cursor = batch.cursor
  }

  const activating = await (await import('../lib/copilotClient')).acquireCopilotSession(sessionId)
    .then((live) => (live as typeof live & { getEvents(): Promise<SessionEvent[]> }).getEvents())
  await evictCopilotSession(sessionId).catch(() => {})

  const journalIds = new Set(journal.map((event) => event.id))
  const extra = activating.filter((event) => !journalIds.has(event.id))
  assert.ok(
    extra.every((event) => event.type === 'session.resume'),
    `${sessionId}: the activating reader saw events the journal does not have, beyond its own resume: `
      + extra.map((event) => event.type).join(', '),
  )
  assert.ok(
    journal.every((event) => activating.some((live) => live.id === event.id)),
    `${sessionId}: the journal has events the activating reader does not`,
  )

  // Same events must mean the same transcript, not merely the same ids.
  const fromJournal = mapCopilotEventsToSessionMessages(sessionId, journal)
  const fromActivating = mapCopilotEventsToSessionMessages(
    sessionId,
    activating.filter((event) => journalIds.has(event.id)),
  )
  assert.deepEqual(fromJournal, fromActivating, `${sessionId}: journal and activating reads map differently`)
  assert.equal(messages.length, fromJournal.length, `${sessionId}: adapter transcript does not match the journal`)

  console.log(
    `  ${sessionId.slice(0, 8)} · ${journal.length} journal event(s) · ${messages.length} message(s)`
    + ` · model ${info.currentModel ?? 'unknown'} · +${extra.length} resume event(s) avoided`,
  )
}

console.log('copilot persisted-read smoke passed')
