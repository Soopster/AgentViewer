# AHP Gap Audit — agentViewer vs upstream spec (0.5.1 → 0.8.0-unreleased)

Scope: agentViewer's AHP surface is `lib/ahpHost.ts`, `lib/ahpCoordinator.ts`,
`lib/ahpResources.ts`, `lib/ahpTerminals.ts`, `bin/agent-viewer-ahp.ts`,
`scripts/ahpSmoke.ts`. `app/api/agent-protocol/**` is the Coordinator's own
runs API (task board, playbooks, run lifecycle) — it does not touch AHP
protocol types at all and is out of scope.

**Package pin vs spec**: `package.json` pins `@microsoft/agent-host-protocol
^0.7.0`, and the installed `node_modules` copy is exactly `0.7.0`
(`PROTOCOL_VERSION = '0.7.0'`, `SUPPORTED_PROTOCOL_VERSIONS = ['0.7.0',
'0.6.0', '0.5.2', '0.5.1']`). All 0.6.0/0.7.0 types referenced below
(`ToolResultTerminalContent.result`, `isPty`, `AgentCapabilities`,
`ChangesetCapabilities`, `ToolCallStatus.AuthRequired`, etc.) are **already
present in the installed type defs** — every gap here is a missing
implementation, not a missing dependency. `0.8.0` is unreleased upstream with
no `Added` entries yet, so there is nothing to implement for it and no
version bump is needed right now.

agentViewer's AHP host is a thin Coordinator projection (task board +
mailbox + terminals), not a full chat/tool-execution agent host. Most
`chat/*` and tool-call machinery it exposes exists only to *represent*
Coordinator run state (agents, tasks, subagent spawn edges) as AHP chat
turns — it does not run a real LLM turn loop. That materially shapes which
gaps are "real missing features" vs "not applicable to this host's model."

---

## 1. Multiroot working directories (0.7.0) — **PARTIAL**

**Upstream**: `AgentCapabilities.multipleWorkingDirectories` (with
`immutablePrimary`), `CreateSessionParams.workingDirectories` /
`SessionMetadata.workingDirectories` / mirrored onto `SessionState`/
`SessionSummary`, `CreateChatParams.workingDirectories` / `ChatState`/
`ChatSummary.workingDirectories`, and the client-dispatchable
`session/workingDirectorySet`, `session/workingDirectoryRemoved`,
`chat/workingDirectorySet`, `chat/workingDirectoryRemoved` actions.

**Current status**:
- `lib/ahpHost.ts:116-118` (`usesWorkingDirectoryArrays`) and `:120-137`
  (`adaptWorkingDirectoriesForVersion`) exist, but they only do **wire-shape
  downgrading**: for clients negotiated below 0.7.0, they rewrite an
  outgoing `workingDirectories: string[]` field back into a legacy singular
  `workingDirectory: string`. This is response-side version adaptation, not
  multiroot support.
- `lib/ahpHost.ts:1007-1010` (`createSession`): when the negotiated version
  is ≥0.7.0, it reads `params.workingDirectories` but only takes
  `stringArray(params.workingDirectories)[0]` — the **first entry only** —
  and discards the rest. The resulting run only ever gets a single
  `baseCwd` (`createExternalProtocolRun({ ..., baseCwd: cwd, ... })`,
  `lib/ahpHost.ts:1010-1028`).
- `lib/ahpCoordinator.ts:173,196` / `:282,293` / `:319,329`: `SessionState`/
  `SessionSummary`/`chatSummary()` all emit `workingDirectories: [fileUri(...)]`
  — a **single-element array**, always derived from `agent.worktreePath` or
  `run.baseCwd`. This satisfies the 0.7.0 wire shape superficially but there
  is no actual multi-root session — a session can never carry more than one
  working directory in agentViewer's model (each Coordinator run/worktree
  has exactly one cwd).
- `AgentCapabilities.multipleWorkingDirectories` is **never advertised**:
  `lib/ahpCoordinator.ts:374-381` (`coordinatorRootState` → `AgentInfo[]`)
  sets `capabilities: {}` for every provider — an empty object, no
  `multipleWorkingDirectories`, no `immutablePrimary`, and (bonus finding,
  see §7) no `multipleChats` either.
- The four write-ahead actions are **entirely unhandled**. `lib/ahpHost.ts`'s
  dispatch-action handler only special-cases `session/activeClientSet` and
  `session/activeClientRemoved` (`:1086-1172`); everything else — including
  `session/workingDirectorySet`, `session/workingDirectoryRemoved`,
  `chat/workingDirectorySet`, `chat/workingDirectoryRemoved` — falls through
  to the generic rejection at `lib/ahpHost.ts:1174-1182` (`"Action ... is not
  writable on the Coordinator projection"`).

**Effort**: **medium**. The wire-shape plumbing (adapt helper, array field
population) is already done for the single-root case. Real work is: (a)
decide/model what a "second working directory" even means for a Coordinator
run (there's no existing multi-cwd concept — likely N/A given one
worktree per run/agent), (b) advertise the capability with
`immutablePrimary: true` once (a) is decided (or explicitly advertise
`multipleWorkingDirectories: false`/omit it, which is arguably the honest
answer given the one-worktree-per-agent model), (c) wire the four actions
into the dispatch switch (straightforward given the existing pattern, but a
no-op/rejection is defensible since it's currently silently rejected without
being spec-accurate). Realistically: **advertise the capability honestly and
handle the four actions with a spec-correct rejection reason is small; true
multi-root session support is large** and probably not worth it for this
host's single-worktree-per-run model.

---

## 2. Terminal `result` (exitCode/preview/truncated) + `isPty` (0.6.0/0.7.0) — **ABSENT**

**Upstream**: `result` on `ToolResultTerminalContent` (`exitCode`,
`preview`, `truncated`), populated once the command exits; optional `isPty`
on `ToolResultTerminalContent` and `TerminalState`.

**Current status** (`lib/ahpTerminals.ts`):
- `TerminalStateValue.isPty` is a **hardcoded literal `false`** at the type
  level (`:26`) and construction site (`:149`) — accurate in the sense that
  `AhpTerminalManager.create()` always spawns a plain non-PTY
  `child_process` (`spawn(shell.command, ...)`, `:136-140`), but it's a
  dead/static field, not real `isPty` support (no PTY-backed terminal path
  exists at all to make it ever `true`).
- There is **no `result` object anywhere**. `TerminalStateValue` only has a
  legacy flat `exitCode?: number` (`:23`, set at `:163` in the `child.once
  'exit'` handler) — the old `ToolResultTerminalCompleteContent`-era shape
  that 0.7.0's changelog says was *removed* in favor of `result` living on
  `ToolResultTerminalContent`. No `preview` (truncated tail of output) or
  `truncated` flag is tracked or emitted.
- Search confirms `ToolResultTerminalContent` is not referenced anywhere in
  agentViewer's source (`grep -rn ToolResultTerminalContent lib/` → no
  hits), so this isn't a wrong-shape issue, it's a fully missing type.

**Effort**: **small**. `AhpTerminalManager` already tracks `content` (raw
output chunks) and `exitCode` on process exit
(`lib/ahpTerminals.ts:162-169`); adding `preview` (last N chars of joined
`content`) + `truncated` + moving/mirroring into a `result` field on exit is
a contained change to the `TerminalStateValue` type and the `child.once
'exit'` handler. `isPty` can stay `false` (accurate) unless/until a real PTY
path is added.

---

## 3. Side chats (0.7.0) — **ABSENT**

**Upstream**: capability-gated side chats that can start from a chat turn
and return bounded chat transcripts as message attachments; `createChat`
`source: { kind: 'side-chat', ... }` (with immutable selected-text snapshot
+ optional response-part provenance); `chat/toolCallReady` finalizing a
provisional tool-call contributor/intention.

**Current status**: No `createChat` RPC handler exists in `lib/ahpHost.ts`
at all (`grep -n "createChat" lib/ahpHost.ts` → no hits) — only
`createSession` and `createTerminal`. `ChatOrigin` usage is limited to the
`kind: 'tool'` variant for representing a spawned subagent
(`lib/ahpCoordinator.ts:179`, `ToolResultSubagentContent`) — there is no
concept of a chat spawned as a side conversation from within another chat's
turn, and no `chat/toolCallReady` action is emitted or handled anywhere.

**Effort**: **large**. This requires a genuinely new subsystem — a
`createChat` command, chat-to-chat parent/child bookkeeping distinct from
the existing agent/subagent spawn model, and a bounded-transcript
attachment mechanism. Given agentViewer's Coordinator chats are
synthesized read-only projections of run/agent state (not live LLM turn
loops a user can branch off of), it's unclear side chats have a natural
mapping onto this host at all — flagged as a design question, not just an
implementation gap.

---

## 4. Tool-call auth-required flow (0.6.0) — **ABSENT**

**Upstream**: `ToolCallStatus.AuthRequired`, `chat/toolCallAuthRequired` /
`chat/toolCallAuthResolved` actions, `McpAuthRequirement`, a new
`toolAuthentication` `SessionInputRequest` variant, `AuthenticateParams`
gaining `scopes`, `chat/toolCallComplete` accepting a failed result while
`auth-required`.

**Current status**: No matches anywhere in the AHP surface for
`AuthRequired`, `toolCallAuth`, `McpAuthRequirement`, or
`toolAuthentication` (`grep -n` across `lib/ahpHost.ts`,
`lib/ahpCoordinator.ts` → no hits). agentViewer's AHP host doesn't model MCP
servers or MCP-contributed tool calls at all (no `McpServerCustomization`
handling either — see §8), so this entire OAuth-mid-tool-call pause/resume
flow has no substrate to attach to.

**Effort**: **large** (net-new subsystem; depends on MCP server modeling
existing first, which it currently doesn't).

---

## 5. Changeset review capability (0.5.2/0.6.0) — **ABSENT** (broader than asked)

**Upstream**: `Changeset.capabilities.review` (`ChangesetCapabilities`)
flag; `changeset/filesReviewChanged` (renamed in 0.6.0 from
`changeset/filesReviewedChanged`, field `fileIds`→`files`, now
client-dispatchable) toggling a file's `reviewed` flag.

**Current status**: `grep -rn "Changeset\|changeset"
lib/ahpHost.ts lib/ahpCoordinator.ts lib/ahpResources.ts` → **zero hits**.
agentViewer's AHP host does not implement the `changeset` concept at all —
no `Changeset`/`ChangesetFile`/`ChangesetOperation` state, no
`session/changesetsChanged`, no `ahp-changeset:` channel. So the specific
ask (`.capabilities.review` + `filesReviewChanged`) is moot until changesets
exist at all — this is not a "wrong shape" gap, it's "the whole feature
family (0.2.0+) was never built."

Note: agentViewer *does* have its own rich diff/changeset-like UI (Git
popover, PR review views, code provenance — see memory) — but none of that
is exposed over the AHP protocol surface; it's local-only web/TUI feature
work, unrelated to this audit's `lib/ahp*.ts` scope.

**Effort**: **large** for full changeset support (new channel + full CRUD
action family); the specific `capabilities.review` flag audited here is
**not applicable** until that foundation exists.

---

## 6. Async tool-call risk assessments (0.6.0) — **ABSENT**

**Upstream**: model-provided explanation + normalized safety score on tool
calls, delivered asynchronously.

**Current status**: `grep -in risk lib/ahpHost.ts lib/ahpCoordinator.ts` →
no hits. No risk-assessment concept exists. Same root cause as §4/§5 — this
host doesn't run a live tool-call execution loop with confirmation/risk
gating; it only *represents* Coordinator task state as synthetic completed
tool calls (`ToolResultSubagentContent` spawn edges).

**Effort**: **medium-large** — depends on what "risk" would even mean for a
Coordinator task-spawn tool call (there's no live confirmation gate to
attach a score to today).

---

## 7. Bonus finding: `AgentCapabilities` advertised as empty for every provider

`lib/ahpCoordinator.ts:374-381` (`coordinatorRootState`):

```ts
const agents: AgentInfo[] = PROVIDERS.map(({ provider, displayName }) => ({
  provider,
  displayName,
  description: `Run ${displayName} in an Agent Viewer multi-agent Coordinator session.`,
  models: [],
  capabilities: {},
} as AgentInfo))
```

`capabilities: {}` means **no** capability is advertised for any provider —
not `multipleChats` (0.5.1, `{ fork: boolean }`), not
`multipleWorkingDirectories` (0.7.0). Clients that gate UI on advertised
capabilities (per the 0.5.1 changelog: "clients gate multi-chat and fork via
advertised capabilities instead of provider-id switches") will treat every
agentViewer-backed provider as supporting neither, even though Coordinator
runs functionally do support multiple concurrent chats (one per spawned
agent) today. This is a quick, high-value fix independent of the
multi-root work in §1.

**Effort**: **trivial** for `multipleChats: { fork: false }` (Coordinator
sessions already reject `params.fork`, `lib/ahpHost.ts:995-997`, so `fork:
false` is accurate); bundled with §1's capability decision for
`multipleWorkingDirectories`.

---

## 8. Version negotiation — correctness check: **OK, but worth flagging**

- `initialize()` (`lib/ahpHost.ts:722-781`) correctly intersects
  `params.protocolVersions` against `AHP_PROTOCOL_VERSIONS`
  (`SUPPORTED_PROTOCOL_VERSIONS` re-exported verbatim from the SDK,
  `lib/ahpHost.ts:5,61`) and picks the client's most-preferred mutually
  supported version, matching spec.
- `isActionKnownToVersion` (SDK-provided) is used correctly at replay time
  (`lib/ahpHost.ts:877-879`) and on emit (`:587`) to avoid sending actions a
  lower-versioned client doesn't understand.
- Because the installed package is `0.7.0`, `AHP_PROTOCOL_VERSIONS` only
  ever contains `['0.7.0','0.6.0','0.5.2','0.5.1']` — a client offering only
  `'0.8.0'` would fail negotiation entirely with
  `UnsupportedProtocolVersion`. Not a bug today (no `0.8.0` client exists
  yet), but worth remembering when `0.8.0` ships and clients start dropping
  `0.7.0` from their offered list.
- 0.7.0 "Removed"/"Fixed" changelog entries are **not applicable**:
  `ToolResultTerminalCompleteContent` was never referenced in agentViewer to
  begin with (nothing to remove); the non-standard
  `resource_encryption_alg_values_supported`/`_enc_values_supported`
  `ProtectedResourceMetadata` fields were never emitted (no
  `ProtectedResourceMetadata`/OAuth surface exists at all, consistent with
  §4); `createChat.source` discriminated-union fix is moot since
  `createChat` isn't implemented (§3).

**Effort**: n/a — no action needed now; flag for when `0.8.0` is tagged.

---

## 9. Other 0.5.x features scanned, out of the requested focus set, noted briefly

Quick scan for completeness (not deeply investigated — lower priority, all
pre-0.6.0):

- `SessionState.inputNeeded` / `session/inputNeededSet` /
  `session/inputNeededRemoved` (0.5.1): **absent** (no grep hits). Would let
  a client discover pending Coordinator inputs (e.g. plan approval) from the
  session channel instead of a bespoke mechanism — agentViewer already has
  its own plan-approval flow (`coord_submit_plan`/`coord_review_plan`) built
  outside AHP, so this is a "protocol parity" nice-to-have, not a functional
  gap. **small-medium**.
- `root/progress` / `createSession.progressToken` (0.5.0): **absent**. No
  progress notifications during session bring-up. **small**.
- Cursor-based `listSessions` pagination (0.5.1): **present and correct** —
  `lib/ahpHost.ts:911-935` implements `limit`/`cursor`/`nextCursor` matching
  the 0.5.1 shape.
- `SessionModelInfo.maxOutputTokens`/`maxPromptTokens` (0.5.0): **absent**
  (not surprising — Coordinator "sessions" aren't a single model, they're
  multi-agent runs). **n/a / not applicable to this host's model.**

---

## Summary table

| # | Feature | Version | Status | Effort |
|---|---|---|---|---|
| 1 | Multiroot working directories + actions | 0.7.0 | Partial (wire adapter only; capability unadvertised; actions unhandled) | medium |
| 2 | Terminal `result` + `isPty` | 0.6.0/0.7.0 | Absent | small |
| 3 | Side chats / `createChat` | 0.7.0 | Absent | large |
| 4 | Tool-call auth-required flow | 0.6.0 | Absent | large |
| 5 | Changeset review capability | 0.5.2/0.6.0 | Absent (no changesets at all) | large |
| 6 | Async tool-call risk assessments | 0.6.0 | Absent | medium-large |
| 7 | `AgentCapabilities` advertised empty | 0.5.1/0.7.0 | Bug-ish gap (bonus) | trivial |
| 8 | Version negotiation correctness | — | OK | n/a |
| 9 | `inputNeeded`, `root/progress` | 0.5.0/0.5.1 | Absent, low priority | small–medium |

**Recommended near-term action** (small/trivial, high value): #7
(advertise real `AgentCapabilities`) and #2 (terminal `result`/`isPty`).
#1 needs a design decision first (does "multi-root" mean anything for a
one-worktree-per-agent Coordinator run?) before it's worth coding. #3/#4/#5/#6
are all large, net-new subsystems that don't have an obvious home in this
Coordinator-projection host today — recommend explicit user sign-off before
starting any of them.
