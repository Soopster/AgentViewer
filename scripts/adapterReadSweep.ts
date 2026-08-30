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

// ACP declines list/info by design. Assert the decline rather than the value:
// a silent empty result here is the exact regression this refactor could cause.
async function assertAcpDeclines(provider: AgentProvider) {
  console.log(`\n=== ${provider} ===`)
  const sessions = await listViewSessions({ limit: 5, offset: 0, provider })
  console.log(sessions.length === 0
    ? '    ok   listSessions returns empty (transient sessions, nothing to enumerate)'
    : `    FAIL listSessions unexpectedly returned ${sessions.length}`)
  if (sessions.length !== 0) failures += 1

  const info = await readViewSessionInfo('does-not-exist', provider)
  console.log(info === null ? '    ok   readSessionInfo returns null for a dead session' : '    FAIL expected null')
  if (info !== null) failures += 1

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
for (const provider of ACP) await assertAcpDeclines(provider)

console.log(failures === 0 ? '\nAdapter read sweep: PASS' : `\nAdapter read sweep: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
