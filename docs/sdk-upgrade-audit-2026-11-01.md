# Dependency and agent SDK audit — 2026-11-01

24 direct dependencies were updated against live npm registry metadata, plus
the `ws` and `protobufjs` overrides. Unchanged dependencies were already at the
registry's stable `latest` version. npm, Bun, and pnpm lockfiles were refreshed.

| Integration | Before | After |
| --- | --- | --- |
| Claude Agent SDK | 0.3.300 | 0.3.316 |
| Anthropic API SDK | 0.134.0 | 1.3.0 |
| Copilot SDK | 1.0.22 | 1.0.28 |
| Pi core, AI, coding agent | 1.2.0 | 1.4.0 |
| OpenCode v1 SDK and plugin | 1.19.0 | 1.19.5 |
| OpenCode v2 client | 2.0.29 | 2.2.5 |
| ACP SDK | 1.8.0 | 2.2.0 |
| MCP client and server | 2.3.1 | 2.4.0 |
| OpenTUI core and React | 0.6.6 | 0.8.1 |
| Pierre diffs | 1.5.2 | 1.6.2 |
| Next.js | 16.4.1 | 16.4.3 |

`@earendil-works/pi-server` remains at its latest published version, 1.1.0.
Pi removed its experimental server/client/plugin stack from subsequent coding
agent releases. Updating the coding SDK does not provide an upgraded Pi server.

## Compatibility changes included

- ACP 2's default entry point now validates only stable ACP v1 features. All
  Agent Viewer ACP imports explicitly select `/unstable`, preserving the
  existing resume, capability and elicitation contract. This does **not**
  change the negotiated protocol to ACP v2. See the installed SDK's
  `MIGRATION_STABLE_UNSTABLE.md` and the
  [ACP release notes](https://github.com/agentclientprotocol/typescript-sdk/releases).
- Copilot removed `CopilotClientOptions.enableRemoteSessions`. Removed the
  obsolete `COPILOT_REMOTE` assignment. Cloud session creation is a different
  feature and is not silently substituted for Mission Control sharing.
- Pierre's CodeView annotation callback now receives annotation, file/diff,
  then item. Updated the PR review callback to use the exported tuple type.
- OpenTUI scroll content is now a geometry facade, not a renderable. Updated
  bounded card traversal, layout offsets and smoke/performance traversal;
  removed the write to the now read-only native scrollbar extent.
- Claude's new `sandbox_required_unavailable` startup failure now provides an
  actionable hint in live messages, saved messages and terminal result cards.

OpenTUI 0.8.1 supports Bun >=1.3.14, or Node >=26.4.0 with its Node FFI setup.
Agent Viewer's terminal entry point still runs on Bun; checks here used Bun
1.4.2. Do not infer Node terminal-runtime support from the web type check.
Some registry responses still label OpenTUI core 0.5.10 as `latest`; the
verified 0.8.1 release matches the React package's exact core dependency.

## Features worth integrating next

The four requested follow-ups (1, 2, 3 and 6) are now implemented. Native
warming and OpenCode service integration remain recommendations.

### 1. Claude context attribution and cache lifetime breakdown — implemented

Session diagnostics now label known context categories by stable IDs, preserve
unknown IDs using the provider label, and continue to classify usage by `kind`.
The per-server MCP instruction estimates appear under their own heading and
are never added to the category total a second time.

A CACHE USAGE section shows each model's total cache reads/writes, 5-minute and
1-hour write counts, and writes whose lifetime is unknown. Missing fields say
"not reported" rather than zero. This reuses the existing structured usage RPC,
including API-key sessions without subscription rate limits; no extra provider
request or price-table assumption was introduced. The persistent analytics
schema and estimated-cost calculations are unchanged.

Source: installed 0.3.316 `SDKControlGetContextUsageResponse` and `ModelUsage`;
[0.3.311 release notes](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.311).

### 2. Copilot deferred tool namespaces — implemented

Coordinator tools declare the `agent_viewer_coordinator` namespace and retain
individual names, handlers, role filtering and participant identity. Status,
inbox, claim, completion and messaging are marked `defer: never`; secondary
tools use the SDK's `auto` policy. Models without namespace/deferred discovery
support retain the SDK's flat-function behavior.

The configuration checks count 5 eager / 35 automatic tools for leads and
5 eager / 19 automatic tools for teammates. This is a declaration-level count,
not a measured prompt-token or latency improvement. Authenticated Copilot
performance has not been measured. Provider recovery tests exercise the
namespaced tools' handlers and the existing coordination contract.

Source: installed 1.0.28 `Tool`, `ToolNamespace`, and `defineTool` declarations;
[Copilot releases](https://github.com/github/copilot-sdk/releases).

### 3. Claude explicit unanswered-question outcomes — implemented

Supported Web question cards offer Skip, Dismiss and Reply in chat. OpenTUI
uses Escape, `d`, and `r`; reply mode collects text and sends it on Enter.
These controls require the query's init message to advertise
`ask_user_question_unanswered_v1`. Capability state belongs to the query and
survives cold-query adoption into the pool. Older runtimes retain the existing
skip/deny path and never receive new annotation enum values.

The backend validates outcomes, preserves preview/notes, and supplies readable
text in `answers` as well as UI-only annotations: the SDK does not show those
annotations to the model. Both transcript renderers distinguish skipped,
dismissed and replied-in-chat results instead of labeling them answered.

The SDK history reader strips structured sidecars. The local SDK-observed
sidecar store now retains question output for reloads and process restarts,
isolated by provider instance/session. Its independent question budget is
256 results of at most 32,000 UTF-8 bytes each; question activity does not
consume the existing 32-result MCP App budget. Older/evicted/oversized sidecars
fall back to the SDK's textual transcript without inventing missing metadata.

Source: [0.3.312 release notes](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.312)
and installed `AskUserQuestionOutput` / init capability documentation.

### 4. Claude lighter runtime imports and native spare processes — deferred

Agent Viewer currently reuses persistent SDK `query()` processes. It does not
call the native `startup()` or `prewarm()` APIs.

The `/core` entry point now exports native `prewarm()`, while excluding session
listing/reading/import code. Existing root-level prewarming APIs predate this
update; this is an opportunity to reduce eager loading and investigate
session-independent spare processes, rather than a reason to replace the pool
immediately.

Compare module load time and first-send latency in `lib/claudePool.ts`. A spare
claim has option-overlay and hook-order constraints; retain the cold fallback,
per-session Coordinator identity, permission bridges and passive-read policy.
Do not resume existing sessions merely to warm them.

Source: installed 0.3.316 package exports, `SpareProcess` and `WarmQuery` docs;
[0.3.314 release notes](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.314).

### 5. OpenCode persistent terminal and scheduling services

The 2.2.5 generated client adds explicit experimental service groups including
`experimental.persistentPty`, `experimental.schedule`, and voice transport.
Persistent PTYs are the most relevant candidate for recovering shell windows
after a UI reconnect. Scheduling is useful only if deliberately integrated with
the existing local goal engine; adding a second continuation owner would race.

Keep these behind service capability/version checks. The current v1/v2 bridge,
history paging/cache, forms, artifacts and model variants already work and are
covered by the existing suites. They are not new feature gaps.

Source: installed 2.2.5 Promise client declarations and
[OpenCode releases](https://github.com/anomalyco/opencode/releases).

### 6. MCP skill catalogs for connected agents — implemented

The MCP bridge attaches the SDK's native SkillsExtension with one immutable,
curated catalog: coordinate-agents/SKILL.md and its two bundled reference files.
`skills/list`, `skills/get` and directory reads expose resource sizes and SHA-256
digests. The SDK client verifies reads against that catalog.

Only those three already-published files are included; workspace/user skill
folders are not scanned. Existing `skill://index.json` and Markdown URLs stay
available for legacy clients. Tests cover native listing/get, verified manifest
and reference reads, directory browsing, rejection of unpublished files, and
identical Markdown through the legacy MCP resource path.

Source: installed 2.4.0 skill extension declarations and the
[official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## Benefits already obtained from the SDK upgrades

Pi 1.4 uses the model output limit for compaction/branch summaries, queues
codemode work when workers are busy, fixes transcript recovery after truncated
tool calls, and preserves prompt caches in more cases. These are runtime
benefits of the package update, not new Agent Viewer UI features. Classifier
image input is available too, but is lower priority for a session viewer.
See the installed 1.3/1.4 changelog and
[Pi 1.4 release notes](https://github.com/earendil-works/pi/releases/tag/v1.4.0).

Claude's existing MCP Apps/artifact handling, plugin failure reporting,
background-task controls and native dialog bridge were checked before marking
anything as a gap. Copilot's auto tier and background tasks are also already
integrated.

Codex uses the separately installed `codex app-server` (0.166.0 here), not an
npm SDK dependency. Existing code already handles native goals, queue delivery,
async questions and realtime notifications. No global CLI or generated schema
was replaced. Future protocol updates should use schema generation from the
target executable and the existing alignment smoke. The
[official app-server documentation](https://learn.chatgpt.com/docs/app-server)
also documents read-only thread reads and experimental transport options;
preserve passive reads and the current stdio transport for this package refresh.

## Lockfile policy

All 84 changed npm package integrities were checked against registry
`dist.integrity`. The user approved 47 exact-version exceptions to pnpm's
seven-day release-age policy. The general age policy remains enabled. Copilot
1.0.28 also has a scoped trust-policy exception: its npm OIDC publisher
configuration, runtime repository and dependency set match the previously
excepted 1.0.22, and registry signatures are present. The maintainer list has
changed, so this is not a claim that every metadata field is identical.

pnpm reports three pre-existing peer mismatches: Pierre theming/theme,
bun-ffi-structs/TypeScript 7, and OpenAI/undici. These were present in the
pre-upgrade npm dependency tree and are not resolved with broad overrides.

## Validation

- Production `npm run build` passes, including Webpack compilation, TypeScript
  and all 55 static pages. The build required network access for Google Fonts.
- Web and OpenTUI type checks pass with `--incremental false`. Reset generated
  build-info caches after updating packages: an earlier incremental check
  incorrectly reused results from the old declarations.
- All 57 direct dependency specifications and resolved versions match across
  npm, Bun and pnpm. A final npm outdated check reports only the stale OpenTUI
  core dist-tag described above; there is no newer requested stable dependency.
- The composer suite passes, including Claude artifacts/dialogs/usage, ACP
  capabilities, Pi extension UI, queueing, rewind and handoff checks.
- OpenCode harness and feature suites pass, including localhost transport,
  2,405-message history, cache invalidation, forms, artifacts, subagent requests
  and model variants. Transport tests required execution outside the sandbox.
- ACP stdio conformance and the full ACP provider/Coordinator smoke pass. The
  latter needed subprocess permissions outside the sandbox.
- Pi provider reliability, provider pools, Pi session pool, and nine cold
  provider runtime SDK boundaries pass.
- Copilot rewind, auto tier and background-task smokes pass. Persisted-read
  smoke is blocked by `Not authenticated`; this is not live Copilot proof.
- OpenTUI render, syntax highlighting, batching, reader measurements, large
  Markdown and per-tab positions pass. Reader window tests report 162 stream
  slides and 558 conversation slides, no misplaced rows, and zero root renders.
  First-focus testing retains both tail follow and a scrolled-up viewport.
- MCP bridge, durable Tasks and AHP integration smokes pass, as do review-store
  and merge-preview checks.
- React Doctor reports no issues for changed sources. Its remote score API
  was unreachable, so no numerical score is claimed. Several rendering smokes
  emit React `act()` warnings while passing their assertions.
- The supplemental legacy Ink type check fails under its NodeNext/ES2022
  configuration, predominantly on extensionless relative imports and missing
  DOM types. No broad legacy configuration migration was included.

These are type, fixture, subprocess and renderer checks, not authenticated
end-to-end sessions against every provider.

### Follow-up validation

`npm run sdk:followups:smoke` exercises diagnostics and cache accounting,
role-filtered Copilot namespaces, capability-gated decisions, SDK-stripped
sidecar recovery, Web card rendering, MCP native/legacy discovery, and the
three OpenTUI outcome interactions plus an older-runtime fallback. The
existing composer, Claude integration, binding-isolation and provider recovery
suites were also run. These are fixtures and local protocol checks; they do
not constitute authenticated live sessions against every provider.

Fresh Web/OpenTUI type checks and React Doctor pass with no findings. The
production build passed after preserving and replacing its generated Webpack
caches; an earlier attempt failed inside Webpack's hash implementation. The
build checks include all 55 static pages. Rendering fixtures still emit the
existing React `act()` warnings while passing their interaction assertions.
