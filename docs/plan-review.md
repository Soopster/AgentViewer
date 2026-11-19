# Plan Review

Open **Plan Review** from the palette or the session toolbar. Its view can be
an overlay, a window, or a side panel in Web and OpenTUI.

Explicit completed plans appear automatically, with a small pending-review
badge. Discovery recognizes native plan artifacts and complete
`<proposed_plan>` blocks. Ordinary task lists and headings do not trigger it.
Claude's pending `ExitPlanMode` request also appears when it supplies plan text.
The view also lets you choose a recent assistant message or a Markdown file
inside the current repository. File reviews use the session captured when the
view opened as their destination; the source identity is always shown.

## Reviewing

Select rendered text in Web, or use the line controls. Source view is available
for precise Markdown selection. Comments can span inline formatting. Selections
and highlights map to source offsets, rather than depending on screen pixels.

Add a comment, removal request, general comment, or a quick label: Clarify,
Needs tests, Out of scope, or Looks good. Save comments with Ctrl/Cmd+Enter.
Resolve addressed annotations; reopen them if necessary. Resolved annotations
stay in history and are excluded from feedback.

Drafts save after 500 ms and flush before decisions or switching reviews. Drafts
belong to their original revision. Concurrent writes use version checks; a
conflict retains the local draft and requires the user to inspect the refreshed
review rather than silently replacing another client's work. Use **Replace refreshed draft with mine** (OpenTUI: b) only after inspecting the conflict. Drafts saved against older revisions are visible in Revision history.

When a plan changes, the new revision requires a new approval. Comments are
restored by selected text and nearby context. Missing or ambiguous selections
remain visible as unmatched, with their original quote. Revision history shows
previous plans and a comparison with the preceding revision.

## Decisions and delivery

- **Approve** records a local decision and starts no work.
- **Request changes** sends numbered, quoted feedback to the source session.
- **Implement approved plan** explicitly starts implementation using the exact
  approved revision and its unresolved notes. File sources are checked for
  changes before delivery. Editing annotations invalidates the current approval.

For native Claude plan gates, Implement validates the pending request token and
uses the existing native approval action. Choose Ask before edits or Accept
edits. Native approval cannot forward annotation notes: resolve addressed notes,
or request a revised plan incorporating them, before implementing. Request
changes returns the feedback through the native denial message.

For completed plans, delivery uses the ordinary session send path with the
captured provider-instance identity. An already running source session must
finish before these actions can send. This interface does not impose a new
plan-mode gate on providers; their existing planning and permission modes still
control execution.

Delivery receipts prevent duplicate sends. A known refusal can be retried. An
uncertain send stays blocked until positive transcript evidence is found with
**Check delivery receipt**. Checking a receipt never sends another instruction.
Native outcomes without conclusive transcript evidence require inspecting the
source session. Accepted turns outlive closing or disabling the view.

## OpenTUI workspace

Plan Review uses the Git browser's workspace layout: a collapsible repository
plan list, a document pane with Plan / Notes / History tabs, and contextual
review actions. The Plan tab shows line numbers, selected ranges and markers for
open anchored notes. Notes exposes resolution and deletion; History compares a
revision with its predecessor using addition/removal colors.

The empty state offers session-message and Markdown-file entry points. Narrow
windows reserve the main pane for the document and open navigation as a drawer.
Approve records a decision; the separate Implement action becomes available
after approval (native gates also require resolving outstanding notes).

## OpenTUI keys

| Key | Action |
| --- | --- |
| j/k or up/down | Move the source line, note, revision, or focused plan |
| 1 / 2 | Focus plans / document |
| Tab | Switch pane focus (cycle tabs with the sidebar hidden) |
| Left/right | Switch Plan / Notes / History tabs |
| Ctrl+N | Toggle the sidebar or narrow navigation drawer |
| ? | Show/hide the full shortcut reference |
| v | Start/end a line range |
| c / d / l | Comment / removal / quick label |
| g / e | General comment / reopen draft |
| Ctrl+S | Save an annotation or open the entered file |
| Left/right in quick-label editor | Choose a label |
| f / m | Open a Markdown file / choose a recent message |
| [ / ] | Previous/next review |
| h, then , / . | History and revision comparison |
| n / p | Next/previous annotation |
| z / x | Resolve or reopen / delete annotation |
| a / r / i | Approve / request changes / implement |
| t | Native implementation permission mode |
| u | Check the latest delivery receipt |
| b | Explicitly replace a conflicted draft after inspection |
| Escape | Leave the editor, history, or review |

## Implementation and validation

`lib/plugins/planReview.ts` is the renderer-independent contract. Server storage
and delivery live in `lib/plan-review/`; the bundled plugin owns presentation and
settled-turn discovery. Web uses the HTTP service and OpenTUI uses a native or
remote adapter. Views and widgets load separately so the badge does not load the
Markdown editor at startup.

Repository-scoped SQLite databases live in `~/.agent-viewer/plan-reviews/`, keyed
by canonical repository path. `AGENT_VIEWER_PLAN_REVIEW_DIR` overrides this for
fixtures. Immutable revisions, decisions, annotations, drafts, and delivery
receipts are shared between processes. The existing review store's bundler-safe
Node/Bun SQLite loading pattern is retained.

Run `npm run plan-review:smoke` for domain/storage/delivery and OpenTUI checks;
`npm run plan-review:web:smoke` exercises real browser selection and review UI
against a local service fixture. Provider delivery is mocked in these checks;
they do not prove live-provider execution.

## Plannotator reference

The design was informed by the source of
[Plannotator at 6f8dde3](https://github.com/backnotprop/plannotator/tree/6f8dde3809f869c811ecc76579e2117ffb6074b8):

- `packages/ui/hooks/useAnnotationHighlighter.ts`: source anchoring and verifying
  restored content before painting highlights.
- `packages/editor/restoredAnchors.ts`: retain unmatched comments without
  displaying confidently incorrect locations.
- `packages/ui/utils/parser.ts`: structured, source-local Markdown feedback.
- `packages/editor/planDecision.ts`: separate review decisions from transport.
- `packages/ui/hooks/useAnnotationDraft.ts`: persisted drafts and stale-save
  protection.

This is an independent adaptation using Agent Viewer's renderer/service
contracts, rather than a vendored Plannotator application. Upstream identifies
its license as MIT OR Apache-2.0; its license files remain available at the pinned
source. Image-region review, public sharing, and direct plan editing are deferred.
