# Agent Host Protocol adaptation

Agent Viewer exposes Coordinator runs as Agent Host Protocol (AHP) sessions.
The adaptation targets the current draft protocol model without discarding the
Coordinator features that AHP intentionally does not define.

## Mapping

| Coordinator | AHP |
| --- | --- |
| Run | `ahp-session:/<run-id>` session |
| Lead or teammate | `ahp-chat:/<run-id>/<agent-id>` chat |
| Lead | Default read-only Coordinator chat |
| Teammate | Read-only worker chat |
| External CLI participant | Session `activeClients` entry |
| Task board, locks, mailbox, phases | `SessionState._meta["dev.agent-viewer.coordinator"]` |
| Ordered ledger change | AHP `action` notification with `serverSeq` |
| Resume after disconnect | AHP `reconnect` replay, with snapshot fallback |

AHP is a host/client state synchronization protocol, not a standardized task
board or mailbox. The Coordinator ledger remains authoritative for claiming,
dependencies, plan approval, path locks, durable messages, and completion
gates. AHP replaces the bespoke external state projection and gives clients a
standard synchronized view of that ledger.

Coordinator chats are intentionally read-only AHP projections. Active clients
perform workflow mutations through their published Coordinator tools; the host
does not claim support for `chat/turnStarted`, `createChat`, or mutable working
directory actions.

## Compatibility rules

- The supported version list comes from the installed reference SDK. Agent
  Viewer currently prefers published AHP 0.6.0 and retains the SDK's 0.5.x
  fallbacks; it never negotiates an unreleased draft version.
- Every command and notification carries a top-level `params.channel`.
- `initialize` negotiates a SemVer protocol version from the client's offered
  list. Unsupported versions return AHP error `-32005`.
- A connection receives immutable snapshots and ordered action envelopes.
- Client-originated actions are echoed with `{ clientId, clientSeq }` only
  after validation; rejected actions are echoed with `rejectionReason`.
- Reconnect replays retained actions when possible and otherwise returns fresh
  snapshots for every still-valid subscription.
- Actions and protocol notifications are filtered against the negotiated
  protocol version before delivery. Agent Viewer metadata is namespaced and
  opaque to generic AHP clients.

Feature availability is capability-driven. The Coordinator projection does
not advertise authentication, telemetry, changesets, multi-chat, forking, or
MCP Apps, because it cannot honor those optional surfaces. In particular, the
AHP `mcp://` side-channel is only for capability-advertised MCP Apps traffic;
ordinary Coordinator MCP calls instead share one durable AHP connection and
the namespaced `agent-viewer/coordinator` request described below.

## Published 0.6 feature matrix

| AHP surface | Agent Viewer behavior |
| --- | --- |
| JSON-RPC framing and channel routing | Supported on stdio, TCP, and WebSocket; every request and notification is routed by top-level `channel`. |
| Initialize, version negotiation, identity, locale, capabilities | Supported. Versions come from the Microsoft TypeScript SDK registry; implementation identity is informational and optional client fields are accepted. |
| Subscribe/unsubscribe and snapshot views/delivery hints | Supported. Coordinator channels return full immutable snapshots; advisory view and delivery hints are safely ignored. |
| Ordered actions and write-ahead reconciliation | Supported, including origin echo, rejection reasons, per-version filtering, replay, and snapshot fallback. |
| Root and session catalogues | Supported, including list pagination and add/remove/summary notifications. |
| Chat channels | Supported as read-only lead/worker projections. Durable mailbox messages are completed turns; completions and turn-fetch commands return the complete retained projection. Multi-chat creation/forking is not advertised. |
| Resource commands and watches | Supported for authorised run/worktree `file:` resources, including read, write, list, copy, delete, move, resolve, mkdir, grants, and watch actions. |
| Terminal channels | Supported, including create/dispose, claim validation, input, resize, title, cwd, clear, exit, and command-detection state. |
| Authentication | Not advertised: Agent Viewer providers authenticate through their native SDK/CLI, so AHP agents expose no protected resources and `authenticate` rejects unadvertised resources. |
| Changesets and annotations | Not advertised. Coordinator path locks and task evidence are workflow state, not AHP changesets. |
| Telemetry | Not advertised; `InitializeResult.telemetry` is absent and no `ahp-otlp:` channel exists. |
| MCP Apps `mcp://` side-channel | Not advertised. The Coordinator host is not itself running the per-CLI MCP server, and AHP 0.6 only defines this side-channel for capability-advertised MCP Apps traffic. |
| MCP Coordinator bridge | Supported through the namespaced `agent-viewer/coordinator` AHP request on the bridge's persistent connection, with exact MCP tool identities projected into standard AHP active-client state. |

## Transport

AHP is transport-agnostic. Agent Viewer supports newline-framed stdio, a
newline-framed TCP stream (`--listen`), and standard WebSocket message frames
(`--ws`). The protocol engine is independent of the transport, so every mode
shares the same request and notification behavior.

`agent-viewer web` starts a WebSocket host by default on the web port plus one.
The MCP bridge and autonomous Coordinator worker keep one AHP connection open
and send their `coord_*` operations through the namespaced
`agent-viewer/coordinator` request method. Its payload is handled by the same
capability, idempotency, and persistence dispatcher as the compatibility HTTP
route. Generic AHP clients can ignore this extension and continue using the
standard session projection.

When the MCP bridge joins a run, it publishes the exact callable `coord_*` MCP
tool names in its AHP active-client capabilities. The session projection turns
those into standard AHP `ToolDefinition` entries; it never publishes a
non-callable wildcard tool identity. Durable Coordinator mailbox traffic is
also projected into completed AHP chat turns, so generic AHP clients receive a
standard transcript rather than having to parse the namespaced metadata.

After a socket loss, the bridge uses AHP `reconnect` with its last server
sequence and every bound run subscription. Transport closure releases the old
client ID immediately even when a `coord_wait` is still executing, so a worker
does not wait for the old long poll to expire before reconnecting. Read
operations and mutations backed by a stable idempotency key receive one
automatic transport retry; MCP supplies a per-call key when the caller omits
one. Create and join are never replayed automatically because duplicating a
participant would be less safe than surfacing the transport error.

Set `AGENT_VIEWER_AHP_URL` when the AHP socket is not on the derived port. Set
`AGENT_VIEWER_COORD_TRANSPORT=http` to opt into the legacy HTTP transport, or
start the web daemon with `--no-ahp` when no Coordinator clients will use AHP.
