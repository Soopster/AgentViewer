// An OpenCode 2 server, presented through the OpenCode 1 client surface this
// app calls (lib/adapters/opencode.ts, lib/opencodeHarness.ts,
// lib/opencodeSessions.ts and the send path in lib/sessionBackend.ts).
//
// The alternative was a `version === 2` branch at each of ~30 call sites, in
// files that are already the largest here. The mismatch is a transport one —
// the same operations under different names, with the same data in a different
// shape — so it is translated once, at the boundary, and everything above it
// keeps one vocabulary. lib/opencode2Mapping.ts holds the shape translation and
// lib/opencode2Events.ts the stream.
//
// Only the operations this app actually calls are implemented. An operation
// OpenCode 2 genuinely dropped (session sharing) throws saying so, rather than
// resolving with something that looks like it worked.

import { OpenCode } from '@opencode/client'
import {
  OPENCODE_2_VERSION,
  toV1MessageBundles,
  toV1PermissionAsked,
  toV1Question,
  toV1Session,
  toV2FormAnswer,
  todosFromBundles,
  type OpenCodeMessageBundle,
  type V2FormInfo,
  type V2Message,
  type V2PermissionRequest,
  type V2SessionInfo,
} from './opencode2Mapping'
import { OpenCode2EventTranslator } from './opencode2Events'
import type {
  Agent as OpenCodeAgent,
  Command as OpenCodeCommand,
  OpencodeClient,
  Session as OpenCodeSession,
} from '@opencode-ai/sdk'
import type { OpencodeClient as OpencodeV2Client, QuestionRequest } from '@opencode-ai/sdk/v2'

type V2Client = ReturnType<typeof OpenCode.make>

// The server rejects a larger page, and a transcript read follows the cursor
// until it has the tail it needs.
const MESSAGE_PAGE_LIMIT = 200
const MESSAGE_HISTORY_LIMIT = 2000
const SESSION_PAGE_LIMIT = 200

type RequestOptions = { signal?: AbortSignal }

function optionsFrom(input: unknown): RequestOptions | undefined {
  if (!input || typeof input !== 'object') return undefined
  const signal = (input as { signal?: AbortSignal }).signal
  return signal ? { signal } : undefined
}

function pathId(input: unknown): string {
  const path = (input as { path?: { id?: string } } | undefined)?.path
  const id = path?.id
  if (typeof id !== 'string' || !id) throw new Error('OpenCode request is missing a session id')
  return id
}

function body<T extends Record<string, unknown>>(input: unknown): Partial<T> {
  return ((input as { body?: T } | undefined)?.body ?? {}) as Partial<T>
}

function query<T extends Record<string, unknown>>(input: unknown): Partial<T> {
  return ((input as { query?: T } | undefined)?.query ?? {}) as Partial<T>
}

/** v2 wraps most collections in `{ data }`; a few answer with the array. */
function listOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  const data = (value as { data?: unknown } | undefined)?.data
  return Array.isArray(data) ? data as T[] : []
}

function locationInput(directory: string | undefined): { location?: { directory: string } } {
  return directory ? { location: { directory } } : {}
}

function unsupported(operation: string): never {
  throw new Error(`${operation} is not available on an OpenCode 2 server.`)
}

export type OpenCode2Clients = { client: OpencodeClient; clientV2: OpencodeV2Client }

export function createOpenCode2Clients(options: { baseUrl: string; headers?: Record<string, string> }): OpenCode2Clients {
  const v2 = OpenCode.make({ baseUrl: options.baseUrl, ...(options.headers ? { headers: options.headers } : {}) })

  const readSession = async (sessionId: string, request?: RequestOptions): Promise<V2SessionInfo> =>
    await v2.session.get({ sessionID: sessionId }, request) as unknown as V2SessionInfo

  /**
   * Read a transcript newest-page-first and hand it back oldest-first, which is
   * the order every consumer assumes. Paging from the newest end is what makes
   * the cap ("the last N messages") mean the same thing it meant in v1 rather
   * than "the first N", which on a long session would return the opening of a
   * conversation nobody is looking at.
   */
  const readMessages = async (sessionId: string, request?: RequestOptions): Promise<V2Message[]> => {
    const collected: V2Message[] = []
    let cursor: string | undefined
    while (collected.length < MESSAGE_HISTORY_LIMIT) {
      const page = await v2.message.list({
        sessionID: sessionId,
        limit: MESSAGE_PAGE_LIMIT,
        // The cursor carries the order it was minted with, and the server
        // rejects a request that states both.
        ...(cursor ? { cursor } : { order: 'desc' }),
      } as never, request) as unknown as { data?: V2Message[]; cursor?: { next?: string | null } }
      const rows = page?.data ?? []
      collected.push(...rows)
      const next = page?.cursor?.next
      if (!next || rows.length === 0) break
      cursor = next
    }
    return collected.reverse()
  }

  const readBundles = async (sessionId: string, request?: RequestOptions): Promise<OpenCodeMessageBundle[]> => {
    const messages = await readMessages(sessionId, request)
    return toV1MessageBundles(messages, { sessionId })
  }

  const listSessions = async (input: { directory?: string; limit?: number; parentID?: string | null }): Promise<OpenCodeSession[]> => {
    const wanted = Math.max(1, input.limit ?? SESSION_PAGE_LIMIT)
    const collected: V2SessionInfo[] = []
    let cursor: string | undefined
    while (collected.length < wanted) {
      const page = await v2.session.list({
        ...(input.directory ? { directory: input.directory } : {}),
        ...(input.parentID !== undefined ? { parentID: input.parentID } : {}),
        limit: Math.min(SESSION_PAGE_LIMIT, wanted - collected.length),
        ...(cursor ? { cursor } : {}),
      } as never) as unknown as { data?: V2SessionInfo[]; cursor?: { next?: string | null } }
      const rows = page?.data ?? []
      collected.push(...rows)
      const next = page?.cursor?.next
      if (!next || rows.length === 0) break
      cursor = next
    }
    return collected.map(toV1Session)
  }

  /** Model and agent are session properties in v2, not per-prompt arguments, so
   *  a turn that asks for either switches first. Only when it differs: every
   *  switch is recorded in the transcript, and re-sending the session's current
   *  model on each turn would write one of those per message. */
  const applySessionSelection = async (
    sessionId: string,
    selection: { model?: { providerID: string; modelID: string }; agent?: string },
  ): Promise<void> => {
    if (!selection.model && !selection.agent) return
    const session = await readSession(sessionId).catch(() => null)
    if (selection.model) {
      const current = session?.model
      if (!current || current.id !== selection.model.modelID || current.providerID !== selection.model.providerID) {
        await v2.session.switchModel({
          sessionID: sessionId,
          model: { id: selection.model.modelID, providerID: selection.model.providerID },
        } as never)
      }
    }
    if (selection.agent && session?.agent !== selection.agent) {
      await v2.session.switchAgent({ sessionID: sessionId, agent: selection.agent } as never)
    }
  }

  // v1 sends a prompt as a list of parts; v2 sends text plus typed attachments.
  const promptInputFrom = (parts: unknown): { text: string; files: Array<{ uri: string; name?: string }>; agents: Array<{ name: string }> } => {
    const text: string[] = []
    const files: Array<{ uri: string; name?: string }> = []
    const agents: Array<{ name: string }> = []
    for (const part of Array.isArray(parts) ? parts : []) {
      const entry = part as { type?: string; text?: string; url?: string; filename?: string; name?: string }
      if (entry.type === 'text' && typeof entry.text === 'string') text.push(entry.text)
      else if (entry.type === 'file' && typeof entry.url === 'string') {
        files.push({ uri: entry.url, ...(entry.filename ? { name: entry.filename } : {}) })
      } else if (entry.type === 'agent' && typeof entry.name === 'string') agents.push({ name: entry.name })
    }
    return { text: text.join('\n\n'), files, agents }
  }

  const readForms = async (directory: string | undefined): Promise<V2FormInfo[]> =>
    listOf<V2FormInfo>(await v2.form.list(locationInput(directory) as never))

  const session = {
    async get(input: unknown) {
      return toV1Session(await readSession(pathId(input), optionsFrom(input)))
    },
    async list(input: unknown) {
      const parameters = query<{ directory?: string; limit?: number }>(input)
      return listSessions(parameters)
    },
    async children(input: unknown) {
      return listSessions({ parentID: pathId(input), limit: SESSION_PAGE_LIMIT })
    },
    async messages(input: unknown) {
      return readBundles(pathId(input), optionsFrom(input))
    },
    async create(input: unknown) {
      const directory = query<{ directory?: string }>(input).directory
      const title = body<{ title?: string }>(input).title
      const created = await v2.session.create({
        ...(title ? { title } : {}),
        ...locationInput(directory),
      } as never) as unknown as V2SessionInfo
      return toV1Session(created)
    },
    async update(input: unknown) {
      const title = body<{ title?: string }>(input).title
      await v2.session.update({ sessionID: pathId(input), ...(title === undefined ? {} : { title }) } as never)
      return toV1Session(await readSession(pathId(input)))
    },
    async delete(input: unknown) {
      await v2.session.remove({ sessionID: pathId(input) } as never)
      return true
    },
    async fork(input: unknown) {
      // v1's `messageID` and v2's `before` are the same boundary: the fork
      // holds everything up to, and not including, that message.
      const messageID = body<{ messageID?: string }>(input).messageID
      const forked = await v2.session.fork({
        sessionID: pathId(input),
        ...(messageID ? { before: messageID } : {}),
      } as never) as unknown as V2SessionInfo
      return toV1Session(forked)
    },
    async promptAsync(input: unknown) {
      const sessionId = pathId(input)
      const request = body<{ model?: { providerID: string; modelID: string }; agent?: string; parts?: unknown }>(input)
      await applySessionSelection(sessionId, { model: request.model, agent: request.agent })
      const prompt = promptInputFrom(request.parts)
      await v2.session.prompt({
        sessionID: sessionId,
        text: prompt.text,
        ...(prompt.files.length > 0 ? { files: prompt.files } : {}),
        ...(prompt.agents.length > 0 ? { agents: prompt.agents } : {}),
      } as never)
      return true
    },
    async abort(input: unknown) {
      const result = await v2.session.interrupt({ sessionID: pathId(input) } as never) as unknown as { interrupted?: boolean }
      return result?.interrupted !== false
    },
    async shell(input: unknown) {
      const request = body<{ command?: string; agent?: string; model?: { providerID: string; modelID: string } }>(input)
      const sessionId = pathId(input)
      await applySessionSelection(sessionId, { model: request.model, agent: request.agent })
      await v2.session.shell({ sessionID: sessionId, command: request.command ?? '' } as never)
      return true
    },
    async command(input: unknown) {
      const request = body<{ command?: string; arguments?: string; agent?: string }>(input)
      const sessionId = pathId(input)
      await applySessionSelection(sessionId, { agent: request.agent })
      await v2.session.command({
        sessionID: sessionId,
        name: request.command ?? '',
        text: request.arguments ?? '',
      } as never)
      return true
    },
    async summarize(input: unknown) {
      // v1's summarize took an explicit model; v2 compacts with the session's.
      await v2.session.compact({ sessionID: pathId(input) } as never)
      return true
    },
    share() { return unsupported('Session sharing') },
    unshare() { return unsupported('Session sharing') },
    async revert(input: unknown) {
      const sessionId = pathId(input)
      const messageID = body<{ messageID?: string }>(input).messageID
      if (!messageID) throw new Error('messageID is required')
      // Staging is v1's revert: reversible until the next turn commits it,
      // which is exactly what `unrevert` undoes.
      await v2.session.revert.stage({ sessionID: sessionId, messageID, files: true } as never)
      return toV1Session(await readSession(sessionId))
    },
    async unrevert(input: unknown) {
      const sessionId = pathId(input)
      await v2.session.revert.clear({ sessionID: sessionId } as never)
      return toV1Session(await readSession(sessionId))
    },
    async diff(input: unknown) {
      const messageID = query<{ messageID?: string }>(input).messageID
      const diffs = listOf<{ file: string; patch?: string; additions?: number; deletions?: number }>(
        await v2.session.diff({
          sessionID: pathId(input),
          ...(messageID ? { from: messageID } : {}),
        } as never),
      )
      return diffs.map((diff) => ({
        file: diff.file,
        before: '',
        after: diff.patch ?? '',
        additions: diff.additions ?? 0,
        deletions: diff.deletions ?? 0,
      }))
    },
    async status() {
      const active = await v2.session.active() as unknown as Record<string, { type?: string }>
      const statuses: Record<string, { type: string }> = {}
      for (const [sessionId, state] of Object.entries(active ?? {})) {
        statuses[sessionId] = { type: state?.type === 'running' ? 'busy' : 'idle' }
      }
      return statuses
    },
    async todo(input: unknown) {
      return todosFromBundles(await readBundles(pathId(input), optionsFrom(input)))
    },
  }

  const eventStream = (translate: (event: unknown) => Array<{ directory: string; payload: unknown }>, wrap: boolean) =>
    (input?: unknown) => {
      const request = optionsFrom(input)
      const stream = (async function* () {
        for await (const event of v2.event.subscribe(request)) {
          for (const translated of translate(event)) {
            yield wrap ? { directory: translated.directory, payload: translated.payload } : translated.payload
          }
        }
      })()
      return Promise.resolve({ stream })
    }

  // One translator per client, because its state is the in-flight turns of the
  // server it is reading, and the harness holds a single connection.
  const translator = new OpenCode2EventTranslator()
  const translate = (event: unknown) => translator.translate(event as never)

  const client = {
    session,
    event: { subscribe: eventStream(translate, false) },
    global: { event: eventStream(translate, true) },
    app: {
      async agents(input: unknown) {
        const agents = listOf<{ name: string; description?: string; mode?: string; hidden?: boolean }>(
          await v2.agent.list(locationInput(query<{ directory?: string }>(input).directory) as never),
        )
        return agents.map((agent): OpenCodeAgent => ({
          name: agent.name,
          ...(agent.description ? { description: agent.description } : {}),
          mode: (agent.mode ?? 'primary') as OpenCodeAgent['mode'],
          builtIn: false,
          ...(agent.hidden ? { hidden: agent.hidden } : {}),
        } as OpenCodeAgent))
      },
    },
    command: {
      async list(input: unknown) {
        const commands = listOf<{ name: string; description?: string }>(
          await v2.command.list(locationInput(query<{ directory?: string }>(input).directory) as never),
        )
        return commands.map((command): OpenCodeCommand => ({
          name: command.name,
          ...(command.description ? { description: command.description } : {}),
          template: '',
        } as OpenCodeCommand))
      },
    },
    config: {
      async providers(input: unknown) {
        const directory = query<{ directory?: string }>(input).directory
        const [providerList, modelList, defaults] = await Promise.all([
          v2.provider.list(locationInput(directory) as never),
          v2.model.list(locationInput(directory) as never),
          v2.model.default(locationInput(directory) as never).catch(() => null),
        ])
        const providers = listOf<{ id: string; name?: string; activation?: string }>(providerList)
          .filter((provider) => provider.activation !== 'disabled')
        const models = listOf<{ id: string; providerID: string; name?: string; enabled?: boolean; capabilities?: { reasoning?: boolean } }>(modelList)
          .filter((model) => model.enabled !== false)
        const byProvider = new Map<string, Record<string, unknown>>()
        for (const model of models) {
          const entry = byProvider.get(model.providerID) ?? {}
          entry[model.id] = {
            id: model.id,
            providerID: model.providerID,
            name: model.name ?? model.id,
            capabilities: { reasoning: model.capabilities?.reasoning === true },
          }
          byProvider.set(model.providerID, entry)
        }
        const defaultModel = ((defaults as { data?: unknown } | null)?.data ?? defaults) as { id?: string; providerID?: string } | null
        return {
          providers: providers.map((provider) => ({
            id: provider.id,
            name: provider.name ?? provider.id,
            models: byProvider.get(provider.id) ?? {},
          })),
          default: defaultModel?.providerID && defaultModel.id
            ? { [defaultModel.providerID]: defaultModel.id }
            : {},
        }
      },
    },
    // v2 reports neither over its API. An empty list is the honest answer for a
    // diagnostics section; it is not an error, and never was one in v1 either.
    lsp: { status: async () => [] },
    formatter: { status: async () => [] },
    mcp: {
      async status(input: unknown) {
        const servers = listOf<{ name: string; status?: { status?: string; error?: string } }>(
          await v2.mcp.list(locationInput(query<{ directory?: string }>(input).directory) as never),
        )
        const statuses: Record<string, unknown> = {}
        for (const server of servers) {
          statuses[server.name] = server.status?.error
            ? { status: server.status.status ?? 'failed', error: server.status.error }
            : { status: server.status?.status ?? 'connected' }
        }
        return statuses
      },
    },
    async postSessionIdPermissionsPermissionId(input: unknown) {
      const path = (input as { path?: { id?: string; permissionID?: string } }).path
      const response = body<{ response?: string }>(input).response
      if (!path?.id || !path.permissionID) throw new Error('permissionId is required')
      await v2.permission.reply({
        sessionID: path.id,
        requestID: path.permissionID,
        decision: response ?? 'reject',
      } as never)
      return true
    },
  } as unknown as OpencodeClient

  const clientV2 = {
    session: {
      // The v2-flavoured signature the sidebar uses: options first, not a
      // `{ query }` envelope.
      async list(input?: { directory?: string; limit?: number }) {
        return listSessions(input ?? {})
      },
    },
    permission: {
      async list(input?: { directory?: string }) {
        const requests = listOf<V2PermissionRequest>(await v2.permission.request.list(locationInput(input?.directory) as never))
        return requests.map(toV1PermissionAsked)
      },
    },
    question: {
      async list(input?: { directory?: string }): Promise<QuestionRequest[]> {
        return (await readForms(input?.directory)).map(toV1Question)
      },
      async reply(input: { requestID: string; directory?: string; answers: string[][] }) {
        const form = (await readForms(input.directory)).find((entry) => entry.id === input.requestID)
        if (!form) throw new Error('Question is no longer pending')
        await v2.session.form.reply({
          sessionID: form.sessionID,
          formID: form.id,
          answer: toV2FormAnswer(form, input.answers),
        } as never)
        return true
      },
      async reject(input: { requestID: string; directory?: string }) {
        const form = (await readForms(input.directory)).find((entry) => entry.id === input.requestID)
        if (!form) throw new Error('Question is no longer pending')
        await v2.session.form.cancel({ sessionID: form.sessionID, formID: form.id } as never)
        return true
      },
    },
  } as unknown as OpencodeV2Client

  return { client, clientV2 }
}

export { OPENCODE_2_VERSION }
export type { V2Client }
