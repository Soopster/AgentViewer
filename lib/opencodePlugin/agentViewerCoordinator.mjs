// Agent Viewer's Coordinator tools for in-process OpenCode sessions.
//
// OpenCode's server is a genuinely separate OS process (createOpencodeServer
// shells out via cross-spawn — lib/opencodeClient.ts) and its plugin API has
// no per-session tool registration (Hooks.tool is one static map for the
// whole server), so every session sees this tool set, but a call only does
// anything for a session actually bound to a Coordinator run — everyone else
// gets a "not part of an active coordinator run" result. Identity resolution
// happens on the Agent Viewer side, keyed by OpenCode's own session id (see
// registerCoordinatorOpenCodeTools / dispatchCoordinatorOpenCodeToolCall in
// lib/agentCoordinationSdkTools.ts), reached over a small local HTTP bridge
// (lib/coordinatorBridgeServer.ts) since this process can't import that
// TypeScript module graph directly.
//
// Share the pure contract with every in-process provider; only schema conversion
// and the local transport are specific to OpenCode.
import { tool } from '@opencode-ai/plugin'
import { COORD_TOOL_SPECS } from '../coordinatorToolContract.mjs'

const z = tool.schema

function zodField(f) {
  let base
  switch (f.t) {
    case 'string': {
      let s = z.string()
      if (f.min !== undefined) s = s.min(f.min)
      if (f.max !== undefined) s = s.max(f.max)
      base = s
      break
    }
    case 'enum':
      base = z.enum(f.values)
      break
    case 'number': {
      let n = z.number()
      if (f.int) n = n.int()
      if (f.min !== undefined) n = n.min(f.min)
      if (f.max !== undefined) n = n.max(f.max)
      base = n
      break
    }
    case 'boolean':
      base = z.boolean()
      break
    case 'stringArray': {
      let arr = z.array(z.string().min(1))
      if (f.min !== undefined) arr = arr.min(f.min)
      if (f.max !== undefined) arr = arr.max(f.max)
      base = arr
      break
    }
  }
  return f.optional ? base.optional() : base
}

function zodShape(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key, zodField(spec)]))
}

function bridgeUrl() {
  const url = process.env.AGENT_VIEWER_COORD_BRIDGE_URL
  if (!url) throw new Error('AGENT_VIEWER_COORD_BRIDGE_URL is not set — the Agent Viewer coordinator bridge was not started for this OpenCode server.')
  return url
}

function bridgeSecret() {
  const secret = process.env.AGENT_VIEWER_COORD_BRIDGE_SECRET
  if (!secret) throw new Error('AGENT_VIEWER_COORD_BRIDGE_SECRET is not set — the Agent Viewer coordinator bridge was not started for this OpenCode server.')
  return secret
}

async function callBridge(toolName, args, context) {
  const response = await fetch(bridgeUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridgeSecret()}` },
    body: JSON.stringify({ sessionId: context.sessionID, tool: toolName, args }),
  })
  if (response.status === 404) {
    return 'This session is not part of an active Agent Viewer Coordinator run.'
  }
  const body = await response.json().catch(() => ({ error: 'Invalid response from Agent Viewer coordinator bridge' }))
  if (!response.ok) {
    throw new Error(body.error || body.text || 'Coordinator action failed')
  }
  return body.text
}

export const AgentViewerCoordinatorPlugin = async () => {
  const tools = {}
  for (const spec of COORD_TOOL_SPECS) {
    tools[spec.name] = tool({
      description: spec.description,
      args: zodShape(spec.fields),
      execute: (args, context) => callBridge(spec.name, args, context),
    })
  }
  return { tool: tools }
}
