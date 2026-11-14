import { createBetterProgress, type BetterProgress } from './plugins/betterProgress'
// Server-side, provider-neutral host for the Better composer accessory.
// A separate, retained research session uses the source's provider and account.
import { buildBetterPrompt, parseBetterReply } from './plugins/betterPrompt'
import { extractSseFrames, extractStreamingAssistantText, extractTextContent, shouldReplaceLiveAssistantText } from './composerStream'
import { withProviderInstance, currentProviderInstanceId } from './providerInstances'
import { listViewSessionMessages, readViewSessionInfo } from './sessionReads'
import { createNewViewSession, closeViewSession, streamViewSessionTurn } from './sessionBackend'
import { registerResearchSession } from './sessionResearchPolicy'
import { sessionIdentityKey, type SessionIdentity } from './sessionIdentity'
import { applyPluginSettings, isPluginEnabled, subscribePluginEnablement } from './plugins/enablement'
import { readPluginSettingsFile } from './plugins/settingsFile'

export type BetterResult = { prompt: string; summary: string; helper: SessionIdentity }
const active = new Set<string>()

export async function researchBetterPrompt(session: SessionIdentity & { cwd?: string }, draft: string, ownerSignal: AbortSignal, onProgress?: (progress: BetterProgress) => void): Promise<BetterResult> {
  if (draft.length > 80_000) throw new Error('The draft is too long to refine. Shorten it to 80,000 characters first.')
  const provider = session.provider ?? 'claude'
  return withProviderInstance(session.providerInstanceId, provider, async () => {
    applyPluginSettings(readPluginSettingsFile())
    if (!isPluginEnabled('better')) throw new Error('Better prompts is disabled')
    const target = { ...session, provider, providerInstanceId: currentProviderInstanceId(provider) }
    const key = sessionIdentityKey(target)
    if (active.has(key)) throw new Error('A prompt rewrite is already running for this session.')
    const disabled = new AbortController()
    const unsubscribe = subscribePluginEnablement(() => { if (!isPluginEnabled('better')) disabled.abort() })
    const signal = AbortSignal.any([ownerSignal, disabled.signal, AbortSignal.timeout(20 * 60_000)])
    active.add(key)
    let helper: SessionIdentity | undefined
    const releasePolicies: (() => void)[] = []
    const progress = createBetterProgress()
    try {
      signal.throwIfAborted()
      onProgress?.(progress.update({}, ''))
      const [info, messages] = await Promise.all([
        readViewSessionInfo(target.sessionId, provider),
        listViewSessionMessages(target.sessionId, { limit: 40, offset: 0, tail: true }, provider),
      ])
      signal.throwIfAborted()
      const context = messages.map(message => `${message.type}: ${extractTextContent((message.message as { content?: unknown }).content)}`).join('\n\n').slice(-24_000)
      if (!draft.trim() && !context.trim()) throw new Error('Write a draft first, or open a conversation with a task to deepen.')
      const created = await createNewViewSession({ provider, cwd: session.cwd || info?.cwd, title: 'Better prompt research' })
      helper = { provider, providerInstanceId: target.providerInstanceId, sessionId: created.sessionId }
      releasePolicies.push(registerResearchSession(helper))
      signal.throwIfAborted()
      const response = await streamViewSessionTurn({ provider, sessionId: helper.sessionId, signal,
        body: {
          message: buildBetterPrompt(draft, context), cwd: created.cwd, isPendingSession: created.isPending,
          ...(info?.currentModel ? { model: info.currentModel } : {}),
          // Use the provider's ordinary approval flow; never grant bypass permissions.
          manualPermissions: true, detachOnClientAbort: false,
          ...(provider === 'claude' ? { permissionMode: 'plan', claudeAgentPolicy: { name: 'prompt-research', prompt: 'Research and rewrite the request only. Never implement it.', tools: ['Read', 'Grep', 'Glob'], mcpServers: [], skills: [], permissionMode: 'plan' } } : {}),
          ...(provider === 'codex' ? { collaborationMode: 'plan', approvalPolicy: 'untrusted' } : {}),
          ...(provider === 'copilot' ? { mode: 'plan', permissionMode: 'on' } : {}),
          ...(provider === 'opencode' ? { agent: 'plan' } : {}),
        },
      })
      if (!response.ok || !response.body) throw new Error(`The research helper could not start (${response.status}): ${(await response.text()).slice(0, 500)}`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = '', reply = ''
      let lastProgress = ''
      const consume = (chunk: string) => {
        pending += chunk
        const extracted = extractSseFrames(pending)
        pending = extracted.remaining
        if (pending.length > 2_000_000) throw new Error('The helper returned an oversized stream frame.')
        for (const frame of extracted.frames) {
          let payload: Record<string, unknown>
          try { payload = JSON.parse(frame.data) } catch { continue }
          if (frame.event === 'error' || payload.type === 'error') throw new Error(typeof payload.error === 'string' ? payload.error : 'The research helper failed. Inspect its research session for details.')
          if ((frame.event === 'turn-accepted' || frame.event === 'session') && typeof payload.sessionId === 'string' && payload.sessionId !== helper!.sessionId) {
            helper = { ...helper!, sessionId: payload.sessionId }
            releasePolicies.push(registerResearchSession(helper))
          }
          // ACP carries canonical assistant message chunks rather than native deltas.
          const acp = payload.type === 'acp_message' ? payload.message as { type?: string; message?: { content?: unknown } } : null
          const text = acp?.type === 'assistant' ? extractTextContent(acp.message?.content) : extractStreamingAssistantText(payload)
          if (text !== null) reply = shouldReplaceLiveAssistantText(payload) ? text : reply + text
          const snapshot = progress.update(payload, reply)
          const signature = JSON.stringify(snapshot)
          if (signature !== lastProgress) { lastProgress = signature; onProgress?.(snapshot) }
          if (reply.length > 240_000) throw new Error('The helper reply is too long. Narrow the request and try again.')
        }
      }
      const abortRead = () => { void reader.cancel().catch(() => {}) }
      signal.addEventListener('abort', abortRead, { once: true })
      try {
        while (true) {
          signal.throwIfAborted()
          const next = await reader.read()
          if (next.done) break
          consume(decoder.decode(next.value, { stream: true }))
        }
        consume(decoder.decode() + '\n\n')
      } finally {
        signal.removeEventListener('abort', abortRead)
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      signal.throwIfAborted()
      await listViewSessionMessages(helper.sessionId, { limit: 1, offset: 0, tail: true }, provider).catch(() => [])
      signal.throwIfAborted()
      return { ...parseBetterReply(reply), helper }
    } finally {
      // Close runtime resources, retain the helper transcript for inspection.
      if (helper) await closeViewSession(helper.sessionId, provider).catch(() => {})
      for (const release of releasePolicies) release()
      unsubscribe()
      active.delete(key)
    }
  })
}
