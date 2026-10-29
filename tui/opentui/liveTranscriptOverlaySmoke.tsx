/** @jsxImportSource @opentui/react */
import React, { useLayoutEffect, useState } from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session, SessionMessage } from '../../lib/types'
import type { ThreadedMessage } from '../../lib/threading'
import { buildThreadedMessages } from '../../lib/threading'
import { indexComposerMessages, visibleComposerMessages } from '../../lib/composerTranscript'
import { runLiveTranscriptOverlayEffect } from './app/effects/liveTranscript'
import { summarizeDurableSessionMessages } from './messageFingerprint'
import { sessionKey } from './app/sessionList'
import { testRender, act } from './testRender'

process.chdir(mkdtempSync(path.join(tmpdir(), 'live-transcript-overlay-')))
const session: Session = { sessionId: 'overlay-loop', provider: 'codex', cwd: process.cwd(), lastModified: 1 }
const key = sessionKey(session)
const rawMessages: SessionMessage[] = [{
  type: 'user', uuid: 'persisted-user', session_id: session.sessionId, provider: 'codex', parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
}]
const persisted = buildThreadedMessages(rawMessages)
const echo: ThreadedMessage = { ...persisted[0], uuid: 'live-user' }
const assistant: ThreadedMessage = { ...echo, uuid: 'live-assistant', role: 'assistant', blocks: [{ type: 'text', text: 'Streaming reply' }] }
const baseline = { current: new Map([[key, { ...summarizeDurableSessionMessages([]), startedAt: Date.now() }]]) }
let renders = 0
let cleanupUpdates = 0
let snapshot: ThreadedMessage[] = []
const persistedIndex = indexComposerMessages(persisted, new Set(['persisted-user']))
function StreamingOverlay() {
  const [messages, setMessages] = useState([echo, assistant])
  snapshot = messages
  assert.ok(++renders < 20, 'unchanged overlay cleanup must not trigger a render loop')
  useLayoutEffect(() => {
    runLiveTranscriptOverlayEffect({
      selectedSessionTarget: { ...session },
      sessionDetail: { info: null, rawMessages, threadedMessages: persisted, contextUsage: null },
      liveTranscriptBaselineRef: baseline,
      composerLiveText: 'Streaming reply', liveTranscriptMessages: messages,
      liveTranscriptMessagesForSession: visibleComposerMessages(messages, persistedIndex),
      awaitingPersistedTurn: false, ownsComposerStream: () => true,
      setLiveTranscriptMessages: update => { cleanupUpdates++; setMessages(update) },
      persistedComposerMessages: persistedIndex,
      liveToolIndexesRef: { current: new Map() }, liveToolInputJsonRef: { current: new Map() },
      setComposerLiveText: () => { throw new Error('owned stream must remain live') },
      setAwaitingPersistedTurn: () => { throw new Error('owned stream must remain live') },
    })
  })
  return <text>{messages.map(message => message.uuid).join(',')}</text>
}
const setup = await testRender(<StreamingOverlay />, { width: 60, height: 4 })
try {
  await act(async () => { await setup.flush() })
  assert.deepEqual(snapshot, [assistant], 'the durable user replaces its echo while the assistant keeps streaming')
  assert.equal(cleanupUpdates, 1, 'layout cleanup must stop dispatching state updates once the echo is removed')
  assert.ok(renders <= 3, `overlay must settle after cleanup, saw ${renders} renders`)
  assert.ok(baseline.current.has(key), 'an owned stream retains its baseline')
  console.log('Live transcript overlay settles after echo cleanup without dropping the active stream')
} finally {
  await act(async () => setup.renderer.destroy())
}
process.exit(0)
