import assert from 'node:assert/strict'

import type { Session } from '../../lib/types'
import {
  adjustSplitReaderShare,
  calculateSplitPaneBodyRows,
  calculateSplitPaneLayout,
  groupItemsBySplitPaneKey,
  isComposerTargetReady,
  preserveArrayIdentity,
  removeSplitPaneKey,
  resolveComposerTargetSession,
  documentedSplitChordKeys,
  runComposerSessionPreparation,
  splitCommandKey,
  evenSplitReaderShare,
  SPLIT_SHARE_EVEN,
  SPLIT_SHARE_MAX,
  SPLIT_SHARE_MIN,
  SPLIT_SHARE_STEP,
} from './splitPaneState'

const paneA = { sessionKey: 'claude:a', text: 'A' }
const paneB = { sessionKey: 'codex:b', text: 'B' }
const grouped = groupItemsBySplitPaneKey(
  [paneA.sessionKey, paneB.sessionKey],
  [paneA, paneB],
  (item) => item.sessionKey,
  new Map(),
)
assert.deepEqual(grouped.get(paneA.sessionKey), [paneA])
assert.deepEqual(grouped.get(paneB.sessionKey), [paneB])

const unchanged = [paneA, paneB]
assert.equal(preserveArrayIdentity(unchanged, [paneA, paneB]), unchanged)
assert.notEqual(
  preserveArrayIdentity(unchanged, [paneA, { ...paneB, text: 'updated' }]),
  unchanged,
)

assert.deepEqual(removeSplitPaneKey(['pane-1', 'pane-2'], 0), ['pane-2'])
assert.deepEqual(removeSplitPaneKey(['pane-1', 'pane-2'], 1), ['pane-1'])
assert.equal(splitCommandKey('%', false), '⌃B %')
assert.equal(splitCommandKey('%', true), '? palette')

const firstPaneLayout = calculateSplitPaneLayout({
  availableExtent: 130,
  requestedCount: 1,
  availableCount: 1,
  maxPanes: 2,
  minPaneExtent: 46,
  minReaderExtent: 40,
})
assert.equal(firstPaneLayout.visibleCount, 1)
assert.ok(firstPaneLayout.paneExtent >= 46)
// The even split must stay exactly what it was before readerShare existed:
// one separator per pane, the remainder to the reader.
assert.equal(firstPaneLayout.paneExtent, Math.floor(129 / 2))
assert.equal(firstPaneLayout.readerExtent, 129 - firstPaneLayout.paneExtent)

const twoPaneLayout = calculateSplitPaneLayout({
  availableExtent: 200,
  requestedCount: 2,
  availableCount: 2,
  maxPanes: 2,
  minPaneExtent: 46,
  minReaderExtent: 40,
})
assert.equal(twoPaneLayout.visibleCount, 2)

// Too narrow for a side-by-side pane, but the same terminal stacked has plenty
// of rows: the stacked orientation is what makes a split reachable there.
const narrowColumns = calculateSplitPaneLayout({
  availableExtent: 80,
  requestedCount: 1,
  availableCount: 1,
  maxPanes: 2,
  minPaneExtent: 46,
  minReaderExtent: 40,
})
assert.equal(narrowColumns.visibleCount, 0)
assert.equal(narrowColumns.readerExtent, 80)
const narrowStacked = calculateSplitPaneLayout({
  availableExtent: 38,
  requestedCount: 1,
  availableCount: 1,
  maxPanes: 2,
  minPaneExtent: 9,
  minReaderExtent: 12,
})
assert.equal(narrowStacked.visibleCount, 1)
assert.ok(narrowStacked.paneExtent >= 9)
assert.ok(narrowStacked.readerExtent >= 12)
assert.equal(narrowStacked.paneExtent + narrowStacked.readerExtent, 37)

// A manual ratio moves the divider without dropping the pane the user asked
// for: extreme shares clamp to the minimums instead.
const wideReader = calculateSplitPaneLayout({
  availableExtent: 200,
  requestedCount: 1,
  availableCount: 1,
  maxPanes: 2,
  minPaneExtent: 46,
  minReaderExtent: 40,
  readerShare: 0.75,
})
assert.equal(wideReader.visibleCount, 1)
assert.ok(wideReader.readerExtent >= Math.round(199 * 0.75))
assert.equal(wideReader.paneExtent + wideReader.readerExtent, 199)
const clampedReader = calculateSplitPaneLayout({
  availableExtent: 130,
  requestedCount: 1,
  availableCount: 1,
  maxPanes: 2,
  minPaneExtent: 46,
  minReaderExtent: 40,
  readerShare: 0.8,
})
assert.equal(clampedReader.visibleCount, 1, 'an extreme share must clamp, never drop a pane')
assert.ok(clampedReader.paneExtent >= 46)

// The resize keys start from whatever the even split currently is, so the
// first press moves off it rather than jumping to an unrelated ratio.
assert.equal(evenSplitReaderShare(1), 0.5)
assert.equal(evenSplitReaderShare(2), 1 / 3)
assert.equal(adjustSplitReaderShare(SPLIT_SHARE_EVEN, SPLIT_SHARE_STEP, 0.5), 0.55)
assert.equal(adjustSplitReaderShare(0.55, -SPLIT_SHARE_STEP, 0.5), 0.5)
assert.equal(adjustSplitReaderShare(0.78, SPLIT_SHARE_STEP, 0.5), SPLIT_SHARE_MAX)
assert.equal(adjustSplitReaderShare(0.27, -SPLIT_SHARE_STEP, 0.5), SPLIT_SHARE_MIN)

// Anti-drift: every prefix key the ⌃B dispatcher in App.tsx accepts must be in
// the help overlay's table. Adding a chord without documenting it fails here.
const DISPATCHED_SPLIT_CHORDS = [
  '%', 'v', '"', 's', 'r', 'n', 'x', 'z',
  '<', '>', '=',
  'o', '→', 'tab', '←', ';', '1 … 9', '?', 'esc', '⌃C', '⌃G',
]
const documented = new Set(documentedSplitChordKeys())
for (const chord of DISPATCHED_SPLIT_CHORDS) {
  assert.ok(documented.has(chord), `⌃B ${chord} is handled but missing from the keybinds help`)
}
assert.equal(documented.size, DISPATCHED_SPLIT_CHORDS.length, 'the keybinds help documents a chord the dispatcher does not handle')

// Focus styling must never resize a pane's scroll viewport. The action row is
// permanently reserved, leaving the same body height before and after focus
// navigation; a live-status row remains the only intentional height change.
assert.equal(calculateSplitPaneBodyRows(40, 0), 35)
assert.equal(calculateSplitPaneBodyRows(40, 1), 34)
assert.equal(calculateSplitPaneBodyRows(6, 0), 3)

const composerKey = (session: Pick<Session, 'sessionId' | 'provider'>) => `${session.provider ?? 'claude'}:${session.sessionId}`

// A composer aimed at a split pane must stay aimed there. Closing the pane's
// tab mid-draft used to fall through to the reader's session and send the
// message to a different agent; it now resolves from the session list, and
// refuses outright when the target is gone.
{
  const paneSession: Session = { sessionId: 'pane-target', provider: 'claude' }
  const readerSession: Session = { sessionId: 'reader', provider: 'claude' }
  const paneKey = composerKey(paneSession)
  const stillOpen = resolveComposerTargetSession({
    paneTargetKey: paneKey,
    preferredTargetKey: null,
    selectedSession: readerSession,
    runningSessions: [],
    sessions: [readerSession, paneSession],
    openTabSessions: [readerSession, paneSession],
    keyOf: composerKey,
  })
  assert.equal(stillOpen, paneSession)

  const tabClosed = resolveComposerTargetSession({
    paneTargetKey: paneKey,
    preferredTargetKey: null,
    selectedSession: readerSession,
    runningSessions: [],
    sessions: [readerSession, paneSession],
    openTabSessions: [readerSession],
    keyOf: composerKey,
  })
  assert.equal(tabClosed, paneSession, 'a closed tab must not retarget a pane-aimed composer')

  const gone = resolveComposerTargetSession({
    paneTargetKey: paneKey,
    preferredTargetKey: null,
    selectedSession: readerSession,
    runningSessions: [readerSession],
    sessions: [readerSession],
    openTabSessions: [readerSession],
    keyOf: composerKey,
  })
  assert.equal(gone, null, 'an unresolvable pane target must refuse, never fall through to the reader')
  assert.equal(isComposerTargetReady({ preparingTargetKey: null, targetSession: gone, keyOf: composerKey }), false)
}

const newSessionProviders: NonNullable<Session['provider']>[] = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'lmstudio']
for (const provider of newSessionProviders) {
  const oldRunningSession: Session = { sessionId: `old-${provider}`, provider }
  const freshSession: Session = { sessionId: `fresh-${provider}`, provider, summary: 'New session' }
  const composerSessions = [oldRunningSession, freshSession]
  const freshKey = composerKey(freshSession)
  const composerTarget = resolveComposerTargetSession({
    paneTargetKey: null,
    preferredTargetKey: freshKey,
    selectedSession: freshSession,
    runningSessions: [oldRunningSession],
    sessions: composerSessions,
    openTabSessions: [freshSession],
    keyOf: composerKey,
  })
  assert.equal(composerTarget, freshSession, `${provider}: a newly-created session must outrank sole-running-session auto-targeting`)
  assert.equal(isComposerTargetReady({ preparingTargetKey: freshKey, targetSession: freshSession, keyOf: composerKey }), false)
  assert.equal(isComposerTargetReady({ preparingTargetKey: null, targetSession: freshSession, keyOf: composerKey }), true)

  const automaticTarget = resolveComposerTargetSession({
    paneTargetKey: null,
    preferredTargetKey: null,
    selectedSession: freshSession,
    runningSessions: [oldRunningSession],
    sessions: composerSessions,
    openTabSessions: [freshSession],
    keyOf: composerKey,
  })
  assert.equal(automaticTarget, oldRunningSession, `${provider}: normal browsing should retain sole-running-session auto-targeting`)
}

const preparationStages: string[] = []
await runComposerSessionPreparation({
  refreshSessions: async () => { preparationStages.push('sessions') },
  prewarmRuntime: async () => { preparationStages.push('runtime') },
  loadDetail: async () => { preparationStages.push('detail') },
  loadAffordances: async () => {
    assert.deepEqual(new Set(preparationStages), new Set(['sessions', 'runtime', 'detail']))
    preparationStages.push('affordances')
  },
})
assert.equal(preparationStages.at(-1), 'affordances', 'composer affordances must load after runtime and session state')

console.log('Split pane state routing, identity, viewport stability, close targeting, and layout passed')
