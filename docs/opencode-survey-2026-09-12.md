# opencode survey — 12 September 2026

Survey of `~/Documents/src/opencode` (v1.18.30) for patterns worth bringing into
agentViewer. The tree has changed substantially since the September 8 pass: there
is now a `packages/core` v2 runtime carrying `system-context/`,
`session/context-epoch.ts`, `tool-output-store.ts`, `question.ts`, `policy.ts`,
`background-job.ts` and a `run-coordinator.ts`, plus a separate `session-ui`
package holding the shared web transcript renderer.

Ranked by value against effort, given that agentViewer wraps five agent runtimes
and therefore does **not** own the model loop for any native provider. That
constraint is what separates the first group from the second: several of the best
ideas here are agent-runtime concerns the provider SDKs already own for us, and
are only actionable where we run the loop ourselves (coordinator workers, the ACP
transport).

## Directly portable

### 1. Frecency-ranked file autocomplete, and a prompt stash

`packages/tui/src/prompt/frecency.tsx`, `packages/tui/src/prompt/stash.tsx`

Two self-contained JSONL-backed stores under the TUI state directory, about sixty
lines each. Both append on write and compact on load, so a crash costs at most the
last line.

Frecency scores a path as `frequency / (1 + ageInDays)` and caps the table at 1000
entries. We already reached the recency half of this for the editor's quick-open
(a file you have never touched must still be findable by name, so recency orders an
empty query and breaks ties but never outranks a match), but the composer's `@`
file autocomplete does not rank at all, and frequency is not represented anywhere.

The stash is the genuinely new one: park a half-written prompt together with its
attachment parts and pop it back later, fifty deep. We have persistent sent history
and a send queue; neither shelves a draft you are not ready to send.

### 2. Markdown rendering off the render thread, with a latest-wins queue

`packages/session-ui/src/components/markdown-worker-queue.ts`,
`packages/session-ui/src/components/markdown-stream.ts`

`createLatestWorkerQueue` is about thirty-five lines. It keeps one slot per key; a
newer request for the same key **supersedes** the pending one in place rather than
queueing behind it, and disposals interleave in submission order.

That is the discipline our serial threading worker lacks. `CLAUDE.md` already
documents the consequence — a prefetch shaped as a `detail` read spends most of a
read's cost holding the queue against the open the user is waiting on — and the fix
we landed (ask for a `warm`, not a `detail`) is a workaround for not being able to
supersede. A queue that drops superseded work makes the general case safe.

`markdown-stream.ts` is the other half. It projects a streaming buffer into
`full | live | code` blocks so only the incomplete tail is re-parsed per delta, and
detects an unterminated fence so a half-written code block renders as code rather
than flickering between paragraph and block. Both our UIs re-render whole markdown
per delta.

### 3. Saved permission grants, scoped to a project

`packages/core/src/permission/saved.ts`, `packages/core/src/policy.ts`

`policy.ts` is 49 lines: `{ action, effect: allow | deny, resource }` statements,
wildcard-matched on both fields, **last match wins**, with an explicit caller-supplied
fallback. `saved.ts` persists `(projectID, action, resource)` rows, so "always allow
`bash(npm run *)` in this repo" survives a restart.

We have `lib/permissions.ts` unifying every provider's prompt into one UI, but each
decision is per-turn and forgotten. The evaluator shape would also bring
`lib/routeScopes.ts`-style legibility to permission-mode overrides, where the
precedence rules are currently implicit.

### 4. A which-key overlay driven by the live keymap

`packages/tui/src/feature-plugins/system/which-key.tsx`

Ours (`⌃B ?`) is a static list that has to be maintained by hand. Theirs renders from
the binding registry, groups by prefix, and previews *pending* chords as they are
typed, so a half-entered `⌃B` shows only what can legally follow it. Now that we have
chords, this is the version that cannot drift out of date.

### 5. Focus-aware attention, with sound packs

`packages/tui/src/attention.ts`

Notification gating on a tracked `focused | blurred | unknown` terminal focus state,
with distinct sounds per event class (`question`, `permission`, `error`, `done`,
`subagent_done`) and pluggable packs. Our attention inbox decides *what* needs the
user. This decides *whether to interrupt*, which is the piece we do not have — a
notification fired while the user is watching that pane is pure noise.

## Worth the idea, not the code

### 6. System Context as typed, independently refreshable sources

`packages/core/src/system-context/`, `packages/core/src/session/context-epoch.ts`,
and the vocabulary in `CONTEXT.md`

The strongest design in the repository. Each context source — cwd, date, git branch,
available skills, project references — is
`{ key, codec, load, baseline(current), update(previous, current), removed(previous) }`.
A **Context Epoch** pins one rendered baseline as the immutable provider-cache prefix.
When a source changes, the prompt is *not* re-rendered: the runtime emits a
**mid-conversation system message** stating the newly effective state, admitted only at
a safe provider-turn boundary, after promoted user input and settled tool results.
`unavailable` is a distinct outcome from removed, so a transient failure to observe a
source retains its last admitted value instead of silently dropping it from the prompt.

We cannot apply this to Claude, Codex, OpenCode, Copilot or Pi — each owns its own
prompt. But it is exactly the discipline `CLAUDE.md` already arrived at for the Claude
warm pool ("the system prompt is recorded for the conversation … that is what keeps the
API prompt-cache prefix stable across turns and resumes"), reached there as a constraint
rather than as a model. Where we *do* own the loop — coordinator workers, the ACP
transport — this is the right shape, and it is how a teammate would learn "the board
changed, you now hold lock X" without discarding its cache prefix.

### 7. Bounded tool output with a managed spill file

`packages/core/src/tool-output-store.ts`, and the rules in `packages/core/src/tool/AGENTS.md`

A 2,000-line / 50KB cap on what reaches the model, with `takePrefix` counting bytes per
character so a truncation never splits a multibyte character; the overflow is written to
a shared directory with seven-day retention and the result carries `outputPaths`.

Their `tool/AGENTS.md` is emphatic that the registry is the single bounding boundary and
that leaves must not truncate themselves — a leaf may shape its projection semantically,
but the size limit is enforced in one place. We learned the multibyte half of this in the
editor already (`MAX_FILE_BYTES` counts characters, the unit the buffer uses, because
measuring bytes refused files that would have fit); same class of defect, different surface.

### 8. Serialize-per-key execution with a coalesced wake

`packages/core/src/session/run-coordinator.ts` (104 lines), with
`packages/core/src/session/input.ts`

`run(key)` joins an in-flight execution rather than starting a second. `wake(key)`
registers exactly one coalesced follow-up that runs after the current drain settles.
`interrupt(key)` cancels and waits for cleanup. This is the primitive our poll, steer and
queue paths re-implement ad hoc per provider, and it is the right answer to input arriving
mid-turn: admit it, wake, let the drain pick it up at a boundary.

It pairs with the **Admitted Prompt → Prompt Promotion** split in `input.ts`. A queued
prompt is durable and replayable *before* it becomes conversation history, which is
strictly better than our in-memory FIFO at surviving a crash mid-queue.

## Deliberately skipped

- The Effect-TS layering throughout `packages/core` (`Context.Service`, `Layer`,
  `makeLocationNode`). Coherent, but adopting it is a rewrite, not a borrow.
- The compaction prompt template in `session/compaction.ts`. Well constructed, but every
  provider we wrap compacts for itself.
- `reference.ts` and `skill/guidance.ts`, which render `<available_skills>` and
  `<available_references>` XML blocks into the prompt. The SDKs do this for us.

## Status

Items 1, 2 and 4 are done (12 September). Item 2's supersede queue is applied to the composer's
mention filter only; the threading worker still dispatches directly, because its `format` path's
patch/delivery bookkeeping depends on post order and has to be reworked first.

Items 3, 5, 6, 7 and 8 are untouched.
