// What each API route requires of a paired remote device.
//
// proxy.ts used to infer this from the HTTP method: a read-only device was
// refused any mutating method. That is a proxy for intent, not intent, and it
// was wrong in both directions —
//
//   - `POST /api/sessions/project/messages` is a pure read (it calls
//     listProjectSessionMessageBatches), so a read-only phone could watch a
//     session but not load the project feed;
//   - `GET /api/remote-access` hands back the live pairing token, so a
//     read-only device could mint itself a full-scope pairing — a privilege
//     escalation a method check cannot see.
//
// So the requirement is declared per route and method instead. `read` is
// reachable by a `read-only` pairing; `write` requires `full`.
//
// Two rules keep this honest, mirroring lib/adapters/registry.ts:
//
//   1. **Anything undeclared is `write`.** A new route is locked to full scope
//      until someone decides otherwise, so forgetting an entry fails closed.
//   2. **`npm run routes:smoke` asserts every route file and every method it
//      exports appears below**, so a route cannot be added without that
//      decision being made explicitly.

export type RouteScope = 'read' | 'write'
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/** Route pattern (Next's own path shape) → scope per exported method.
 *  Every method a route exports must be listed, `write` included, so the
 *  smoke can tell "decided to be write" from "nobody looked at it". */
export const ROUTE_SCOPES: Record<string, Partial<Record<HttpMethod, RouteScope>>> = {
  // --- Sessions: the read surface a watching device needs ----------------
  '/api/sessions': { GET: 'read' },
  '/api/sessions/[sessionId]': { GET: 'read', PATCH: 'write', DELETE: 'write' },
  '/api/sessions/[sessionId]/messages': { GET: 'read', POST: 'write' },
  '/api/sessions/[sessionId]/messages/events': { GET: 'read' },
  // The raw provider frame carries whatever the provider sent — file
  // contents, full tool output. The route enforces this itself too.
  '/api/sessions/[sessionId]/messages/[uuid]/raw': { GET: 'write' },
  '/api/sessions/[sessionId]/models': { GET: 'read' },
  '/api/sessions/[sessionId]/diagnostics': { GET: 'read' },
  '/api/sessions/[sessionId]/commands': { GET: 'read' },
  '/api/sessions/[sessionId]/subagents': { GET: 'read' },
  '/api/sessions/[sessionId]/subagents/[agentId]/messages': { GET: 'read' },
  '/api/sessions/[sessionId]/running': { GET: 'read' },
  '/api/sessions/[sessionId]/provenance': { GET: 'read' },
  '/api/sessions/[sessionId]/bookmarks': { GET: 'read', POST: 'write' },
  '/api/sessions/[sessionId]/inbox': { GET: 'read', POST: 'write' },
  '/api/sessions/[sessionId]/composer': { GET: 'read', POST: 'write' },
  // The bug this table exists for: a POST that only reads.
  '/api/sessions/project/messages': { POST: 'read' },
  '/api/sessions/running': { GET: 'read', POST: 'write', DELETE: 'write' },
  '/api/sessions/new': { POST: 'write' },
  '/api/sessions/[sessionId]/actions': { POST: 'write' },
  '/api/sessions/[sessionId]/fork': { POST: 'write' },
  '/api/sessions/[sessionId]/rewind': { POST: 'write' },
  '/api/sessions/[sessionId]/interrupt': { POST: 'write' },
  // Spends model tokens, so not a read however much it looks like one.
  '/api/sessions/[sessionId]/insights': { POST: 'write' },
  '/api/sessions/[sessionId]/coord-join': { POST: 'write', DELETE: 'write' },

  // --- Search and history ------------------------------------------------
  '/api/session-index/search': { GET: 'read' },
  '/api/session-index/stats': { GET: 'read' },
  '/api/session-index/analytics': { GET: 'read' },
  '/api/session-index/rebuild': { POST: 'write' },
  '/api/bookmarks': { GET: 'read' },
  '/api/provenance/blame': { GET: 'read' },

  // --- Providers ---------------------------------------------------------
  '/api/provider': { GET: 'read', PATCH: 'write' },
  '/api/provider/instances': { GET: 'read' },

  // --- Files and source control ------------------------------------------
  '/api/files': { GET: 'read' },
  '/api/files/edit': { GET: 'read', POST: 'write' },
  // The action lives in the body ('data' reads, others mutate), so the method
  // cannot separate them. Fail closed rather than parse the body here.
  '/api/git': { POST: 'write' },
  '/api/github/pr': { POST: 'write' },
  '/api/worktrees': { GET: 'read', POST: 'write' },

  // --- Remote access -----------------------------------------------------
  // GET returns the live pairing token; a read-only device must not be able
  // to read it and pair itself a full-scope credential.
  '/api/remote-access': { GET: 'write', POST: 'write' },
  // Must be reachable before a device has any scope at all. proxy.ts also
  // exempts it earlier so it can return its own 401.
  '/api/remote/handshake': { POST: 'read' },

  // --- Agents, coordination, bridges -------------------------------------
  '/api/agents': { GET: 'read' },
  '/api/agents/message': { POST: 'write' },
  '/api/bridge-messages': { GET: 'read', POST: 'write' },
  '/api/pi/activity': { GET: 'read' },
  '/api/prompts': { GET: 'read', POST: 'write' },
  '/api/prompts/[slug]': { GET: 'read', PUT: 'write', DELETE: 'write' },
  '/api/agent-protocol/runs': { GET: 'read', POST: 'write' },
  '/api/agent-protocol/runs/changes': { GET: 'read' },
  '/api/agent-protocol/runs/[runId]': { GET: 'read', PATCH: 'write', DELETE: 'write' },
  '/api/agent-protocol/runs/[runId]/events': { GET: 'read', POST: 'write' },
  '/api/agent-protocol/runs/[runId]/stop': { POST: 'write' },
  '/api/agent-protocol/runs/[runId]/cleanup': { POST: 'write' },
  '/api/agent-protocol/playbooks': { GET: 'read', PUT: 'write', DELETE: 'write' },
  '/api/agent-protocol/external': { POST: 'write' },
  // Bearer-authenticated external facade; proxy.ts exempts it and it owns its
  // own auth gate. Declared so the smoke sees a decision.
  '/api/a2a': { POST: 'write' },
  '/api/a2a/[runId]': { POST: 'write' },

  // --- Terminal ----------------------------------------------------------
  // Watching output is a read; typing into a shell is emphatically not.
  '/api/terminal/stream': { GET: 'read' },
  '/api/terminal/input': { POST: 'write' },
  '/api/terminal/resize': { POST: 'write' },
  '/api/terminal/session': { DELETE: 'write' },

  // --- Process diagnostics -----------------------------------------------
  // A heap snapshot or CPU profile is a dump of this process's memory, which
  // can contain credentials and transcript content. Full scope only.
  '/api/diagnostics/heap-snapshot': { GET: 'write' },
  '/api/diagnostics/cpu-profile': { GET: 'write' },
  '/api/diagnostics/runtime': { GET: 'write' },
}

type CompiledRoute = { regex: RegExp; literals: number; methods: Partial<Record<HttpMethod, RouteScope>> }

function compile(pattern: string): CompiledRoute {
  const segments = pattern.split('/').filter(Boolean)
  const literals = segments.filter((segment) => !segment.startsWith('[')).length
  const source = segments
    .map((segment) => {
      if (segment.startsWith('[...')) return '.+'
      if (segment.startsWith('[')) return '[^/]+'
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return { regex: new RegExp(`^/${source}/?$`), literals, methods: ROUTE_SCOPES[pattern] }
}

const COMPILED: CompiledRoute[] = Object.keys(ROUTE_SCOPES).map(compile)

/** The scope a request needs.
 *
 *  Where several patterns match — `/api/sessions/running` also matches
 *  `/api/sessions/[sessionId]` — the one with more literal segments wins, which
 *  is the same specificity rule the router itself applies. Anything undeclared
 *  is `write`, so a new route is locked down until someone decides otherwise. */
export function requiredScopeFor(method: string, pathname: string): RouteScope {
  let best: CompiledRoute | undefined
  for (const route of COMPILED) {
    if (!route.regex.test(pathname)) continue
    if (!best || route.literals > best.literals) best = route
  }
  return best?.methods[method.toUpperCase() as HttpMethod] ?? 'write'
}
