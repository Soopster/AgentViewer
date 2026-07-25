import {
  AhpErrorCodes,
  JsonRpcErrorCodes,
  type ActionEnvelope,
  type JsonRpcErrorResponse,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcSuccessResponse,
  type RootState,
  type SessionState,
  type SessionSummary,
  type Snapshot,
  type StateAction,
  type URI,
} from '@microsoft/agent-host-protocol'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createExternalProtocolRun,
  deleteProtocolRun,
  joinExternalProtocolRun,
  listProtocolRuns,
  readProtocolRun,
  resumeExternalProtocolParticipant,
} from './agentCoordination'
import { executeExternalCoordinatorAction } from './agentCoordinationExternal'
import {
  AHP_COORDINATOR_META_KEY,
  AHP_ROOT_CHANNEL,
  coordinatorChatParts,
  coordinatorRootState,
  coordinatorSessionState,
  coordinatorSessionSummary,
  coordinatorSessionUri,
  coordinatorSnapshotForChannel,
  runIdFromCoordinatorSessionUri,
} from './ahpCoordinator'
import type {
  ExternalProtocolIdentity,
  ProtocolRun,
  ProtocolRunSnapshot,
} from './agentProtocol'
import { isAgentProvider } from './provider'
import {
  AhpResourceAccess,
  AhpResourceError,
  isAhpResourceCommand,
} from './ahpResources'
import { AhpTerminalError, AhpTerminalManager } from './ahpTerminals'

export const AHP_PROTOCOL_VERSIONS = ['0.7.0', '0.6.0'] as const
export const AHP_COORDINATOR_REQUEST_METHOD = 'agent-viewer/coordinator'
const REPLAY_LIMIT = 1_000
const AHP_STATE_DIR = path.join(process.cwd(), '.agent-viewer-data', 'agent-coordination')
const AHP_CLIENTS_FILE = path.join(AHP_STATE_DIR, 'ahp-clients.json')

type JsonRpcId = number
type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification
type JsonRpcOutput = JsonRpcSuccessResponse | JsonRpcErrorResponse | JsonRpcNotification
type Send = (message: JsonRpcOutput) => void

type HostState = {
  runs: ProtocolRun[]
  snapshots: Map<string, ProtocolRunSnapshot>
}

type ConnectionRecord = {
  clientId: string
  protocolVersion: string
  subscriptions: Set<URI>
  identities: Map<string, ExternalProtocolIdentity>
}

type PersistedConnectionRecord = Omit<ConnectionRecord, 'subscriptions' | 'identities'> & {
  subscriptions: URI[]
  identities: ExternalProtocolIdentity[]
}

class AhpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'params must be an object')
  }
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function activeClientTools(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((tool) => {
        const item = tool && typeof tool === 'object' && !Array.isArray(tool)
          ? tool as Record<string, unknown>
          : {}
        return text(item.name) ? [text(item.name)] : []
      })
    : []
}

function requireRootChannel(params: Record<string, unknown>): void {
  if (params.channel !== AHP_ROOT_CHANNEL) {
    throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, `channel must be ${AHP_ROOT_CHANNEL}`)
  }
}

function filePathFromUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined
  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'file:') return undefined
    return decodeURIComponent(parsed.pathname)
  } catch {
    return undefined
  }
}

function sessionMeta(state: SessionState): Record<string, unknown> | undefined {
  return state._meta?.[AHP_COORDINATOR_META_KEY] as Record<string, unknown> | undefined
}

function stateAction(value: Record<string, unknown>): StateAction {
  return value as unknown as StateAction
}

function withoutResource(summary: SessionSummary): Partial<SessionSummary> {
  const { resource: _resource, ...changes } = summary
  return changes
}

function mapsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function loadHostState(): Promise<HostState> {
  const runs = await listProtocolRuns(100)
  const entries = await Promise.all(runs.map(async (run) => [run.id, await readProtocolRun(run.id)] as const))
  return {
    runs,
    snapshots: new Map(entries.flatMap(([runId, snapshot]) => snapshot ? [[runId, snapshot]] : [])),
  }
}

export class CoordinatorAhpHost {
  private serverSeq = 0
  private state: HostState = { runs: [], snapshots: new Map() }
  private initialized = false
  private refreshing: Promise<void> | null = null
  private readonly replay: ActionEnvelope[] = []
  private readonly connections = new Set<CoordinatorAhpConnection>()
  private readonly connectionRecords = new Map<string, ConnectionRecord>()
  private connectionRecordsLoaded = false
  private persistQueue: Promise<void> = Promise.resolve()
  private readonly disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private closing = false
  private readonly terminals = new AhpTerminalManager(
    (channel, action) => this.emitAction(channel, stateAction(action)),
    (terminals) => this.emitAction(AHP_ROOT_CHANNEL, stateAction({
      type: 'root/terminalsChanged',
      terminals,
    })),
  )

  createConnection(send: Send): CoordinatorAhpConnection {
    const connection = new CoordinatorAhpConnection(this, send)
    this.connections.add(connection)
    return connection
  }

  close(): void {
    this.closing = true
    for (const timer of this.disconnectTimers.values()) clearTimeout(timer)
    this.disconnectTimers.clear()
    for (const connection of [...this.connections]) connection.close()
    this.terminals.close()
  }

  removeConnection(connection: CoordinatorAhpConnection): void {
    this.connections.delete(connection)
  }

  clientIdInUse(clientId: string, except: CoordinatorAhpConnection): boolean {
    return [...this.connections].some((connection) => (
      connection !== except && connection.usesClientId(clientId)
    ))
  }

  hasConnectedClient(clientId: string): boolean {
    return [...this.connections].some((connection) => connection.usesClientId(clientId))
  }

  cancelDisconnect(clientId: string): void {
    const timer = this.disconnectTimers.get(clientId)
    if (timer) clearTimeout(timer)
    this.disconnectTimers.delete(clientId)
  }

  connectionClosed(clientId: string, identities: Map<string, ExternalProtocolIdentity>): void {
    if (
      this.closing
      || !clientId
      || identities.size === 0
      || this.hasConnectedClient(clientId)
    ) return
    this.cancelDisconnect(clientId)
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(clientId)
      void (async () => {
        for (const identity of identities.values()) {
          try {
            await resumeExternalProtocolParticipant(identity, {
              capabilities: { sessionResume: true, tools: [] },
            })
          } catch {
            // The run may have been disposed while the reconnect grace elapsed.
          }
        }
        await this.refresh()
      })()
    }, 5_000)
    timer.unref?.()
    this.disconnectTimers.set(clientId, timer)
  }

  currentSeq(): number {
    return this.serverSeq
  }

  currentState(): HostState {
    return this.state
  }

  snapshotForChannel(channel: string): Snapshot | null {
    const snapshot = coordinatorSnapshotForChannel(
      channel,
      this.state.runs,
      this.state.snapshots,
      this.serverSeq,
    )
    if (snapshot?.resource === AHP_ROOT_CHANNEL) {
      return {
        ...snapshot,
        state: {
          ...(snapshot.state as RootState),
          terminals: this.terminals.infos(),
        },
      }
    }
    return snapshot ?? this.terminals.snapshot(channel, this.serverSeq)
  }

  createTerminal(params: Record<string, unknown>, clientId: string, cwd?: string): null {
    return this.terminals.create(params, clientId, cwd)
  }

  disposeTerminal(channel: string): null {
    return this.terminals.dispose(channel)
  }

  dispatchTerminal(
    channel: string,
    action: Record<string, unknown>,
    clientId: string,
  ): string | undefined {
    return this.terminals.dispatch(channel, action, clientId)
  }

  hasTerminal(channel: string): boolean {
    return this.terminals.has(channel)
  }

  async rememberConnection(recordValue: ConnectionRecord): Promise<void> {
    this.connectionRecords.set(recordValue.clientId, recordValue)
    this.persistQueue = this.persistQueue.then(() => this.persistConnectionRecords())
    await this.persistQueue
  }

  previousConnection(clientId: string): ConnectionRecord | undefined {
    return this.connectionRecords.get(clientId)
  }

  async ensureLoaded(): Promise<void> {
    if (this.initialized) return
    await this.loadConnectionRecords()
    this.state = await loadHostState()
    this.initialized = true
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    this.refreshing = this.refreshInternal().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async refreshInternal(): Promise<void> {
    await this.ensureLoaded()
    const previous = this.state
    const next = await loadHostState()
    this.state = next

    const previousRuns = new Map(previous.runs.map((run) => [run.id, run]))
    const nextRuns = new Map(next.runs.map((run) => [run.id, run]))

    for (const run of next.runs) {
      if (!previousRuns.has(run.id)) {
        this.broadcastProtocolNotification('root/sessionAdded', {
          channel: AHP_ROOT_CHANNEL,
          summary: coordinatorSessionSummary(run),
        })
      }
    }
    for (const run of previous.runs) {
      if (!nextRuns.has(run.id)) {
        this.broadcastProtocolNotification('root/sessionRemoved', {
          channel: AHP_ROOT_CHANNEL,
          session: coordinatorSessionUri(run.id),
        })
      }
    }

    const previousActive = previous.runs.length
    const nextActive = next.runs.length
    if (previousActive !== nextActive) {
      this.emitAction(AHP_ROOT_CHANNEL, stateAction({
        type: 'root/activeSessionsChanged',
        activeSessions: nextActive,
      }))
    }

    for (const run of next.runs) {
      const beforeRun = previousRuns.get(run.id)
      const beforeSnapshot = previous.snapshots.get(run.id)
      const afterSnapshot = next.snapshots.get(run.id)
      if (!beforeRun || !beforeSnapshot || !afterSnapshot || mapsEqual(beforeSnapshot, afterSnapshot)) continue

      const channel = coordinatorSessionUri(run.id)
      const beforeState = coordinatorSessionState(beforeSnapshot)
      const afterState = coordinatorSessionState(afterSnapshot)
      this.emitAction(channel, stateAction({
        type: 'session/metaChanged',
        _meta: afterState._meta,
      }))

      if (beforeState.title !== afterState.title) {
        this.emitAction(channel, stateAction({ type: 'session/titleChanged', title: afterState.title }))
      }
      if (beforeState.activity !== afterState.activity) {
        this.emitAction(channel, stateAction({ type: 'session/activityChanged', activity: afterState.activity }))
      }

      const beforeChats = new Map(beforeState.chats.map((chat) => [chat.resource, chat]))
      const afterChats = new Map(afterState.chats.map((chat) => [chat.resource, chat]))
      for (const [resource, chat] of afterChats) {
        const prior = beforeChats.get(resource)
        if (!prior) {
          this.emitAction(channel, stateAction({ type: 'session/chatAdded', summary: chat }))
        } else if (!mapsEqual(prior, chat)) {
          const { resource: _resource, ...changes } = chat
          this.emitAction(channel, stateAction({ type: 'session/chatUpdated', chat: resource, changes }))
        }
      }
      for (const resource of beforeChats.keys()) {
        if (!afterChats.has(resource)) {
          this.emitAction(channel, stateAction({ type: 'session/chatRemoved', chat: resource }))
        }
      }

      const beforeClients = new Map(beforeState.activeClients.map((client) => [client.clientId, client]))
      const afterClients = new Map(afterState.activeClients.map((client) => [client.clientId, client]))
      for (const [clientId, activeClient] of afterClients) {
        if (!mapsEqual(beforeClients.get(clientId), activeClient)) {
          this.emitAction(channel, stateAction({ type: 'session/activeClientSet', activeClient }))
        }
      }
      for (const clientId of beforeClients.keys()) {
        if (!afterClients.has(clientId)) {
          this.emitAction(channel, stateAction({ type: 'session/activeClientRemoved', clientId }))
        }
      }

      this.broadcastProtocolNotification('root/sessionSummaryChanged', {
        channel: AHP_ROOT_CHANNEL,
        session: channel,
        changes: withoutResource(coordinatorSessionSummary(run)),
      })
    }
  }

  emitAction(channel: URI, action: StateAction, origin?: { clientId: string; clientSeq: number }, rejectionReason?: string): ActionEnvelope {
    const envelope = {
      channel,
      action,
      serverSeq: ++this.serverSeq,
      origin,
      ...(rejectionReason ? { rejectionReason } : {}),
    } as ActionEnvelope
    this.replay.push(envelope)
    if (this.replay.length > REPLAY_LIMIT) this.replay.splice(0, this.replay.length - REPLAY_LIMIT)
    for (const connection of this.connections) connection.deliverAction(envelope)
    return envelope
  }

  replayAfter(lastSeenServerSeq: number, subscriptions: Set<URI>): ActionEnvelope[] | null {
    if (lastSeenServerSeq > this.serverSeq) return null
    const first = this.replay[0]?.serverSeq
    // A cold host has no proof that it retained the caller's gap. Force fresh
    // snapshots instead of claiming a successful empty replay.
    if (first === undefined && lastSeenServerSeq !== this.serverSeq) return null
    if (first !== undefined && lastSeenServerSeq < first - 1) return null
    return this.replay.filter((action) => (
      action.serverSeq > lastSeenServerSeq && subscriptions.has(action.channel)
    ))
  }

  broadcastProtocolNotification(method: string, params: Record<string, unknown>): void {
    for (const connection of this.connections) connection.deliverProtocolNotification(method, params)
  }

  private async loadConnectionRecords(): Promise<void> {
    if (this.connectionRecordsLoaded) return
    this.connectionRecordsLoaded = true
    const parsed = await readFile(AHP_CLIENTS_FILE, 'utf8')
      .then((value) => JSON.parse(value) as unknown)
      .catch(() => null)
    if (!Array.isArray(parsed)) return
    for (const value of parsed) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const item = value as Record<string, unknown>
      const clientId = text(item.clientId)
      const protocolVersion = text(item.protocolVersion)
      if (!clientId || !(AHP_PROTOCOL_VERSIONS as readonly string[]).includes(protocolVersion)) continue
      this.connectionRecords.set(clientId, {
        clientId,
        protocolVersion,
        subscriptions: new Set(stringArray(item.subscriptions) as URI[]),
        identities: new Map(
          Array.isArray(item.identities)
            ? item.identities.flatMap((identity) => {
                if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return []
                const candidate = identity as Record<string, unknown>
                const runId = text(candidate.runId)
                const agentId = text(candidate.agentId)
                const token = text(candidate.token)
                return runId && agentId && token
                  ? [[runId, { runId, agentId, token } as ExternalProtocolIdentity] as const]
                  : []
              })
            : [],
        ),
      })
    }
  }

  private async persistConnectionRecords(): Promise<void> {
    await mkdir(AHP_STATE_DIR, { recursive: true })
    const records: PersistedConnectionRecord[] = [...this.connectionRecords.values()].map((recordValue) => ({
      clientId: recordValue.clientId,
      protocolVersion: recordValue.protocolVersion,
      subscriptions: [...recordValue.subscriptions],
      identities: [...recordValue.identities.values()],
    }))
    const temporary = `${AHP_CLIENTS_FILE}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, AHP_CLIENTS_FILE)
  }
}

export class CoordinatorAhpConnection {
  private initialized = false
  private closed = false
  private clientId = ''
  private clientName = 'AHP client'
  private protocolVersion = ''
  private readonly subscriptions = new Set<URI>()
  private readonly identities = new Map<string, ExternalProtocolIdentity>()
  private readonly resources: AhpResourceAccess

  constructor(
    private readonly host: CoordinatorAhpHost,
    private readonly send: Send,
  ) {
    this.resources = new AhpResourceAccess(
      async () => {
        await this.host.ensureLoaded()
        const state = this.host.currentState()
        return [
          process.cwd(),
          ...state.runs.map((run) => run.baseCwd),
          ...[...state.snapshots.values()].flatMap((snapshot) =>
            snapshot.agents.map((agent) => agent.worktreePath)),
        ]
      },
      (channel, action) => {
        this.host.emitAction(channel as URI, stateAction(action))
      },
    )
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.resources.close()
    this.host.removeConnection(this)
    this.host.connectionClosed(this.clientId, new Map(this.identities))
  }

  usesClientId(clientId: string): boolean {
    return this.initialized && !this.closed && this.clientId === clientId
  }

  deliverAction(envelope: ActionEnvelope): void {
    if (!this.subscriptions.has(envelope.channel)) return
    this.send({
      jsonrpc: '2.0',
      method: 'action',
      params: envelope,
    })
  }

  deliverProtocolNotification(method: string, params: Record<string, unknown>): void {
    const channel = text(params.channel)
    if (!channel || !this.subscriptions.has(channel)) return
    this.send({ jsonrpc: '2.0', method, params })
  }

  async handle(message: JsonRpcMessage): Promise<void> {
    if (this.closed) return
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      if ('id' in message) this.sendError(message.id, JsonRpcErrorCodes.InvalidRequest, 'Invalid JSON-RPC request')
      return
    }
    if (!('id' in message)) {
      await this.handleNotification(message).catch(() => {})
      return
    }
    try {
      const result = await this.handleRequest(message.method, message.params)
      if (!this.closed) this.send({ jsonrpc: '2.0', id: message.id, result })
    } catch (error) {
      if (this.closed) return
      if (error instanceof AhpRpcError || error instanceof AhpResourceError || error instanceof AhpTerminalError) {
        this.sendError(message.id, error.code, error.message, error.data)
      } else {
        this.sendError(
          message.id,
          JsonRpcErrorCodes.InternalError,
          error instanceof Error ? error.message : 'AHP host error',
        )
      }
    }
  }

  private sendError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
    this.send({
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    })
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new AhpRpcError(JsonRpcErrorCodes.InvalidRequest, 'initialize must be the first request')
    }
  }

  private remember(): Promise<void> {
    return this.host.rememberConnection({
      clientId: this.clientId,
      protocolVersion: this.protocolVersion,
      subscriptions: new Set(this.subscriptions),
      identities: new Map(this.identities),
    })
  }

  private async deactivateIdentity(runId: string): Promise<void> {
    const identity = this.identities.get(runId)
    if (!identity) return
    await resumeExternalProtocolParticipant(identity, {
      client: { name: this.clientName, protocolVersion: 2 },
      capabilities: { sessionResume: true, tools: [] },
    })
  }

  private async handleRequest(method: string, rawParams: unknown): Promise<unknown> {
    const params = record(rawParams ?? {})
    if (method === 'ping') {
      requireRootChannel(params)
      return null
    }
    if (method === 'initialize') return this.initialize(params)
    if (method === 'reconnect') return this.reconnect(params)
    this.requireInitialized()
    await this.host.refresh()

    if (method === 'subscribe') return this.subscribe(params)
    if (method === AHP_COORDINATOR_REQUEST_METHOD) return this.coordinatorRequest(params)
    if (method === 'listSessions') return this.listSessions(params)
    if (method === 'createSession') return this.createSession(params)
    if (method === 'disposeSession') return this.disposeSession(params)
    if (method === 'createTerminal') return this.createTerminal(params)
    if (method === 'disposeTerminal') return this.host.disposeTerminal(text(params.channel))
    if (isAhpResourceCommand(method)) return this.resources.handle(method, params)
    if (method === 'fetchTurns') return this.fetchTurns(params)
    if (method === 'completions') return this.completions(params)
    if (method === 'resolveSessionConfig') {
      requireRootChannel(params)
      return {
        schema: {
          type: 'object',
          properties: {
            objective: { type: 'string', title: 'Workflow objective' },
            maxAgents: { type: 'number', title: 'Maximum agents', minimum: 2, maximum: 16 },
          },
        },
        values: params.config && typeof params.config === 'object' ? params.config : {},
      }
    }
    if (method === 'sessionConfigCompletions') {
      requireRootChannel(params)
      return { items: [] }
    }
    if (method === 'authenticate') {
      requireRootChannel(params)
      throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'This host has not advertised any protected resources')
    }

    // These capability-gated channel families are deliberately not advertised
    // by the Coordinator host. Returning MethodNotFound is the JSON-RPC
    // behavior required for a method unavailable on this host.
    throw new AhpRpcError(JsonRpcErrorCodes.MethodNotFound, `Unsupported AHP method: ${method}`)
  }

  private async initialize(params: Record<string, unknown>): Promise<unknown> {
    if (this.initialized) {
      throw new AhpRpcError(JsonRpcErrorCodes.InvalidRequest, 'connection is already initialized')
    }
    requireRootChannel(params)
    const offered = stringArray(params.protocolVersions)
    const selected = offered.find((version) => (AHP_PROTOCOL_VERSIONS as readonly string[]).includes(version))
    if (!selected) {
      throw new AhpRpcError(
        AhpErrorCodes.UnsupportedProtocolVersion,
        'No mutually supported AHP protocol version',
        { supportedVersions: [...AHP_PROTOCOL_VERSIONS] },
      )
    }
    const clientId = text(params.clientId)
    if (!clientId) throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'clientId is required')
    if (this.host.clientIdInUse(clientId, this)) {
      throw new AhpRpcError(JsonRpcErrorCodes.InvalidRequest, `clientId is already connected: ${clientId}`)
    }
    const clientInfo = params.clientInfo && typeof params.clientInfo === 'object'
      ? params.clientInfo as Record<string, unknown>
      : {}
    this.clientId = clientId
    this.clientName = text(clientInfo.title) || text(clientInfo.name) || clientId
    this.protocolVersion = selected
    this.initialized = true
    await this.host.ensureLoaded()
    const previous = this.host.previousConnection(clientId)
    this.identities.clear()
    for (const [runId, identity] of previous?.identities ?? []) {
      this.identities.set(runId, identity)
    }
    this.host.cancelDisconnect(clientId)

    const requested = stringArray(params.initialSubscriptions)
    for (const runId of this.identities.keys()) {
      if (!requested.includes(coordinatorSessionUri(runId))) {
        await this.deactivateIdentity(runId)
      }
    }
    await this.host.refresh()
    const snapshots: Snapshot[] = []
    for (const channel of requested) {
      const snapshot = this.host.snapshotForChannel(channel)
      if (!snapshot) continue
      this.subscriptions.add(channel)
      snapshots.push(snapshot)
    }
    await this.remember()
    return {
      protocolVersion: selected,
      serverSeq: this.host.currentSeq(),
      serverInfo: {
        name: 'agent-viewer',
        version: '0.1.0',
        title: 'Agent Viewer Coordinator',
      },
      defaultDirectory: pathToFileURL(process.cwd()).href,
      snapshots,
    }
  }

  private async coordinatorRequest(params: Record<string, unknown>): Promise<unknown> {
    requireRootChannel(params)
    const action = text(params.action)
    const payload = params.payload && typeof params.payload === 'object' && !Array.isArray(params.payload)
      ? params.payload as Record<string, unknown>
      : {}
    const client = payload.client && typeof payload.client === 'object' && !Array.isArray(payload.client)
      ? payload.client as Record<string, unknown>
      : {}
    const capabilities = payload.capabilities && typeof payload.capabilities === 'object' && !Array.isArray(payload.capabilities)
      ? payload.capabilities as Record<string, unknown>
      : {}
    const result = await executeExternalCoordinatorAction({
      ...payload,
      action,
      client: {
        ...client,
        name: text(client.name) || this.clientName,
        protocolVersion: Number(client.protocolVersion) || 2,
      },
      capabilities: {
        ...capabilities,
        ahpClientId: this.clientId,
        sessionResume: capabilities.sessionResume !== false,
      },
    })
    if (['create_run', 'join_run', 'resume'].includes(action)) {
      const participant = result && typeof result === 'object' && !Array.isArray(result)
        ? (result as Record<string, unknown>).participant
        : null
      if (participant && typeof participant === 'object' && !Array.isArray(participant)) {
        const candidate = participant as Record<string, unknown>
        const runId = text(candidate.runId)
        const agentId = text(candidate.agentId)
        const token = text(candidate.token)
        if (runId && agentId && token) {
          this.identities.set(runId, { runId, agentId, token })
          await this.remember()
        }
      }
    }
    await this.host.refresh()
    return result
  }

  private async reconnect(params: Record<string, unknown>): Promise<unknown> {
    requireRootChannel(params)
    const clientId = text(params.clientId)
    if (!clientId) throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'clientId is required')
    if (this.host.clientIdInUse(clientId, this)) {
      throw new AhpRpcError(JsonRpcErrorCodes.InvalidRequest, `clientId is already connected: ${clientId}`)
    }
    const subscriptions = new Set(stringArray(params.subscriptions) as URI[])
    const lastSeenServerSeq = Number(params.lastSeenServerSeq)
    if (!Number.isSafeInteger(lastSeenServerSeq) || lastSeenServerSeq < 0) {
      throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'lastSeenServerSeq must be a non-negative integer')
    }
    await this.host.ensureLoaded()
    this.host.cancelDisconnect(clientId)
    const previous = this.host.previousConnection(clientId)
    this.initialized = true
    this.clientId = clientId
    this.protocolVersion = previous?.protocolVersion ?? AHP_PROTOCOL_VERSIONS[0]
    this.identities.clear()
    for (const [runId, identity] of previous?.identities ?? []) {
      this.identities.set(runId, identity)
    }
    this.subscriptions.clear()
    const validSubscriptions = new Set<URI>()
    const missing: URI[] = []
    for (const channel of subscriptions) {
      const snapshot = this.host.snapshotForChannel(channel)
      if (snapshot) validSubscriptions.add(channel)
      else missing.push(channel)
    }
    for (const runId of this.identities.keys()) {
      if (!validSubscriptions.has(coordinatorSessionUri(runId))) {
        await this.deactivateIdentity(runId)
      }
    }
    await this.host.refresh()
    for (const channel of validSubscriptions) this.subscriptions.add(channel)
    const replay = this.host.replayAfter(lastSeenServerSeq, this.subscriptions)
    await this.remember()
    if (replay) return { type: 'replay', actions: replay, missing }
    const snapshots = [...this.subscriptions].flatMap((channel) => {
      const snapshot = this.host.snapshotForChannel(channel)
      return snapshot ? [snapshot] : []
    })
    return { type: 'snapshot', snapshots }
  }

  private async subscribe(params: Record<string, unknown>): Promise<unknown> {
    const channel = text(params.channel)
    if (!channel) throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'channel is required')
    const resourceWatchSnapshot = await this.resources.subscribe(channel, this.host.currentSeq())
    if (resourceWatchSnapshot) {
      this.subscriptions.add(channel)
      await this.remember()
      return { snapshot: resourceWatchSnapshot }
    }
    const snapshot = this.host.snapshotForChannel(channel)
    if (!snapshot) {
      const code = channel.startsWith('ahp-session:') || channel.startsWith('ahp-chat:')
        ? AhpErrorCodes.SessionNotFound
        : AhpErrorCodes.NotFound
      throw new AhpRpcError(code, `Channel not found: ${channel}`)
    }
    this.subscriptions.add(channel)
    await this.remember()
    return { snapshot }
  }

  private listSessions(params: Record<string, unknown>): unknown {
    requireRootChannel(params)
    const rawLimit = Number(params.limit)
    const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 100
    let offset = 0
    if (params.cursor !== undefined) {
      try {
        const decoded = JSON.parse(Buffer.from(text(params.cursor), 'base64url').toString('utf8')) as { offset?: unknown }
        if (!Number.isSafeInteger(decoded.offset) || Number(decoded.offset) < 0) throw new Error('invalid')
        offset = Number(decoded.offset)
      } catch {
        throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'Unrecognized listSessions cursor')
      }
    }
    const items = this.host.currentState().runs
      .slice(offset, offset + limit)
      .map(coordinatorSessionSummary)
    const nextOffset = offset + items.length
    return {
      items,
      ...(nextOffset < this.host.currentState().runs.length
        ? { nextCursor: Buffer.from(JSON.stringify({ offset: nextOffset })).toString('base64url') }
        : {}),
    }
  }

  private requireChat(channel: string): void {
    const chat = coordinatorChatParts(channel)
    const snapshot = chat ? this.host.currentState().snapshots.get(chat.runId) : undefined
    if (!chat || !snapshot?.agents.some((agent) => agent.id === chat.agentId)) {
      throw new AhpRpcError(AhpErrorCodes.SessionNotFound, `Chat not found: ${channel || '(missing)'}`)
    }
  }

  private fetchTurns(params: Record<string, unknown>): Record<string, never> {
    const channel = text(params.channel)
    this.requireChat(channel)
    if (params.cursor !== undefined) {
      throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'This chat has no older turn page for the supplied cursor')
    }
    return {}
  }

  private completions(params: Record<string, unknown>): { items: [] } {
    const channel = text(params.channel)
    this.requireChat(channel)
    if (params.kind !== 'userMessage') {
      throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'kind must be userMessage')
    }
    if (typeof params.text !== 'string') {
      throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'text must be a string')
    }
    const offset = Number(params.offset)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > params.text.length) {
      throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'offset must be within text')
    }
    return { items: [] }
  }

  private async createTerminal(params: Record<string, unknown>): Promise<null> {
    const cwdUri = text(params.cwd) || pathToFileURL(process.cwd()).href
    const cwd = await this.resources.authorize(cwdUri, 'read')
    const claim = params.claim && typeof params.claim === 'object' && !Array.isArray(params.claim)
      ? params.claim as Record<string, unknown>
      : {}
    if (claim.kind === 'session') {
      const runId = runIdFromCoordinatorSessionUri(text(claim.session))
      if (!runId || !this.host.currentState().snapshots.has(runId)) {
        throw new AhpRpcError(AhpErrorCodes.SessionNotFound, 'Terminal claim references an unknown session')
      }
    }
    return this.host.createTerminal({ ...params, cwd: cwdUri }, this.clientId, cwd.canonical ?? cwd.requested)
  }

  private async createSession(params: Record<string, unknown>): Promise<null> {
    const runId = runIdFromCoordinatorSessionUri(text(params.channel))
    if (!runId) throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'channel must be ahp-session:/<uuid>')
    if (this.host.currentState().snapshots.has(runId)) {
      throw new AhpRpcError(AhpErrorCodes.SessionAlreadyExists, 'Session already exists')
    }
    const provider = text(params.provider)
    if (!isAgentProvider(provider)) {
      throw new AhpRpcError(AhpErrorCodes.ProviderNotFound, `No Agent Viewer provider: ${provider || '(missing)'}`)
    }
    if (params.fork) {
      throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'Coordinator sessions do not advertise session forking')
    }
    const config = params.config && typeof params.config === 'object' && !Array.isArray(params.config)
      ? params.config as Record<string, unknown>
      : {}
    const activeClient = params.activeClient && typeof params.activeClient === 'object' && !Array.isArray(params.activeClient)
      ? params.activeClient as Record<string, unknown>
      : undefined
    if (activeClient && text(activeClient.clientId) !== this.clientId) {
      throw new AhpRpcError(JsonRpcErrorCodes.InvalidParams, 'activeClient.clientId must match initialize.clientId')
    }
    const workingDirectories = stringArray(params.workingDirectories)
    const cwd = filePathFromUri(text(params.workingDirectory) || workingDirectories[0]) || process.cwd()
    const maxAgentsValue = Number(config.maxAgents)
    const result = await createExternalProtocolRun({
      runId,
      prompt: text(config.objective) || 'AHP multi-agent Coordinator session',
      baseCwd: cwd,
      provider,
      participantName: text(activeClient?.displayName) || this.clientName,
      client: {
        name: this.clientName,
        protocolVersion: 2,
      },
      capabilities: {
        ahpClientId: this.clientId,
        sessionResume: true,
        tools: activeClientTools(activeClient?.tools),
      },
      maxAgents: Number.isSafeInteger(maxAgentsValue) ? maxAgentsValue : undefined,
    })
    this.identities.set(runId, result.participant)
    await this.remember()
    await this.host.refresh()
    return null
  }

  private async disposeSession(params: Record<string, unknown>): Promise<null> {
    const runId = runIdFromCoordinatorSessionUri(text(params.channel))
    if (!runId || !this.host.currentState().snapshots.has(runId)) {
      throw new AhpRpcError(AhpErrorCodes.SessionNotFound, 'Session not found')
    }
    await deleteProtocolRun(runId)
    this.identities.delete(runId)
    this.subscriptions.delete(coordinatorSessionUri(runId))
    await this.remember()
    await this.host.refresh()
    return null
  }

  private async handleNotification(message: JsonRpcNotification): Promise<void> {
    if (message.method === 'unsubscribe') {
      const params = record(message.params ?? {})
      const channel = text(params.channel)
      if (channel) {
        this.subscriptions.delete(channel)
        this.resources.unsubscribe(channel)
        const runId = runIdFromCoordinatorSessionUri(channel)
        if (runId) {
          await this.deactivateIdentity(runId)
          await this.host.refresh()
        }
      }
      if (this.clientId) {
        await this.remember()
      }
      return
    }
    if (message.method !== 'dispatchAction' || !this.initialized) return
    const params = record(message.params ?? {})
    const channel = text(params.channel)
    const clientSeq = Number(params.clientSeq)
    const action = params.action && typeof params.action === 'object' && !Array.isArray(params.action)
      ? params.action as Record<string, unknown>
      : null
    if (!channel || !Number.isSafeInteger(clientSeq) || !action || !text(action.type)) return

    if (this.host.hasTerminal(channel)) {
      const rejectionReason = this.host.dispatchTerminal(channel, action, this.clientId)
      this.host.emitAction(
        channel,
        stateAction(action),
        { clientId: this.clientId, clientSeq },
        rejectionReason,
      )
      return
    }

    if (action.type === 'session/activeClientSet') {
      const runId = runIdFromCoordinatorSessionUri(channel)
      const snapshot = runId ? this.host.currentState().snapshots.get(runId) : undefined
      const activeClient = action.activeClient && typeof action.activeClient === 'object'
        ? action.activeClient as Record<string, unknown>
        : {}
      if (!runId || !snapshot || text(activeClient.clientId) !== this.clientId) {
        this.host.emitAction(channel, stateAction(action), { clientId: this.clientId, clientSeq }, 'Invalid active client or session')
        return
      }
      if (!this.identities.has(runId)) {
        try {
          const joined = await joinExternalProtocolRun({
            runId,
            provider: snapshot.run.provider,
            participantName: text(activeClient.displayName) || this.clientName,
            cwd: snapshot.run.baseCwd,
            client: { name: this.clientName, protocolVersion: 2 },
            capabilities: {
              ahpClientId: this.clientId,
              sessionResume: true,
              tools: activeClientTools(activeClient.tools),
            },
          })
          this.identities.set(runId, joined.participant)
          await this.remember()
          await this.host.refresh()
        } catch (error) {
          this.host.emitAction(
            channel,
            stateAction(action),
            { clientId: this.clientId, clientSeq },
            error instanceof Error ? error.message : 'Unable to join Coordinator run',
          )
        }
        return
      }
      try {
        await resumeExternalProtocolParticipant(this.identities.get(runId)!, {
          client: { name: this.clientName, protocolVersion: 2 },
          capabilities: {
            ahpClientId: this.clientId,
            sessionResume: true,
            tools: activeClientTools(activeClient.tools),
          },
        })
        await this.host.refresh()
      } catch (error) {
        this.host.emitAction(
          channel,
          stateAction(action),
          { clientId: this.clientId, clientSeq },
          error instanceof Error ? error.message : 'Unable to refresh active client',
        )
        return
      }
      this.host.emitAction(channel, stateAction(action), { clientId: this.clientId, clientSeq })
      return
    }

    if (action.type === 'session/activeClientRemoved') {
      const runId = runIdFromCoordinatorSessionUri(channel)
      const identity = runId ? this.identities.get(runId) : undefined
      if (!runId || text(action.clientId) !== this.clientId) {
        this.host.emitAction(channel, stateAction(action), { clientId: this.clientId, clientSeq }, 'Invalid active client or session')
        return
      }
      if (identity) {
        try {
          await resumeExternalProtocolParticipant(identity, {
            client: { name: this.clientName, protocolVersion: 2 },
            capabilities: { sessionResume: true, tools: [] },
          })
          await this.host.refresh()
        } catch (error) {
          this.host.emitAction(
            channel,
            stateAction(action),
            { clientId: this.clientId, clientSeq },
            error instanceof Error ? error.message : 'Unable to leave active clients',
          )
          return
        }
      }
      this.host.emitAction(channel, stateAction(action), { clientId: this.clientId, clientSeq })
      return
    }

    // The Coordinator workflow state is server-authoritative. Unsupported
    // write-ahead actions are still echoed, with the standard rejection field,
    // so optimistic clients reconcile instead of waiting indefinitely.
    this.host.emitAction(
      channel,
      stateAction(action),
      { clientId: this.clientId, clientSeq },
      `Action ${text(action.type)} is not writable on the Coordinator projection`,
    )
  }
}
