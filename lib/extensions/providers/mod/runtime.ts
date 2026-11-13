// Send path for the `mod` provider: the instance's mod streams the reply
// (lib/modProvider.ts), and persists the turn itself. Frames are `mod_delta`,
// which the shared composer stream already maps to reply text.
import { currentProviderExecutable } from '../../../providerInstances'
import { currentModProvider } from '../../../modProvider'
import { broadcastLiveSessionActivity, broadcastLiveSessionTurnEnd, broadcastLiveSessionTurnStart } from '../../../liveSessionHarness'
import { clearRunningSession, setRunningSession } from '../../../sessionRuntime'
import { steerViewSession } from '../../../sessionSteering'
import type { ProviderRuntime } from '../types'

const SSE_HEADERS = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' }

export const runtime: ProviderRuntime = {
  async createSession({ cwd, title }) {
    const mod = await currentModProvider(currentProviderExecutable(''))
    if (!mod) throw new Error('No provider mod is installed. Add one under ~/.config/agent-viewer/plugins (see the plugin authoring guide).')
    const resolvedCwd = cwd?.trim() ? cwd : process.cwd()
    const created = await mod.provider.createSession({ cwd: resolvedCwd, ...(title ? { title } : {}) })
    if (!created || typeof created.id !== 'string' || !created.id) throw new Error(`Mod "${mod.pluginId}" createSession returned no id`)
    return { sessionId: created.id, provider: 'mod', cwd: resolvedCwd, isPending: false }
  },

  async streamTurn(params, checkpoint) {
    await checkpoint?.catch(() => null)
    const { sessionId, signal } = params
    const message = String(params.body.message ?? '').trim()
    const executable = currentProviderExecutable('')
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false
        const send = (chunk: string) => { if (closed) return; try { controller.enqueue(encoder.encode(chunk)) } catch { closed = true } }
        const turn = new AbortController()
        const onAbort = () => turn.abort()
        signal.addEventListener('abort', onAbort, { once: true })
        setRunningSession(sessionId, { provider: 'mod', ...(params.providerInstanceId ? { providerInstanceId: params.providerInstanceId } : {}), interrupt: async () => { turn.abort() } })
        broadcastLiveSessionTurnStart('mod', sessionId)
        send(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId, provider: 'mod' })}\n\n`)
        try {
          const mod = await currentModProvider(executable)
          if (!mod) throw new Error('No provider mod is installed for this instance')
          // A copy: the conversation before this turn, whatever the mod does to its own store while it streams.
          const history = (await mod.provider.readMessages(sessionId)).map(entry => ({ ...entry }))
          const reply = await mod.provider.sendTurn({ sessionId, message, history, signal: turn.signal })
          const emit = (delta: string) => {
            if (!delta) return
            broadcastLiveSessionActivity('mod', sessionId)
            send(`data: ${JSON.stringify({ type: 'mod_delta', delta })}\n\n`)
          }
          if (typeof reply === 'string') emit(reply)
          else if (reply && typeof (reply as unknown as Promise<string>).then === 'function') emit(String(await (reply as unknown as Promise<string>)))
          else for await (const delta of reply as AsyncIterable<string>) { if (turn.signal.aborted) break; emit(String(delta)) }
        } catch (error) {
          if (!turn.signal.aborted) send(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Mod provider failed' })}\n\n`)
        } finally {
          signal.removeEventListener('abort', onAbort)
          clearRunningSession(sessionId)
          broadcastLiveSessionTurnEnd('mod', sessionId)
          if (!closed) { closed = true; try { controller.close() } catch { /* closed downstream */ } }
        }
      },
    })
    return new Response(stream, { headers: SSE_HEADERS })
  },

  async runAction({ sessionId, body }) {
    if (body.action === 'steer') return steerViewSession(sessionId, body, 'mod')
    throw new Error(`Action ${typeof body.action === 'string' ? body.action : '(missing)'} is not supported for mod sessions`)
  },

  async closeSession() {},
}
