#!/usr/bin/env node

import { createServer, type Socket } from 'node:net'
import { CoordinatorAhpHost, type CoordinatorAhpConnection } from '../lib/ahpHost'

const MAX_FRAME_BYTES = 16 * 1024 * 1024
const host = new CoordinatorAhpHost()

type WritablePeer = {
  write(data: string): boolean
  end?(): void
}

type WebSocketPeerData = {
  connection?: CoordinatorAhpConnection
  handling: Promise<void>
}

type BunWebSocketPeer = {
  data: WebSocketPeerData
  send(data: string): number
}

type BunServer = {
  port: number
  stop(closeActiveConnections?: boolean): void
  upgrade(request: Request, options: { data: WebSocketPeerData }): boolean
}

type BunRuntime = {
  serve(options: {
    hostname: string
    port: number
    fetch(request: Request, server: BunServer): Response | undefined
    websocket: {
      open(peer: BunWebSocketPeer): void
      message(peer: BunWebSocketPeer, message: string | ArrayBuffer | Uint8Array): void
      close(peer: BunWebSocketPeer): void
    }
  }): BunServer
}

function writeJson(peer: WritablePeer, value: unknown): void {
  peer.write(`${JSON.stringify(value)}\n`)
}

function attachFramedPeer(
  peer: WritablePeer,
  onData: (listener: (chunk: string) => void) => void,
  onClose: (listener: () => void) => void,
  afterClose?: () => void,
): CoordinatorAhpConnection {
  let buffer = ''
  let handling = Promise.resolve()
  const connection = host.createConnection((message) => writeJson(peer, message))
  onData((chunk) => {
    buffer += chunk
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const frame = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!frame) continue
      if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) {
        writeJson(peer, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'AHP frame exceeds 16 MiB' },
        })
        peer.end?.()
        return
      }
      let message: unknown
      try {
        message = JSON.parse(frame)
      } catch {
        writeJson(peer, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        })
        continue
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        writeJson(peer, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Invalid JSON-RPC request' },
        })
        continue
      }
      handling = handling.then(() =>
        connection.handle(message as Parameters<CoordinatorAhpConnection['handle']>[0]))
    }
    if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) {
      writeJson(peer, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'AHP frame exceeds 16 MiB' },
      })
      peer.end?.()
    }
  })
  onClose(() => {
    void handling.finally(() => {
      connection.close()
      afterClose?.()
    })
  })
  return connection
}

function parseListen(value: string): { hostname: string; port: number } {
  const separator = value.lastIndexOf(':')
  const hostname = separator >= 0 ? value.slice(0, separator) : '127.0.0.1'
  const portText = separator >= 0 ? value.slice(separator + 1) : value
  const port = Number(portText)
  if (!hostname || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('AHP endpoint must be HOST:PORT (for example 127.0.0.1:8765)')
  }
  return { hostname, port }
}

const listenArg = process.argv.find((arg) => arg.startsWith('--listen='))
  ?? (process.argv.includes('--listen')
    ? `--listen=${process.argv[process.argv.indexOf('--listen') + 1] ?? ''}`
    : undefined)
const websocketArg = process.argv.find((arg) => arg.startsWith('--ws='))
  ?? (process.argv.includes('--ws')
    ? `--ws=${process.argv[process.argv.indexOf('--ws') + 1] ?? ''}`
    : undefined)

if (listenArg && websocketArg) {
  throw new Error('Choose either --listen for framed TCP or --ws for WebSocket')
}

const refreshTimer = setInterval(() => {
  void host.refresh().catch((error) => {
    console.error(`AHP refresh failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}, 500)

if (websocketArg) {
  const bun = (globalThis as unknown as { Bun?: BunRuntime }).Bun
  if (!bun) throw new Error('--ws requires Bun')
  const address = parseListen(websocketArg.slice('--ws='.length))
  const server = bun.serve({
    hostname: address.hostname,
    port: address.port,
    fetch(request, serverValue) {
      if (serverValue.upgrade(request, { data: { handling: Promise.resolve() } })) return
      return new Response('AHP WebSocket endpoint\n', {
        status: 426,
        headers: { Upgrade: 'websocket' },
      })
    },
    websocket: {
      open(peer) {
        peer.data.connection = host.createConnection((message) => {
          peer.send(JSON.stringify(message))
        })
      },
      message(peer, rawMessage) {
        const size = typeof rawMessage === 'string'
          ? Buffer.byteLength(rawMessage)
          : rawMessage.byteLength
        if (size > MAX_FRAME_BYTES) {
          peer.send(JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'AHP frame exceeds 16 MiB' },
          }))
          return
        }
        let message: unknown
        try {
          const textValue = typeof rawMessage === 'string'
            ? rawMessage
            : rawMessage instanceof ArrayBuffer
              ? Buffer.from(new Uint8Array(rawMessage)).toString('utf8')
              : Buffer.from(rawMessage).toString('utf8')
          message = JSON.parse(textValue)
        } catch {
          peer.send(JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          }))
          return
        }
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          peer.send(JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Invalid JSON-RPC request' },
          }))
          return
        }
        const connection = peer.data.connection
        if (connection) {
          peer.data.handling = peer.data.handling.then(() =>
            connection.handle(message as Parameters<CoordinatorAhpConnection['handle']>[0]))
        }
      },
      close(peer) {
        void peer.data.handling.finally(() => peer.data.connection?.close())
      },
    },
  })
  console.error(`Agent Viewer AHP host listening on ws://${address.hostname}:${server.port}`)
  const close = () => {
    clearInterval(refreshTimer)
    host.close()
    server.stop(true)
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
} else if (listenArg) {
  const address = parseListen(listenArg.slice('--listen='.length))
  const server = createServer((socket: Socket) => {
    socket.setEncoding('utf8')
    socket.setNoDelay(true)
    attachFramedPeer(
      socket,
      (listener) => socket.on('data', listener),
      (listener) => socket.once('close', listener),
    )
  })
  server.listen(address.port, address.hostname, () => {
    console.error(`Agent Viewer AHP host listening on tcp://${address.hostname}:${address.port}`)
  })
  const close = () => {
    clearInterval(refreshTimer)
    host.close()
    server.close()
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
} else {
  process.stdin.setEncoding('utf8')
  process.stdin.resume()
  attachFramedPeer(
    process.stdout,
    (listener) => process.stdin.on('data', listener),
    (listener) => process.stdin.once('end', listener),
    () => {
      clearInterval(refreshTimer)
      host.close()
    },
  )
}
