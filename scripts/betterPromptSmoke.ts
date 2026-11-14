import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BETTER_HELPER_INSTRUCTIONS } from '../lib/plugins/betterInstructions'
const { mock } = await (0, eval)('import("bun:test")')
import { AsyncLocalStorage } from 'node:async_hooks'
import { PROVIDER_IDS } from '../lib/extensions/providers/catalog'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS } from '../lib/plugins/enablement'
import { buildBetterPrompt, parseBetterReply } from '../lib/plugins/betterPrompt'
import { mergeComposerRewrite } from '../lib/plugins/composer'

const scope = new AsyncLocalStorage<string>()
let seen: Record<string, unknown>[] = []
let count = 0
let stream: 'reply' | 'wait' | 'error' | 'malformed' = 'reply'
let sourceReady: (() => void) | undefined
let releaseSource: (() => void) | undefined
const closed: string[] = []
mock.module('../lib/providerInstances', () => ({
  currentProviderInstance: () => null,
  currentProviderInstanceId: () => scope.getStore() ?? 'default',
  withProviderInstance: (id: string, _provider: string, run: () => unknown) => scope.run(id ?? 'default', run),
}))
mock.module('../lib/plugins/settingsFile', () => ({ readPluginSettingsFile: () => DEFAULT_PLUGIN_SETTINGS }))
mock.module('../lib/sessionReads', () => ({
  readViewSessionInfo: async () => ({ cwd: '/fixture/repo', currentModel: 'source-model' }),
  listViewSessionMessages: async () => {
    if (sourceReady) { const notify = sourceReady; sourceReady = undefined; notify(); await new Promise<void>(resolve => { releaseSource = resolve }) }
    return [{ type: 'user', message: { content: 'Fix the crash; preserve keyboard shortcuts.' } }]
  },
}))
mock.module('../lib/sessionBackend', () => ({
  createNewViewSession: async ({ provider }: { provider: string }) => ({ sessionId: `research-${++count}`, provider, cwd: '/fixture/repo', isPending: true }),
  closeViewSession: async (id: string) => { closed.push(id) },
  streamViewSessionTurn: async (params: { provider: string; sessionId: string; signal: AbortSignal; body: Record<string, unknown> }) => {
    seen.push({ ...params, instance: scope.getStore() })
    if (stream === 'wait') return new Response(new ReadableStream({ start(controller) { params.signal.addEventListener('abort', () => controller.close(), { once: true }) } }))
    if (stream === 'error') return new Response('event: error\ndata: {"error":"provider unavailable"}\n\n')
    const reply = stream === 'malformed' ? 'No marked prompt' : 'Read the crash path.\n<improved-prompt>Fix the crash in input.ts. Verify the keyboard smoke.</improved-prompt>'
    const payload = params.provider.includes('acp')
      ? { type: 'acp_message', message: { type: 'assistant', message: { content: [{ type: 'text', text: reply }] } } }
      : { type: 'mod_delta', delta: reply }
    const bytes = new TextEncoder().encode(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId: `${params.sessionId}-accepted` })}\n\ndata: ${JSON.stringify(payload)}\n\n`)
    return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close() } }))
  },
}))
const { researchBetterPrompt } = await import('../lib/promptResearch')
const { hasResearchToolPolicy } = await import('../lib/sessionResearchPolicy')
const { askPluginsAboutPermission } = await import('../lib/plugins/permissionBridge')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
for (const provider of PROVIDER_IDS) {
  const result = await researchBetterPrompt({ provider, providerInstanceId: 'work', sessionId: 'same-source' }, 'Fix the crash', new AbortController().signal)
  assert.equal(result.prompt, 'Fix the crash in input.ts. Verify the keyboard smoke.')
  assert.equal(result.helper.provider, provider)
  assert.equal(result.helper.providerInstanceId, 'work')
  assert.match(result.helper.sessionId, /-accepted$/)
  assert.equal(seen.at(-1)!.instance, 'work')
  assert.equal((seen.at(-1)!.body as Record<string, unknown>).model, 'source-model')
  assert.ok(closed.includes(result.helper.sessionId))
}
const prompt = buildBetterPrompt('Original scope', 'Raw context')
assert.equal(BETTER_HELPER_INSTRUCTIONS, readFileSync(new URL('../plugins/better/helper.md', import.meta.url), 'utf8'))
assert.ok(prompt.startsWith(BETTER_HELPER_INSTRUCTIONS))
assert.match(prompt, /Never carry the prompt out/)
assert.match(prompt, /other than you or me/)
assert.match(prompt, /Original scope/)
assert.throws(() => parseBetterReply('<improved-prompt> </improved-prompt>'), /non-empty/)
assert.equal(parseBetterReply('<improved-prompt>a</improved-prompt><improved-prompt>b</improved-prompt>').prompt, 'b')
assert.equal(mergeComposerRewrite('original', 'original', 'better'), 'better')
assert.equal(mergeComposerRewrite('new notes', 'original', 'better'), 'better\n\nnew notes')
stream = 'error'
await assert.rejects(researchBetterPrompt({ provider: 'pi', sessionId: 'error' }, 'draft', new AbortController().signal), /provider unavailable/)
stream = 'malformed'
await assert.rejects(researchBetterPrompt({ provider: 'pi', sessionId: 'malformed' }, 'draft', new AbortController().signal), /improved prompt/)
stream = 'wait'
const abort = new AbortController()
const running = researchBetterPrompt({ provider: 'codex', providerInstanceId: 'work', sessionId: 'cancel' }, 'draft', abort.signal)
for (let i = 0; i < 100 && !seen.at(-1)?.signal; i++) await new Promise(resolve => setTimeout(resolve, 1))
await new Promise(resolve => setTimeout(resolve, 10))
const helperId = seen.at(-1)!.sessionId as string
await scope.run('work', async () => {
  assert.equal(hasResearchToolPolicy('codex', helperId), true)
  assert.equal((await askPluginsAboutPermission('codex', helperId, { toolName: 'apply_patch' }))?.decision, 'deny')
  assert.equal((await askPluginsAboutPermission('codex', helperId, { toolName: 'read' }))?.decision, 'allow')
})
assert.equal(scope.run('personal', () => hasResearchToolPolicy('codex', helperId)), false)
abort.abort()
await assert.rejects(running, { name: 'AbortError' })
assert.ok(closed.includes(helperId))
assert.equal(scope.run('work', () => hasResearchToolPolicy('codex', helperId)), false)
// Same native source ID in two accounts may run independently; same account may not.
stream = 'reply'
const started = new Promise<void>(resolve => { sourceReady = resolve })
const first = researchBetterPrompt({ provider: 'pi', providerInstanceId: 'work', sessionId: 'duplicate' }, 'draft', new AbortController().signal)
await started
await assert.rejects(researchBetterPrompt({ provider: 'pi', providerInstanceId: 'work', sessionId: 'duplicate' }, 'draft', new AbortController().signal), /already running/)
await researchBetterPrompt({ provider: 'pi', providerInstanceId: 'personal', sessionId: 'duplicate' }, 'draft', new AbortController().signal)
releaseSource!()
await first
console.log(`Better prompts: PASS (${PROVIDER_IDS.length} providers, account isolation, split SSE, errors, cancellation, research policy, draft preservation)`)
