#!/usr/bin/env bun
// IDE host that makes agentViewer behave like a Claude Code IDE extension.
//
// This is agentViewer's THIRD Claude composer flow, alongside:
//   - the Claude Agent SDK flow (agentViewer spawns/queries `claude` itself), and
//   - the channel flow (an external `claude` connects via MCP-over-stdio; see
//     channels/agentviewer-channel.ts).
//
// Here agentViewer plays the IDE: it opens a WebSocket MCP server on a random
// port, writes the discovery lock file to ~/.claude/ide/[port].lock, and an
// external `claude` launched with the printed env vars connects to it. Over
// that socket agentViewer pushes `at_mentioned` / `selection_changed`
// notifications into the running session and serves the 12 IDE tools
// (openFile, openDiff, getDiagnostics, …). This is the WebSocket variant of MCP
// (spec 2025-03-26) that the official VS Code / Neovim extensions speak — see
// ~/Documents/src/claudecode.nvim/PROTOCOL.md.
//
// Run it, then launch `claude` in the SAME shell (it prints the exact commands):
//   bun run channels/agentviewer-ide.ts
//
// Two ports are involved:
//   - a RANDOM WebSocket port that `claude` discovers (lock file + env) and
//     connects to. Never talk to this from agentViewer.
//   - a FIXED HTTP control port (default 8791, AGENTVIEWER_IDE_PORT) that
//     agentViewer's composer drives — mirrors the channel bridge's HTTP surface
//     so the UI patterns transfer (lib/ideBridge.ts + components/useIdeBridge.ts).

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const MCP_PROTOCOL_VERSION = '2025-03-26'
const IDE_NAME = 'agentViewer'

// Fixed control port agentViewer connects to (parallels the channel's 8790).
const CONTROL_PORT = Number(process.env.AGENTVIEWER_IDE_PORT ?? 8791)
// Optional shared secret for the control surface (NOT the WS auth token, which
// is generated fresh below per the protocol). Unset disables the check.
const CONTROL_TOKEN = process.env.AGENTVIEWER_IDE_CONTROL_TOKEN ?? ''
// Workspace folder advertised in the lock file + getWorkspaceFolders.
const WORKSPACE = process.env.AGENTVIEWER_IDE_WORKSPACE?.trim() || process.cwd()

// 128-bit token (32-char lowercase hex) from the OS CSPRNG — per the protocol,
// validated against the `x-claude-code-ide-authorization` WS header.
const AUTH_TOKEN = randomBytes(16).toString('hex')

// ── Shared editor state ──────────────────────────────────────────────────────
// agentViewer pushes context here over POST /context; the IDE read-tools serve
// it back to Claude. Sensible empty defaults so tools never throw on cold start.
type Selection = {
  text: string
  filePath: string | null
  fileUrl: string | null
  selection: {
    start: { line: number; character: number }
    end: { line: number; character: number }
    isEmpty: boolean
  }
}
type OpenTab = { uri: string; isActive: boolean; label: string; languageId?: string; isDirty: boolean }
type DiagnosticEntry = { uri: string; diagnostics: unknown[] }

const editorState: {
  selection: Selection | null
  latestSelection: Selection | null
  openEditors: OpenTab[]
  diagnostics: DiagnosticEntry[]
  workspaceFolders: string[]
} = {
  selection: null,
  latestSelection: null,
  openEditors: [],
  diagnostics: [],
  workspaceFolders: [WORKSPACE],
}

// ── Control-surface SSE (agentViewer observers) ──────────────────────────────
const controlListeners = new Set<(chunk: string) => void>()
function controlBroadcast(event: Record<string, unknown>) {
  const chunk = `data: ${JSON.stringify(event)}\n\n`
  for (const emit of controlListeners) emit(chunk)
}

// ── WebSocket MCP server (Claude connects here) ──────────────────────────────
type WsData = { authorized: boolean }
let claudeSocket: import('bun').ServerWebSocket<WsData> | null = null
let nextRpcId = 1

// In-flight IDE→Claude requests awaiting a JSON-RPC result (currently unused —
// the protocol is mostly Claude→IDE — but kept so future tool calls can await).
const pendingRpc = new Map<string | number, (result: unknown) => void>()

// Blocking openDiff calls: Claude's tools/call waits until agentViewer posts a
// verdict to /diff-result. Keyed by a diff id we mint and surface to the UI.
const pendingDiffs = new Map<string, (behavior: 'accept' | 'reject') => void>()
let nextDiffId = 1

function sendToClaude(message: Record<string, unknown>) {
  if (!claudeSocket) return false
  claudeSocket.send(JSON.stringify(message))
  return true
}

function notifyClaude(method: string, params: Record<string, unknown>) {
  return sendToClaude({ jsonrpc: '2.0', method, params })
}

function rpcResult(id: string | number, result: unknown) {
  sendToClaude({ jsonrpc: '2.0', id, result })
}

function rpcError(id: string | number, code: number, message: string) {
  sendToClaude({ jsonrpc: '2.0', id, error: { code, message } })
}

function textContent(text: string) {
  return { content: [{ type: 'text', text }] }
}

// ── Tool definitions (the 12 from PROTOCOL.md) ───────────────────────────────
const TOOL_DEFINITIONS = [
  {
    name: 'openFile',
    description: 'Open a file in the editor and optionally select a range of text',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        preview: { type: 'boolean' },
        startText: { type: 'string' },
        endText: { type: 'string' },
        selectToEndOfLine: { type: 'boolean' },
        makeFrontmost: { type: 'boolean' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'openDiff',
    description: 'Open a git diff for the file (blocking until the user saves or rejects)',
    inputSchema: {
      type: 'object',
      properties: {
        old_file_path: { type: 'string' },
        new_file_path: { type: 'string' },
        new_file_contents: { type: 'string' },
        tab_name: { type: 'string' },
      },
      required: ['old_file_path', 'new_file_path', 'new_file_contents', 'tab_name'],
    },
  },
  { name: 'getCurrentSelection', description: 'Get the current text selection in the active editor', inputSchema: { type: 'object', properties: {} } },
  { name: 'getLatestSelection', description: 'Get the most recent text selection (even if not in active editor)', inputSchema: { type: 'object', properties: {} } },
  { name: 'getOpenEditors', description: 'Get information about currently open editors', inputSchema: { type: 'object', properties: {} } },
  { name: 'getWorkspaceFolders', description: 'Get all workspace folders currently open in the IDE', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'getDiagnostics',
    description: 'Get language diagnostics from the editor',
    inputSchema: { type: 'object', properties: { uri: { type: 'string' } } },
  },
  {
    name: 'checkDocumentDirty',
    description: 'Check if a document has unsaved changes (is dirty)',
    inputSchema: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] },
  },
  {
    name: 'saveDocument',
    description: 'Save a document with unsaved changes',
    inputSchema: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] },
  },
  { name: 'close_tab', description: 'Close a tab by name', inputSchema: { type: 'object', properties: { tab_name: { type: 'string' } }, required: ['tab_name'] } },
  { name: 'closeAllDiffTabs', description: 'Close all diff tabs in the editor', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'executeCode',
    description: 'Execute Python code in the Jupyter kernel for the current notebook file',
    inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
  },
] as const

function fileUrl(path: string): string {
  return `file://${path}`
}

// Resolve a tool call. Returns an MCP content result, OR a Promise for blocking
// tools (openDiff). Read tools serve the pushed editorState; mutation tools
// surface to agentViewer over SSE so the UI can react and (for diffs) respond.
async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  controlBroadcast({ type: 'tool_call', name, arguments: args })

  switch (name) {
    case 'openFile': {
      const filePath = String(args.filePath ?? '')
      const makeFrontmost = args.makeFrontmost !== false
      if (makeFrontmost) return textContent(`Opened file: ${filePath}`)
      return textContent(JSON.stringify({ success: true, filePath, languageId: '', lineCount: 0 }))
    }

    case 'openDiff': {
      // Blocking: hold the JSON-RPC response until agentViewer renders the diff
      // and the user accepts (FILE_SAVED) or rejects (DIFF_REJECTED).
      const diffId = `diff-${nextDiffId++}`
      const oldPath = String(args.old_file_path ?? '')
      const tabName = String(args.tab_name ?? 'Proposed changes')
      const newContents = String(args.new_file_contents ?? '')
      // Read the original from disk so agentViewer can render a real old-vs-new
      // diff in its own viewer. Missing/unreadable (a brand-new file) → empty.
      let oldContents = ''
      try {
        if (oldPath) oldContents = readFileSync(oldPath, 'utf8')
      } catch {
        oldContents = ''
      }
      controlBroadcast({
        type: 'open_diff',
        diff_id: diffId,
        old_file_path: oldPath,
        old_file_contents: oldContents,
        new_file_path: String(args.new_file_path ?? ''),
        new_file_contents: newContents,
        tab_name: tabName,
      })
      const behavior = await new Promise<'accept' | 'reject'>((resolve) => {
        pendingDiffs.set(diffId, resolve)
      })
      // The accept response MUST carry the final file contents as a SECOND
      // content block — that is the contract Claude relies on to know what was
      // saved and to apply the edit. A bare "FILE_SAVED" with no contents makes
      // Claude treat the edit as not applied. Reject carries the tab name.
      // (Matches the coder/claudecode.nvim diff resolver.)
      if (behavior === 'accept') {
        return { content: [{ type: 'text', text: 'FILE_SAVED' }, { type: 'text', text: newContents }] }
      }
      return { content: [{ type: 'text', text: 'DIFF_REJECTED' }, { type: 'text', text: tabName }] }
    }

    case 'getCurrentSelection': {
      if (!editorState.selection) return textContent(JSON.stringify({ success: false, message: 'No active editor found' }))
      return textContent(JSON.stringify({ success: true, ...editorState.selection }))
    }

    case 'getLatestSelection': {
      const sel = editorState.latestSelection ?? editorState.selection
      if (!sel) return textContent(JSON.stringify({ success: false, message: 'No selection available' }))
      return textContent(JSON.stringify({ success: true, ...sel }))
    }

    case 'getOpenEditors':
      return textContent(JSON.stringify({ tabs: editorState.openEditors }))

    case 'getWorkspaceFolders':
      return textContent(
        JSON.stringify({
          success: true,
          folders: editorState.workspaceFolders.map((path) => ({
            name: path.split('/').filter(Boolean).pop() ?? path,
            uri: fileUrl(path),
            path,
          })),
          rootPath: editorState.workspaceFolders[0] ?? null,
        }),
      )

    case 'getDiagnostics': {
      const uri = typeof args.uri === 'string' ? args.uri : null
      const data = uri ? editorState.diagnostics.filter((d) => d.uri === uri) : editorState.diagnostics
      return textContent(JSON.stringify(data))
    }

    case 'checkDocumentDirty': {
      const filePath = String(args.filePath ?? '')
      const tab = editorState.openEditors.find((t) => t.uri === fileUrl(filePath) || t.uri === filePath)
      if (!tab) return textContent(JSON.stringify({ success: false, message: `Document not open: ${filePath}` }))
      return textContent(JSON.stringify({ success: true, filePath, isDirty: tab.isDirty, isUntitled: false }))
    }

    case 'saveDocument': {
      const filePath = String(args.filePath ?? '')
      const tab = editorState.openEditors.find((t) => t.uri === fileUrl(filePath) || t.uri === filePath)
      if (!tab) return textContent(JSON.stringify({ success: false, message: `Document not open: ${filePath}` }))
      return textContent(JSON.stringify({ success: true, filePath, saved: true, message: 'Document saved successfully' }))
    }

    case 'close_tab':
      return textContent('TAB_CLOSED')

    case 'closeAllDiffTabs': {
      const count = pendingDiffs.size
      for (const [, resolve] of pendingDiffs) resolve('reject')
      pendingDiffs.clear()
      return textContent(`CLOSED_${count}_DIFF_TABS`)
    }

    case 'executeCode':
      // agentViewer has no Jupyter kernel — report honestly rather than fake output.
      return textContent('executeCode is not supported by the agentViewer IDE host')

    default:
      throw new Error(`unknown tool: ${name}`)
  }
}

// Dispatch one inbound JSON-RPC message from Claude.
async function handleRpc(raw: string) {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }
  const { id, method } = msg as { id?: string | number; method?: string }

  // A response to one of our own requests.
  if (method === undefined && id !== undefined) {
    const resolver = pendingRpc.get(id)
    if (resolver) {
      pendingRpc.delete(id)
      resolver((msg as { result?: unknown }).result)
    }
    return
  }

  switch (method) {
    case 'initialize':
      rpcResult(id!, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: IDE_NAME, version: '0.0.1' },
      })
      controlBroadcast({ type: 'initialized' })
      return

    case 'notifications/initialized':
      return

    case 'tools/list':
      rpcResult(id!, { tools: TOOL_DEFINITIONS })
      return

    case 'tools/call': {
      const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
      try {
        const result = await handleToolCall(String(params.name), params.arguments ?? {})
        rpcResult(id!, result)
      } catch (err) {
        rpcError(id!, -32603, err instanceof Error ? err.message : 'tool call failed')
      }
      return
    }

    case 'ping':
      if (id !== undefined) rpcResult(id, {})
      return

    default:
      // Unknown request → method-not-found; unknown notification → ignore.
      if (id !== undefined) rpcError(id, -32601, `method not found: ${method}`)
  }
}

const wsServer = Bun.serve<WsData>({
  port: 0, // random free port — the protocol expects a random 10000-65535 port
  hostname: '127.0.0.1',
  fetch(req, server) {
    const auth = req.headers.get('x-claude-code-ide-authorization')
    if (auth !== AUTH_TOKEN) return new Response('unauthorized', { status: 401 })
    if (server.upgrade(req, { data: { authorized: true } })) return
    return new Response('expected websocket upgrade', { status: 426 })
  },
  websocket: {
    open(ws) {
      claudeSocket = ws
      controlBroadcast({ type: 'connected' })
      console.error('[agentviewer-ide] claude connected')
    },
    message(ws, message) {
      void handleRpc(typeof message === 'string' ? message : message.toString())
    },
    close() {
      claudeSocket = null
      for (const [, resolve] of pendingDiffs) resolve('reject')
      pendingDiffs.clear()
      controlBroadcast({ type: 'disconnected' })
      console.error('[agentviewer-ide] claude disconnected')
    },
  },
})

const WS_PORT = wsServer.port

// ── Lock file + cleanup ──────────────────────────────────────────────────────
const lockDir = join(homedir(), '.claude', 'ide')
const lockPath = join(lockDir, `${WS_PORT}.lock`)
mkdirSync(lockDir, { recursive: true })
writeFileSync(
  lockPath,
  JSON.stringify({
    pid: process.pid,
    workspaceFolders: editorState.workspaceFolders,
    ideName: IDE_NAME,
    transport: 'ws',
    authToken: AUTH_TOKEN,
  }),
)

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  try {
    rmSync(lockPath, { force: true })
  } catch {
    // best-effort
  }
}
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => {
    cleanup()
    process.exit(0)
  })
}

// ── HTTP control surface (agentViewer drives this) ───────────────────────────
function authorized(req: Request, url: URL) {
  if (!CONTROL_TOKEN) return true
  return req.headers.get('x-agentviewer-token') === CONTROL_TOKEN || url.searchParams.get('token') === CONTROL_TOKEN
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-agentviewer-token',
}
function withCors(response: Response) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) response.headers.set(key, value)
  return response
}

function toSelection(raw: Record<string, unknown>): Selection {
  const filePath = typeof raw.filePath === 'string' ? raw.filePath : null
  const sel = (raw.selection ?? {}) as Record<string, unknown>
  const start = (sel.start ?? {}) as Record<string, unknown>
  const end = (sel.end ?? {}) as Record<string, unknown>
  const text = typeof raw.text === 'string' ? raw.text : ''
  return {
    text,
    filePath,
    fileUrl: filePath ? fileUrl(filePath) : null,
    selection: {
      start: { line: Number(start.line ?? 0), character: Number(start.character ?? 0) },
      end: { line: Number(end.line ?? 0), character: Number(end.character ?? 0) },
      isEmpty: typeof sel.isEmpty === 'boolean' ? sel.isEmpty : text.length === 0,
    },
  }
}

function startControlBridge() {
  try {
    Bun.serve({
      port: CONTROL_PORT,
      hostname: '127.0.0.1',
      idleTimeout: 0, // keep SSE streams open
      async fetch(req) {
        const url = new URL(req.url)
        if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }))
        if (!authorized(req, url)) return withCors(new Response('forbidden', { status: 403 }))

        // agentViewer subscribes here for connection status, tool calls, diffs.
        if (req.method === 'GET' && url.pathname === '/events') {
          const stream = new ReadableStream({
            start(ctrl) {
              ctrl.enqueue(': connected\n\n')
              // Replay the current connection state so a late subscriber knows.
              ctrl.enqueue(`data: ${JSON.stringify({ type: claudeSocket ? 'connected' : 'disconnected' })}\n\n`)
              const emit = (chunk: string) => ctrl.enqueue(chunk)
              controlListeners.add(emit)
              req.signal.addEventListener('abort', () => controlListeners.delete(emit))
            },
          })
          return withCors(
            new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } }),
          )
        }

        // Lightweight status probe (used to render "host up" without subscribing).
        if (req.method === 'GET' && url.pathname === '/status') {
          return withCors(
            Response.json({ wsPort: WS_PORT, controlPort: CONTROL_PORT, ideName: IDE_NAME, claudeConnected: !!claudeSocket }),
          )
        }

        // Push an at-mention into the running session (file + optional line range).
        if (req.method === 'POST' && url.pathname === '/at-mention') {
          const body = (await req.json()) as { filePath: string; lineStart?: number; lineEnd?: number }
          const delivered = notifyClaude('at_mentioned', {
            filePath: body.filePath,
            lineStart: body.lineStart ?? null,
            lineEnd: body.lineEnd ?? null,
          })
          return withCors(Response.json({ delivered }))
        }

        // Push a selection update (also stored so getCurrentSelection serves it).
        if (req.method === 'POST' && url.pathname === '/selection') {
          const body = (await req.json()) as Record<string, unknown>
          const selection = toSelection(body)
          editorState.selection = selection
          editorState.latestSelection = selection
          const delivered = notifyClaude('selection_changed', {
            text: selection.text,
            filePath: selection.filePath,
            fileUrl: selection.fileUrl,
            selection: selection.selection,
          })
          return withCors(Response.json({ delivered }))
        }

        // Resolve a blocking openDiff: behavior 'accept' → FILE_SAVED, else DIFF_REJECTED.
        if (req.method === 'POST' && url.pathname === '/diff-result') {
          const { diff_id, behavior } = (await req.json()) as { diff_id: string; behavior: 'accept' | 'reject' }
          const resolve = pendingDiffs.get(diff_id)
          if (resolve) {
            pendingDiffs.delete(diff_id)
            resolve(behavior === 'accept' ? 'accept' : 'reject')
            return withCors(new Response('ok'))
          }
          return withCors(new Response('unknown diff', { status: 404 }))
        }

        // Replace the editor context the read-tools serve (open editors, diagnostics, …).
        if (req.method === 'POST' && url.pathname === '/context') {
          const body = (await req.json()) as Partial<typeof editorState>
          if (Array.isArray(body.openEditors)) editorState.openEditors = body.openEditors
          if (Array.isArray(body.diagnostics)) editorState.diagnostics = body.diagnostics
          if (Array.isArray(body.workspaceFolders) && body.workspaceFolders.length)
            editorState.workspaceFolders = body.workspaceFolders
          return withCors(new Response('ok'))
        }

        return withCors(new Response('not found', { status: 404 }))
      },
    })
  } catch (err) {
    const code = (err as { code?: string } | null)?.code
    if (code === 'EADDRINUSE') {
      console.error(
        `[agentviewer-ide] control port ${CONTROL_PORT} is already in use — another agentViewer ` +
          `IDE host is running. Quit it, or set AGENTVIEWER_IDE_PORT to a free port and point ` +
          `agentViewer's IDE bridge URL at it.`,
      )
    } else {
      console.error(`[agentviewer-ide] failed to start control bridge on port ${CONTROL_PORT}:`, err)
    }
    cleanup()
    process.exit(1)
  }
}

startControlBridge()

// Launch instructions — stderr so nothing pollutes a parent's stdout pipe.
console.error(`[agentviewer-ide] IDE host ready`)
console.error(`[agentviewer-ide]   WebSocket (claude connects here): ws://127.0.0.1:${WS_PORT}`)
console.error(`[agentviewer-ide]   control bridge (agentViewer):     http://127.0.0.1:${CONTROL_PORT}`)
console.error(`[agentviewer-ide]   lock file:                        ${lockPath}`)
console.error(`[agentviewer-ide]`)
console.error(`[agentviewer-ide] Launch claude in this shell to connect:`)
console.error(`[agentviewer-ide]   export CLAUDE_CODE_SSE_PORT=${WS_PORT}`)
console.error(`[agentviewer-ide]   export ENABLE_IDE_INTEGRATION=true`)
console.error(`[agentviewer-ide]   claude`)
