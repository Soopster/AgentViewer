import { randomUUID } from 'node:crypto'

const ROOT_CHANNEL = 'ahp-root://'
const COORDINATOR_METHOD = 'agent-viewer/coordinator'

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
  }

  async request(action, payload = {}, timeoutMs = 10_000) {
    await this.ensureConnected()
    return this.sendRequest(COORDINATOR_METHOD, {
      channel: ROOT_CHANNEL,
      action,
      payload,
    }, timeoutMs)
  }

  close() {
    this.socket?.close()
    this.socket = null
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
        socket.addEventListener('close', () => this.handleClose())
        socket.addEventListener('error', () => {})
        await this.sendRequest('initialize', {
          channel: ROOT_CHANNEL,
          protocolVersions: ['0.7.0', '0.6.0'],
          clientId: this.clientId,
          clientInfo: {
            name: 'agent-viewer',
            version: '1.3.0',
            title: this.title,
          },
          initialSubscriptions: [ROOT_CHANNEL],
        }, 10_000)
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
      return Promise.reject(new Error('AHP WebSocket is not connected'))
    }
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`AHP request timed out: ${method}`))
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
    if (!message || typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) {
      pending.reject(new Error(message.error.message || `AHP error ${message.error.code}`))
    } else {
      pending.resolve(message.result)
    }
  }

  handleClose() {
    this.socket = null
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('AHP WebSocket closed'))
    }
    this.pending.clear()
  }
}
