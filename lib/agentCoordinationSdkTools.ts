/**
 * In-process Coordinator tools for internally-hosted (pooled) agent sessions
 * — the SDK-tool counterpart to bin/agent-viewer-mcp.mjs's stdio tool set.
 * External CLIs reach the coordinator over stdio + HTTP; a pooled session
 * lives in this same process, so its tools call `executeExternalCoordinatorAction`
 * directly (no IPC, no fenced-block text protocol, no prompt-engineered
 * grammar to re-explain every turn).
 *
 * Every provider's native SDK has its own shape for "a locally-executed
 * custom tool," so coordinatorToolContract.mjs is the single source of truth for
 * the coord_* contract (name, fields, the coordinator action + arg mapping)
 * and each provider gets a small converter from that shared spec to its own
 * tool type — buildCoordinatorSdkTools (Claude, zod shapes), buildCoordinatorPiTools
 * (Pi, TypeBox), buildCoordinatorCopilotTools (Copilot, zod objects). Codex
 * doesn't have an SDK tool type at all — see registerCoordinatorCodexTools
 * for its dynamicTools + server-request flow.
 *
 * A run's controller registers a session id → identity binding per
 * Claude/Pi/Copilot/Codex agent (see the register* functions below) and each
 * provider's client looks the binding up by session id at the point it
 * actually starts/resumes that session.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Type, type TSchema } from 'typebox'
import type { ToolDefinition as PiToolDefinition } from '@earendil-works/pi-coding-agent'
import type { DynamicToolSpec } from './codex-schema/v2'
import type { JsonValue } from './codex-schema/serde_json/JsonValue'
import type { ExternalProtocolIdentity } from './agentProtocol'

import { COORD_TOOL_SPECS, type FieldSpec } from './coordinatorToolContract.mjs'
export { COORD_FINDING_DETAIL_MAX_CHARS } from './coordinatorToolContract.mjs'

function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
}

function errorResult(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true as const,
  }
}

// Deferred: agentCoordinationExternal.ts pulls in agentCoordination.ts, which
// pulls in sessionBackend.ts/claudePool.ts/piClient.ts/copilotClient.ts/codexClient.ts,
// which import this module at their top level to look up registered tools —
// a static import here would close that into a cycle. Node resolves a
// runtime import() after every module's own top-level body has finished
// evaluating, so this stays a leaf module for bundling purposes while still
// reaching the real dispatcher when called.
async function call(identity: ExternalProtocolIdentity, action: string, args: Record<string, unknown> = {}) {
  try {
    const { executeExternalCoordinatorAction } = await import('./agentCoordinationExternal')
    const result = await executeExternalCoordinatorAction({
      action,
      runId: identity.runId,
      agentId: identity.agentId,
      token: identity.token,
      requestId: randomUUID(),
      ...args,
    })
    return textResult(result)
  } catch (error) {
    return errorResult(error)
  }
}

async function callJson(identity: ExternalProtocolIdentity, action: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  try {
    const { executeExternalCoordinatorAction } = await import('./agentCoordinationExternal')
    const result = await executeExternalCoordinatorAction({
      action,
      runId: identity.runId,
      agentId: identity.agentId,
      token: identity.token,
      requestId: randomUUID(),
      ...args,
    })
    return { text: JSON.stringify(result), isError: false }
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), isError: true }
  }
}

// ---- Shared coord_* tool contract -----------------------------------------

function zodField(f: FieldSpec): z.ZodTypeAny {
  let base: z.ZodTypeAny
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

function zodShape(fields: Record<string, FieldSpec>): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key, zodField(spec)]))
}

/** Build the coord_* tool set bound to one participant identity (Claude Agent SDK). */
export function buildCoordinatorSdkTools(identity: ExternalProtocolIdentity) {
  return COORD_TOOL_SPECS.map((spec) => tool(
    spec.name,
    spec.description,
    zodShape(spec.fields),
    async (args: Record<string, any>) => call(identity, spec.action, spec.mapArgs(args)),
  ))
}

const registry = new Map<string, Record<string, McpServerConfig>>()

/** Bind a session id to a Coordinator identity's tool set for its whole lifetime. */
export function registerCoordinatorMcpServer(sessionId: string, identity: ExternalProtocolIdentity): void {
  registry.set(sessionId, {
    'agent-viewer': createSdkMcpServer({
      name: 'agent-viewer',
      tools: buildCoordinatorSdkTools(identity),
    }),
  })
}

export function getCoordinatorMcpServers(sessionId: string): Record<string, McpServerConfig> | undefined {
  return registry.get(sessionId)
}

export function unregisterCoordinatorMcpServer(sessionId: string): void {
  registry.delete(sessionId)
}

// ---- Pi (TypeBox customTools) ----------------------------------------------

function typeboxField(f: FieldSpec): TSchema {
  let base: TSchema
  switch (f.t) {
    case 'string':
      base = Type.String(f.min !== undefined || f.max !== undefined ? { minLength: f.min, maxLength: f.max } : undefined)
      break
    case 'enum':
      base = Type.Union(f.values.map((value) => Type.Literal(value)))
      break
    case 'number':
      base = f.int
        ? Type.Integer(f.min !== undefined || f.max !== undefined ? { minimum: f.min, maximum: f.max } : undefined)
        : Type.Number(f.min !== undefined || f.max !== undefined ? { minimum: f.min, maximum: f.max } : undefined)
      break
    case 'boolean':
      base = Type.Boolean()
      break
    case 'stringArray':
      base = Type.Array(Type.String({ minLength: 1 }), f.min !== undefined || f.max !== undefined ? { minItems: f.min, maxItems: f.max } : undefined)
      break
  }
  return f.optional ? Type.Optional(base) : base
}

function typeboxParams(fields: Record<string, FieldSpec>): TSchema {
  return Type.Object(Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key, typeboxField(spec)])))
}

/** Build the coord_* tool set bound to one participant identity (Pi's customTools). */
export function buildCoordinatorPiTools(identity: ExternalProtocolIdentity): PiToolDefinition[] {
  return COORD_TOOL_SPECS.map((spec) => ({
    name: spec.name,
    label: spec.name,
    description: spec.description,
    parameters: typeboxParams(spec.fields),
    async execute(_toolCallId: string, params: Record<string, any>) {
      const { text, isError } = await callJson(identity, spec.action, spec.mapArgs(params))
      return {
        content: [{ type: 'text' as const, text }],
        details: isError ? { error: text } : undefined,
      }
    },
  }))
}

const piRegistry = new Map<string, ExternalProtocolIdentity>()

export function registerCoordinatorPiTools(sessionId: string, identity: ExternalProtocolIdentity): void {
  piRegistry.set(sessionId, identity)
}

/** Pi's createAgentSession/customTools option needs the built tool array, not just the identity. */
export function getCoordinatorPiTools(sessionId: string): PiToolDefinition[] | undefined {
  const identity = piRegistry.get(sessionId)
  return identity ? buildCoordinatorPiTools(identity) : undefined
}

export function unregisterCoordinatorPiTools(sessionId: string): void {
  piRegistry.delete(sessionId)
}

// ---- Copilot (zod-schema Tool[]) -------------------------------------------

/** Build the coord_* tool set bound to one participant identity (Copilot SDK's Tool[]). */
export function buildCoordinatorCopilotTools(identity: ExternalProtocolIdentity): unknown[] {
  return COORD_TOOL_SPECS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: z.object(zodShape(spec.fields)),
    skipPermission: true,
    async handler(args: Record<string, any>) {
      const { text, isError } = await callJson(identity, spec.action, spec.mapArgs(args))
      if (isError) throw new Error(text)
      return text
    },
  }))
}

const copilotRegistry = new Map<string, ExternalProtocolIdentity>()

export function registerCoordinatorCopilotTools(sessionId: string, identity: ExternalProtocolIdentity): void {
  copilotRegistry.set(sessionId, identity)
}

export function getCoordinatorCopilotTools(sessionId: string): unknown[] | undefined {
  const identity = copilotRegistry.get(sessionId)
  return identity ? buildCoordinatorCopilotTools(identity) : undefined
}

export function unregisterCoordinatorCopilotTools(sessionId: string): void {
  copilotRegistry.delete(sessionId)
}

// ---- Codex (JSON-schema dynamicTools + item/tool/call) --------------------

function jsonSchemaField(f: FieldSpec): Record<string, unknown> {
  switch (f.t) {
    case 'string':
      return { type: 'string', ...(f.min !== undefined ? { minLength: f.min } : {}), ...(f.max !== undefined ? { maxLength: f.max } : {}) }
    case 'enum':
      return { type: 'string', enum: [...f.values] }
    case 'number':
      return { type: f.int ? 'integer' : 'number', ...(f.min !== undefined ? { minimum: f.min } : {}), ...(f.max !== undefined ? { maximum: f.max } : {}) }
    case 'boolean':
      return { type: 'boolean' }
    case 'stringArray':
      return { type: 'array', items: { type: 'string', minLength: 1 }, ...(f.min !== undefined ? { minItems: f.min } : {}), ...(f.max !== undefined ? { maxItems: f.max } : {}) }
  }
}

function jsonSchemaParams(fields: Record<string, FieldSpec>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, spec] of Object.entries(fields)) {
    properties[key] = jsonSchemaField(spec)
    if (!spec.optional) required.push(key)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }
}

/** Codex's ThreadStartParams.dynamicTools shape — {type:'function', name, description, inputSchema}. */
export function buildCoordinatorCodexDynamicTools(): DynamicToolSpec[] {
  return COORD_TOOL_SPECS.map((spec) => ({
    type: 'function' as const,
    name: spec.name,
    description: spec.description,
    // jsonSchemaParams only ever nests string/number/boolean/array/plain-object
    // literals we control above — structurally a JsonValue, just not provably
    // so to a Record<string, unknown> return type.
    inputSchema: jsonSchemaParams(spec.fields) as unknown as JsonValue,
  }))
}

const codexRegistry = new Map<string, ExternalProtocolIdentity>()

/** Bind a Codex thread id to a Coordinator identity so the item/tool/call server-request handler (lib/codexClient.ts) can dispatch by name. */
export function registerCoordinatorCodexTools(threadId: string, identity: ExternalProtocolIdentity): void {
  codexRegistry.set(threadId, identity)
}

export function getCoordinatorCodexIdentity(threadId: string): ExternalProtocolIdentity | undefined {
  return codexRegistry.get(threadId)
}

export function unregisterCoordinatorCodexTools(threadId: string): void {
  codexRegistry.delete(threadId)
}

async function dispatchByRegistry(
  registry: Map<string, ExternalProtocolIdentity>,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean } | null> {
  const identity = registry.get(sessionId)
  const invocation = resolveCoordinatorToolCall(toolName, args)
  if (!identity || !invocation) return null
  return callJson(identity, invocation.action, invocation.args)
}

/** Resolve the shared provider-facing tool contract into a Coordinator action. */
export function resolveCoordinatorToolCall(
  toolName: string,
  args: Record<string, unknown>,
): { action: string; args: Record<string, unknown> } | null {
  const spec = COORD_TOOL_SPECS.find((entry) => entry.name === toolName)
  return spec ? { action: spec.action, args: spec.mapArgs(args) } : null
}

/** Dispatch a codex item/tool/call for a registered thread. Returns null if the tool name isn't one of ours. */
export function dispatchCoordinatorCodexToolCall(
  threadId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean } | null> {
  return dispatchByRegistry(codexRegistry, threadId, toolName, args)
}

// ---- OpenCode (plugin file + local HTTP bridge) ----------------------------

// OpenCode's server is a genuinely separate OS process (createOpencodeServer
// shells out via cross-spawn — lib/opencodeClient.ts), and its plugin API has
// no per-session tool registration hook (Hooks.tool is one static map for the
// whole server) — so identity resolution has to happen here, keyed by
// sessionID, when the plugin's HTTP bridge call for a tool arrives (see
// lib/coordinatorBridgeServer.ts and lib/opencodePlugin/agentViewerCoordinator.mjs).
const opencodeRegistry = new Map<string, ExternalProtocolIdentity>()

export function registerCoordinatorOpenCodeTools(sessionId: string, identity: ExternalProtocolIdentity): void {
  opencodeRegistry.set(sessionId, identity)
}

export function unregisterCoordinatorOpenCodeTools(sessionId: string): void {
  opencodeRegistry.delete(sessionId)
}

/** Dispatch an OpenCode coordinator-plugin tool call for a registered session. Returns null if the session isn't a coordinator participant or the tool name isn't one of ours. */
export function dispatchCoordinatorOpenCodeToolCall(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean } | null> {
  return dispatchByRegistry(opencodeRegistry, sessionId, toolName, args)
}
