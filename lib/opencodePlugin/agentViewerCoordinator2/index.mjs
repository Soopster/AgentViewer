// Agent Viewer's Coordinator tools for OpenCode 2 servers — the counterpart to
// ../agentViewerCoordinator.mjs, which is an OpenCode 1 plugin and cannot be
// loaded by a 2.x server at all. Two things changed and both are structural:
//
//  - A 1.x plugin is a single file exporting a factory that returns hooks. A
//    2.x plugin is a *directory* whose entrypoint default-exports
//    `{ id, setup(context) }`, and a file path is refused outright ("configured
//    plugin path must be a directory").
//  - Tools are registered through `context.tool.transform`, and a tool's input
//    is declared as plain JSON Schema. 1.x wanted a zod schema built with the
//    SDK's own `tool.schema`, which is why that file imports
//    `@opencode-ai/plugin`; this one needs no SDK import at all, and so cannot
//    drift out of step with whichever plugin package happens to be installed.
//
// Everything else is deliberately identical: the same provider-neutral tool
// contract, the same local HTTP bridge, the same "not part of a run" answer for
// a session that isn't a Coordinator participant. See ../agentViewerCoordinator.mjs
// for why every session on the server sees these tools.
import { COORD_TOOL_SPECS } from '../../coordinatorToolContract.mjs'

function jsonSchemaField(field) {
  switch (field.t) {
    case 'string': {
      const schema = { type: 'string' }
      if (field.min !== undefined) schema.minLength = field.min
      if (field.max !== undefined) schema.maxLength = field.max
      return schema
    }
    case 'enum':
      return { type: 'string', enum: field.values }
    case 'number': {
      const schema = { type: field.int ? 'integer' : 'number' }
      if (field.min !== undefined) schema.minimum = field.min
      if (field.max !== undefined) schema.maximum = field.max
      return schema
    }
    case 'boolean':
      return { type: 'boolean' }
    case 'stringArray': {
      const schema = { type: 'array', items: { type: 'string', minLength: 1 } }
      if (field.min !== undefined) schema.minItems = field.min
      if (field.max !== undefined) schema.maxItems = field.max
      return schema
    }
    default:
      return {}
  }
}

function jsonSchema(fields) {
  const properties = {}
  const required = []
  for (const [key, field] of Object.entries(fields)) {
    properties[key] = jsonSchemaField(field)
    if (!field.optional) required.push(key)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
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

export default {
  id: 'agent-viewer-coordinator',
  setup: async (context) => {
    const registration = await context.tool.transform((editor) => {
      for (const spec of COORD_TOOL_SPECS) {
        editor.add({
          name: spec.name,
          description: spec.description,
          input: jsonSchema(spec.fields),
          execute: async (args, toolContext) => ({
            content: await callBridge(spec.name, args ?? {}, toolContext),
          }),
        })
      }
    })
    return () => registration.dispose()
  },
}
