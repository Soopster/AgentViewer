import { randomUUID } from 'node:crypto'

const ROOT_CHANNEL = 'ahp-root://'
const COORDINATOR_METHOD = 'agent-viewer/coordinator'
const SAFE_RETRY_ACTIONS = new Set(['list_playbooks', 'list_runs', 'resume', 'status', 'wait'])
const IDEMPOTENT_RETRY_ACTIONS = new Set([
  'claim_task',
  'complete_task',
  'create_task',
  'fail_task',
  'finalize_run',
  'finding',
  'handoff_task',
  'leave_run',
  'progress',
  'read_inbox',
  'release_task',
  'request_locks',
  'review_plan',
  'save_playbook',
  'send_message',
  'submit_plan',
])

function transportClosedError() {
  const error = new Error('AHP WebSocket closed')
  error.code = 'AHP_TRANSPORT_CLOSED'
  return error
}

function requestTimeoutError(method) {
  const error = new Error(`AHP request timed out: ${method}`)
  error.code = 'AHP_REQUEST_TIMEOUT'
  return error
}

export function coordinatorTransport() {
  return process.env.AGENT_VIEWER_COORD_TRANSPORT?.trim().toLowerCase() === 'http'
    ? 'http'
    : 'ahp'
}

export function deriveAhpUrl(attachUrl) {
  const configured = process.env.AGENT_VIEWER_AHP_URL?.trim()
  if (configured) return configured
  const url = new URL(attachUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.port = String((Number(url.port) || (url.protocol === 'wss:' ? 443 : 80)) + 1)
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.href
}

export class CoordinatorAhpClient {
  constructor({ attachUrl, clientId = `agent-viewer-${randomUUID()}`, title = 'Agent Viewer Coordinator client' }) {
    this.url = deriveAhpUrl(attachUrl)
    this.clientId = clientId
    this.title = title
    this.socket = null
    this.connecting = null
    this.nextId = 0
    this.pending = new Map()
    this.connectedOnce = false
    this.lastSeenServerSeq = 0
    this.subscriptions = new Set([ROOT_CHANNEL])
  }

  async request(action, payload = {}, timeoutMs = 10_000, signal) {
    signal?.throwIfAborted?.()
    await this.ensureConnected()
    signal?.throwIfAborted?.()
    const params = {
      channel: ROOT_CHANNEL,
      action,
      payload,
    }
    let result
    try {
      result = await this.sendRequest(COORDINATOR_METHOD, params, timeoutMs)
    } catch (error) {
      // Supervisor shutdown deliberately closes the transport to unblock an
      // in-flight long poll. Do not reconnect for another full wait.
      signal?.throwIfAborted?.()
      const retryableFailure = error?.code === 'AHP_TRANSPORT_CLOSED'
        || error?.code === 'AHP_REQUEST_TIMEOUT'
      const retryable = retryableFailure
        && (
          SAFE_RETRY_ACTIONS.has(action)
          || (IDEMPOTENT_RETRY_ACTIONS.has(action) && typeof payload.requestId === 'string' && payload.requestId)
          || (action === 'read_inbox' && payload.acknowledge === false)
        )
      if (!retryable) throw error
      await this.ensureConnected()
      signal?.throwIfAborted?.()
      result = await this.sendRequest(COORDINATOR_METHOD, params, timeoutMs)
    }
    await this.rememberRunSubscription(result)
    return result
  }

  close() {
    const socket = this.socket
    if (!socket) return
    this.handleClose(socket)
    socket.close()
  }

  async ensureConnected() {
    if (this.socket?.readyState === WebSocket.OPEN) return
    if (this.connecting) return this.connecting
    this.connecting = this.connect().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  async connect() {
    let lastError
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const socket = await this.openSocket()
        this.socket = socket
        socket.addEventListener('message', (event) => this.handleMessage(event.data))
        socket.addEventListener('close', () => this.handleClose(socket))
        socket.addEventListener('error', () => {})
        const result = this.connectedOnce
          ? await this.sendRequest('reconnect', {
              channel: ROOT_CHANNEL,
              clientId: this.clientId,
              lastSeenServerSeq: this.lastSeenServerSeq,
              subscriptions: [...this.subscriptions],
            }, 10_000)
          : await this.sendRequest('initialize', {
              channel: ROOT_CHANNEL,
              protocolVersions: ['0.7.0', '0.6.0'],
              clientId: this.clientId,
              clientInfo: {
                name: 'agent-viewer',
                version: '1.3.0',
                title: this.title,
              },
              initialSubscriptions: [...this.subscriptions],
            }, 10_000)
        this.connectedOnce = true
        this.acceptConnectionResult(result)
        return
      } catch (error) {
        lastError = error
        this.socket?.close()
        this.socket = null
        if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    throw new Error(
      `Cannot reach the Agent Viewer AHP host at ${this.url}. Start \`npx agent-viewer web\` first`
      + ` or set AGENT_VIEWER_COORD_TRANSPORT=http for the legacy transport.`
      + (lastError instanceof Error ? ` ${lastError.message}` : ''),
    )
  }

  openSocket() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url)
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error('AHP connection timed out'))
      }, 2_000)
      timer.unref?.()
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve(socket)
      }, { once: true })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('AHP WebSocket connection failed'))
      }, { once: true })
    })
  }

  sendRequest(method, params, timeoutMs) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(transportClosedError())
    }
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(requestTimeoutError(method))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  handleMessage(raw) {
    let message
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'))
    } catch {
      return
    }
    if (!message) return
    this.observeServerSequence(message.params)
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) {
      pending.reject(new Error(message.error.message || `AHP error ${message.error.code}`))
    } else {
      this.observeServerSequence(message.result)
      pending.resolve(message.result)
    }
  }

  handleClose(socket) {
    if (this.socket !== socket) return
    this.socket = null
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(transportClosedError())
    }
    this.pending.clear()
  }

  observeServerSequence(value) {
    if (!value || typeof value !== 'object') return
    const candidates = [
      value.serverSeq,
      value.snapshot?.serverSeq,
      ...(Array.isArray(value.snapshots) ? value.snapshots.map((snapshot) => snapshot?.serverSeq) : []),
      ...(Array.isArray(value.actions) ? value.actions.map((action) => action?.serverSeq) : []),
    ]
    for (const candidate of candidates) {
      if (Number.isSafeInteger(candidate)) {
        this.lastSeenServerSeq = Math.max(this.lastSeenServerSeq, candidate)
      }
    }
  }

  acceptConnectionResult(result) {
    if (result?.type === 'snapshot' && Array.isArray(result.snapshots)) {
      this.lastSeenServerSeq = result.snapshots.reduce(
        (maximum, snapshot) => Math.max(maximum, Number(snapshot?.serverSeq) || 0),
        0,
      )
      return
    }
    if (Number.isSafeInteger(result?.serverSeq)) {
      this.lastSeenServerSeq = result.serverSeq
      return
    }
    this.observeServerSequence(result)
  }

  async rememberRunSubscription(result) {
    const participant = result && typeof result === 'object' ? result.participant : null
    const runId = typeof participant?.runId === 'string' ? participant.runId : ''
    if (!runId) return
    const channel = `ahp-session:/${runId}`
    if (this.subscriptions.has(channel)) return
    this.subscriptions.add(channel)
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    try {
      const subscribed = await this.sendRequest('subscribe', { channel }, 10_000)
      this.observeServerSequence(subscribed)
    } catch {
      // The participant operation already succeeded. Keep the desired
      // subscription locally so the next reconnect restores it atomically.
    }
  }
}
