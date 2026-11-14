# Coordinator MCP context cost — 2026-10-13

The measured costs are serialized response/description characters, not billed
model tokens. Tokenization, tool-prefix caching and whether an MCP host forwards
both text and structured content vary by host/model. No live-provider billing
or end-to-end turn cost was measured.

## Implemented reductions

| Surface | Before | After | Character reduction |
| --- | ---: | ---: | ---: |
| Shared tool descriptions (39 tools) | 17,041 | 14,378 | 15.6% |
| Routine status fixture (30 findings, 32,000 characters each) | 30,412 | 504 | 98.3% |
| Large assignment receipt fixture | 37,186 | 843 | 97.7% |
| Native Codex tool definitions, lead versus teammate | 30,809 (40 tools) | 18,236 (24 tools) | 40.8% |
| Large result review, legacy preview versus overview | 203,128 | 1,613 | 99.2% |

`coord_status(view="actionable")` returns caller/run identity, status, cursor,
phase rollups and the complete actionable digest without board/history. The
fixture proves parity with the full view, including reply obligations and
waiting policy. `view="full"` remains the default for compatibility and initial
board/roster inspection. The skill recommends the actionable view for routine
checks and acting on mutation/wait digests without another status call.

Create/delegate model receipts no longer repeat the authored task prompt or
private dispatch policy. Task IDs/status, paths/dependencies, delegation,
settlement and next actions stay available. `taskDetailTool` points to
`coord_read_task`. Claim receipts retain full task context, and supervisor,
backend and durable ledger records are unchanged. A shared presentation helper
applies this to the native SDK tools and standalone bridge; OpenCode and the
session shell client consume the same SDK bridge projection.

Shortened descriptions retain role restrictions, human gates, provider/model
pins, queued-versus-executed semantics, stable-key retry rules and routes to
specific context. Detailed workflows remain in progressively disclosed skill
references. No tool was removed.

The shell fallback now derives read-only tools from the shared contract rather
than a four-tool hardcoded list. New reads work without irrelevant mutation keys,
avoiding rejection/retry turns. Acknowledging inbox reads still require a key;
non-acknowledging and unresolved reads do not.

Role-aware discovery preserves teammate execution, mail, locks and discovered-work
creation while hiding lead-only review, recovery and delegation tools. Native
SDK bindings use the shared role filter. The standalone MCP server updates its
catalog after verified binding and sends one invalidation per role change.
Unknown roles retain the complete catalog; backend authorization remains
authoritative even if a discovery hint is forged. OpenCode uses session-scoped
prompt tool masks; its native command API has no tool-mask field.

`coord_read_result` now defaults to an overview with the same source/target,
receipt and review pin as the legacy preview. `coord_read_result_diff` reads
whole-branch or selected-file pages, including untracked and binary changes.
Follow `nextOffset` until `hasMore` is false; offsets use JavaScript string
positions. Source or target changes invalidate pages. The large-diff fixture
reconstructs all 265,006 characters across 17 pages, including content beyond
the legacy preview cap. Human approval and integration gates remain enforced.
`include_diff=true` preserves the old bounded preview for existing callers.

## Next opportunities

- Tight query budgets: choose a specific `coord_query_context` and limit 1 when
  one finding suffices. Broad queries currently budget up to 40,000 detail
  characters; exact task/receipt reads avoid reloading unrelated evidence.
- Host-specific duplicate rendering: stdio MCP retains both text content and
  structured content for compatibility and its dashboard. Measure what each
  host actually sends to its model before changing either representation.

## Verification

- `coordStatusBoundSmoke`: full/actionable parity, more than 90% fixture reduction,
  native SDK view mapping, compact authored receipts, complete backend/read-task
  data, unchanged claim projection and bounded/full finding retrieval.
- `mcpBridgeSmoke`: schema/description parity, view argument mapping, stdio
  role changes, exactly one discovery invalidation, diff-page mapping and served
  skill/reference word budget.
- `coordToolDiscoverySmoke`: native provider catalogs, stable warm bindings,
  scoped OpenCode masks, rebinds and backend rejection of forged role hints.
- `coordResultReviewSmoke` and `coordResultDiffSmoke`: overview/preview pin parity,
  complete paginated reconstruction beyond the old cap, untracked-file reads,
  invalid-file/limit rejection and stale source/target rejection.
- `coordSessionClientSmoke`: real authenticated shell reads for new tools,
  actionable status, mutation-key rejection/replay, transport errors and private
  credentials.
- Full TypeScript and OpenTUI checking and diff hygiene pass.
