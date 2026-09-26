// Exercises the full routed read path against whatever real sessions exist
// locally, one provider at a time. This is the behaviour check for the adapter
// refactor: the public sessionBackend functions are unchanged, so if these all
// answer the way they did before, the routing is correct.
//
// Providers with no local sessions report SKIP rather than failing — an empty
// corpus is not a regression.
import {
  listViewSessions,
  readViewSessionInfo,
  listViewSessionMessageWindow,
  readViewSessionModels,
  readViewSessionComposerOptions,
  readViewSessionSlashCommands,
  readViewSessionDiagnostics,
  getClaudeSubagentSummaries,
} from '../lib/sessionBackend'
import { assertAllAdapterCapabilities } from '../lib/adapters/registry'
import type { AgentProvider } from '../lib/types'

const PROVIDERS: AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'lmstudio']
const ACP: AgentProvider[] = ['claude-acp', 'codex-acp']

let failures = 0

async function step<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await run()
    console.log(`    ok   ${label}`)
    return value
  } catch (error) {
    failures += 1
    console.log(`    FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

async function sweep(provider: AgentProvider) {
  console.log(`\n=== ${provider} ===`)
  const sessions = await step('listSessions', () => listViewSessions({ limit: 5, offset: 0, provider }))
  if (!sessions) return
  console.log(`    listed ${sessions.length} session(s)`)
  const sessionId = sessions[0]?.sessionId
  if (!sessionId) {
    console.log('    SKIP  no local sessions to read')
    return
  }
  await step('readSessionInfo', async () => {
    const info = await readViewSessionInfo(sessionId, provider)
    if (!info) throw new Error('returned null for a session the listing just produced')
    return info
  })
  await step('messageWindow', async () => {
    const window = await listViewSessionMessageWindow(sessionId, { limit: 20, offset: 0 }, provider)
    if (window.messages.length === 0 && window.total > 0) throw new Error('window empty despite non-zero total')
    console.log(`         ${window.total} message(s)${window.externalWriter ? ' (external writer)' : ''}`)
    return window
  })
  await step('models', async () => {
    const { models } = await readViewSessionModels(sessionId, provider)
    console.log(`         ${models.length} model(s)`)
  })
  await step('composerOptions', () => readViewSessionComposerOptions(sessionId, provider))
  await step('slashCommands', async () => {
    const commands = await readViewSessionSlashCommands(sessionId, provider)
    console.log(`         ${commands.length} command(s)`)
  })
  await step('diagnostics', async () => {
    const { sections } = await readViewSessionDiagnostics(sessionId, provider)
    console.log(`         ${sections.length} section(s)`)
  })
  await step('subagentSummaries', () => getClaudeSubagentSummaries(sessionId, provider))
}

// ACP listing is CONDITIONAL, not absent.
//
// This used to assert that listSessions always returned empty, on the premise
// that ACP sessions were transient and there was nothing to enumerate. Both
// installed agents advertise `session/list`, and claude-agent-acp genuinely
// serves it — so the old assertion was pinning a stale premise rather than a
// contract, and would have blocked the feature that replaced it.
//
// The contract now is: list only what can actually be opened. An agent that
// cannot enumerate, or that advertises `session/load` and then fails it (which
// codex-acp 1.6.2 does), must list nothing rather than fill the sidebar with
// sessions that open empty. Both outcomes are legitimate, so this asserts the
// RULE — whatever is listed must be well-formed and loadable — instead of a
// count that depends on whose machine it runs on.
async function assertAcpListing(provider: AgentProvider) {
  console.log(`\n=== ${provider} ===`)
  const sessions = await listViewSessions({ limit: 5, offset: 0, provider })
  if (sessions.length === 0) {
    console.log('    ok   listSessions empty (agent does not enumerate, or its history is not replayable)')
  } else {
    console.log(`    ok   listSessions returned ${sessions.length} enumerable session(s)`)
    // A listed session that cannot be identified or opened is the failure this
    // feature exists to avoid, so every entry is checked rather than the count.
    const malformed = sessions.filter((session) => !session.sessionId || session.provider !== provider || !session.summary)
    console.log(malformed.length === 0
      ? '    ok   every listed session carries an id, provider and summary'
      : `    FAIL ${malformed.length} listed session(s) malformed`)
    if (malformed.length > 0) failures += 1

    // And it must actually open: listing something the transcript read cannot
    // answer for is exactly the trap the readability gate is meant to close.
    const first = sessions[0]!
    const info = await readViewSessionInfo(first.sessionId, provider)
    console.log(info ? '    ok   a listed session resolves through readSessionInfo' : '    FAIL a listed session did not resolve')
    if (!info) failures += 1
  }

  const dead = await readViewSessionInfo('does-not-exist', provider)
  console.log(dead === null ? '    ok   readSessionInfo returns null for a dead session' : '    FAIL expected null')
  if (dead !== null) failures += 1

  const { models } = await readViewSessionModels('does-not-exist', provider)
  console.log(models.length === 0 ? '    ok   readModels returns empty (no model RPC in ACP)' : '    FAIL expected empty')
  if (models.length !== 0) failures += 1
}

// The capability/adapter pairing used to be asserted for all eight providers
// at registry import. Adapters now load on demand (they each drag a provider
// SDK in, and importing all eight cost ~88MB of RSS), so the whole-table check
// lives here instead — this suite is the place that legitimately wants every
// adapter resident at once.
await step('capabilities match adapters (all providers)', assertAllAdapterCapabilities)

for (const provider of PROVIDERS) await sweep(provider)
for (const provider of ACP) await assertAcpListing(provider)

console.log(failures === 0 ? '\nAdapter read sweep: PASS' : `\nAdapter read sweep: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
