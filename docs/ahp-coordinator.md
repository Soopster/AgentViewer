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

- Every command and notification carries a top-level `params.channel`.
- `initialize` negotiates a SemVer protocol version from the client's offered
  list. Unsupported versions return AHP error `-32005`.
- A connection receives immutable snapshots and ordered action envelopes.
- Client-originated actions are echoed with `{ clientId, clientSeq }` only
  after validation; rejected actions are echoed with `rejectionReason`.
- Reconnect replays retained actions when possible and otherwise returns fresh
  snapshots for every still-valid subscription.
- Unknown actions are ignored by clients, per the AHP forward-compatibility
  rule. Agent Viewer metadata is namespaced and opaque to generic AHP clients.

## Transport

AHP is transport-agnostic. Agent Viewer supports newline-framed stdio, a
newline-framed TCP stream (`--listen`), and standard WebSocket message frames
(`--ws`). The protocol engine is independent of the transport, so every mode
shares the same request and notification behavior.
