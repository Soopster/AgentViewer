# TUI editor: Pierre Highlights handoff

## Starting point and user decision

The user requested Pierre Highlights across web and TUI code highlighting, then chose **display surfaces first**, with the editable OpenTUI project editor deferred to a separate pass.

Commit `ccbc6c0c` (`Use Pierre Highlights across web and OpenTUI code displays`) is pushed to `Soopster/AgentViewer` on `main`. It adds `@pierre/highlights` **0.3.0** as a direct dependency and migrates code displays and diffs. The TUI editor deliberately remains on incremental Tree-sitter. Do not interpret the display migration as evidence that editor latency or editing correctness has been validated with Highlights.

The remaining objective is to use Highlights for editor syntax coloring while preserving the existing editing behavior and responsiveness. This is a backend migration, not an editor redesign or a replacement of LSP, completion, search, undo, or file persistence.

## Read these implementation boundaries first

- `plugins/editor/tui/editorSyntaxBuffer.ts`: current incremental parser facade, edit-range computation, and carried line-start table. It exports `openEditorSyntaxBuffer`, `EditorSyntaxBuffer`, `EditorSyntaxLine`, `editorSyntaxEdit`, `editorLineStarts`, and `advanceLineStarts`.
- `plugins/editor/tui/EditorPopover.tsx`: search for `openEditorSyntaxBuffer`, `syntaxBufferRef`, `applyOccurrenceHighlights`, and `applyEditorOverlays`; read those windows rather than the whole file. The main syntax lifecycle currently starts around line 2944.
- `plugins/editor/tui/editorCells.ts` and `editorSyntaxContext.ts`: terminal-cell conversions and lexical context used by editing features. Keep these boundaries intact.
- `lib/codeHighlight.ts`: lazy stateless Highlights adapter, aliases, semantic scopes, and exact CRLF handling for displays. Its `highlightCode` function is not an incremental editor backend.
- `tui/opentui/displayHighlightClient.ts` and `markdownBlocksWorkerClient.ts`: display-only worker integration and Tree-sitter fallback. Do not route per-keystroke editor updates through this stateless display queue.
- `node_modules/@pierre/highlights/dist/live.d.ts`: the installed `LiveTokenizer` contract. Use the installed API as the source of truth; the public project documentation is at <https://diffs.com/docs#highlights>.

Read applicable repository instructions and the React performance/React Doctor skills before editing React code. The existing OpenTUI architecture requires heavy computation to remain in workers.

## Current editor contracts to preserve

`openEditorSyntaxBuffer` takes `{ content, filetype, onHighlights }` and returns `{ update(before, after), content, dispose() }`. Its callback receives `(lines, full)`; each line currently has Tree-sitter's `HighlightResponse` shape, including semantic `group` names and `droppedHighlights`.

- Initial delivery uses `full: true`; later deliveries replace only affected lines. Send an empty range list for a changed line that loses all syntax decorations, so old colors disappear.
- The facade tracks its own authoritative content. Derive edits against that content, not a caller's potentially stale `before` string. Reuse the existing edit and line-table helpers.
- UI application checks `editor.plainText === buffer.content` before painting. Keep that check, but also reject obsolete worker revisions before invoking the callback: text equality alone cannot distinguish rapid A → B → A updates.
- Parser columns are UTF-16 string positions; OpenTUI textarea highlights use terminal cells. Preserve `cellColumnAt`, the ASCII fast path, tab/wide-character handling, and syntax highlight reference `SYNTAX_HIGHLIGHT_REF`.
- Preserve occurrence, bracket, multi-cursor, search, and diagnostic decorations. Syntax replacement clears line decorations and then reapplies overlays; batch updates so deferred tokenization does not trigger an overlay pass per token.
- Occurrence highlighting examines syntax styles to exclude keywords, strings, comments, numbers, operators, and punctuation. Scope mapping affects behavior, not just colors.
- The current edit debounce is **90 ms**. Files containing a line longer than **10,000 characters** suspend syntax highlighting and show that state in the status bar. Preserve these safeguards in the first migration; tune only with comparative evidence.
- Initial painting currently prioritizes visible rows and backfills the rest in **2,000-line chunks**. Do not replace this with a synchronous whole-file decoration pass.
- Closing a file/window, switching tabs, changing syntax style, and replacing content must dispose or supersede outstanding work safely.

## Recommended implementation

1. **Keep the syntax-buffer facade.** Hide backend selection behind it and retain Tree-sitter for languages Highlights cannot lex or when its worker/Wasm initialization fails. Do not delete Tree-sitter assets: Markdown structure and fallback paths still use them. Keep the existing editor language detector in this pass rather than expanding language-selection behavior at the same time.

2. **Add a dedicated incremental worker/client pair**, for example `plugins/editor/tui/editorHighlightWorker.ts` and `editorHighlightWorkerClient.ts`. Maintain one `LiveTokenizer` per open syntax buffer in a worker registry. Identify requests and responses with buffer ID, lifetime/generation, and source revision. Transfer only serializable source edits, viewport ranges, and scope captures; keep `SyntaxStyle` and native objects on the render thread.

3. **Use edits, not repeated tokenization.** Construct a tokenizer once. Convert the existing edit helper's old start/end positions to Highlights `TextEdit.range`, and use `after.slice(edit.startIndex, edit.newEndIndex)` as `newText`. Apply updates in order. If coalescing a burst, derive the replacement against the worker's acknowledged source or preserve the full ordered edit sequence. Reserve `reset()` for actual replacement/recovery, not each keystroke.

4. **Use the incremental and deferred APIs deliberately.** `LiveTokenizer.applyEdits(edits, { renderRange })` can bound synchronous work and deliver the rest through `onDeferTokenize`. Without `renderRange`, tokenization completes synchronously and the returned `lines` map is empty. Add viewport input/update support to the facade if needed. Use the actual visible range with measured overscan; the existing 2,000-line painting batch is not a sensible synchronous viewport target. Pausing/resuming background work for hidden windows must retain the current revision.

5. **Preserve semantic styles.** Produce line-relative `{ startCol, endCol, group }` captures compatible with the existing callback, including empty changed lines and an empty `droppedHighlights` array where appropriate. Reuse the display adapter's scope naming policy or extract a shared helper. Verify dotted scope inheritance with the editor's actual `SyntaxStyle` resolver rather than assuming every Highlights scope has an exact registered style.

6. **Handle tokenizer ownership correctly.** `onDeferTokenize` can fire during construction, before the tokenizer variable is assigned. Register state and defer dependent reads safely. If using `getLineRecords()`/`tokenNames`, copy borrowed records before another edit, reset, deferred slice, or disposal invalidates them. `getLineTokens()` uses line-relative UTF-16 offsets; stateless/streaming token offsets have different origins. Keep CRLF, lone CR, trailing lines, and exact saved content intact.

7. **Adapt initial/backfill delivery.** Emit `full: true` once for a fresh buffer, then incremental batches for deferred lines of that same revision. Repeated full clears would erase already painted rows and overlays. Reject old-generation deliveries after file switches, undo/replacement, worker failure, or disposal. Reinitialize fallback parsing from the latest source if Highlights becomes unavailable.

8. **Wire packaged workers.** Resolve the worker through `tui/opentui/workerUrl.ts`, add its relative entrypoint to `scripts/prepareDesktopResources.mjs`, and run `scripts/tuiWorkerEntrypointsSmoke.ts`. Keep the shared web/display renderer APIs unchanged unless a small shared scope helper is needed.

## Validation and acceptance

Capture a fresh Tree-sitter baseline **before** implementation using the same runtime, fixture sizes, and machine as the candidate. Historical numbers in source comments describe older measurements and are not current acceptance results.

Start with these focused checks:

```sh
npx tsc --noEmit
npm run tui:check
bun tui/opentui/editorSyntaxEditSmoke.ts
bun tui/opentui/editorSyntaxHighlightSmoke.tsx
bun tui/opentui/editorTypingHotPathSmoke.ts
bun tui/opentui/editorSyntaxContextSmoke.ts
bun tui/opentui/editorCellsSmoke.ts
bun tui/opentui/editorWideTextSmoke.tsx
bun tui/opentui/editorLineEndingSmoke.tsx
bun tui/opentui/editorByteOrderMarkSmoke.tsx
bun tui/opentui/editorMultiCursorSmoke.ts
bun tui/opentui/editorUndoRunSmoke.tsx
bun tui/opentui/editorLargeFileSmoke.tsx
bun scripts/tuiWorkerEntrypointsSmoke.ts
git diff --check
```

Add worker-level tests that compare an edited document's settled captures against a fresh tokenizer of the final source. Cover insertion/deletion/joined lines, multiline comments/templates, edits above the viewport, rapid edits/undo, A → B → A, empty files, Unicode/emoji/combining/CJK characters, tabs, CRLF, trailing newlines, file switches, theme changes, failure fallback, and disposed-buffer responses. Test syntax removal and overlay restoration as well as added colors.

Use the existing performance harnesses:

```sh
bun tui/opentui/editorSyntaxPerf.ts
EDITOR_TYPING_SIZES=200,2000,6000,20000 bun tui/opentui/editorTypingPerf.tsx
EDITOR_TYPING_SIZES=200,2000,6000 EDITOR_TYPING_EXT=txt bun tui/opentui/editorTypingPerf.tsx
EDITOR_TYPING_SIZES=8 EDITOR_TYPING_LONG_LINES=1 bun tui/opentui/editorTypingPerf.tsx
```

`editorSyntaxPerf.ts` measures edit bookkeeping/context classification, not the entire worker or UI pipeline. `editorTypingPerf.tsx` drives the real editor in isolated processes and reports commit/frame behavior and settling time. Compare syntax-enabled and plain-text results, test both middle and end edits, and report cold open, warm typing, scrolling into deferred rows, retained memory, and cleanup separately. Do not claim an editor improvement from the display migration's HTML-rendering benchmark.

Acceptance: supported files use incremental Highlights; ordinary local edits do not cause whole-file parsing or decoration application; final colors correspond to current text; off-screen rows converge; overlays, selection, undo, and file bytes remain correct; fallback stays usable; typing and large-file behavior do not materially regress against the fresh baseline. If those conditions fail, keep the editor on Tree-sitter and report the evidence rather than forcing the migration.

Run the repository's React Doctor regression check after React changes. Exercise editing/scrolling/resizing in a real terminal, including Windows when available; distinguish automated fixture evidence from native-terminal or LSP/provider end-to-end proof.

## Evidence already available

For the shipped **display** migration, web/OpenTUI type checks, a full production build under Node 26.13.0, focused display/diff/editor regression smokes, and headless Chrome fixtures passed. Chrome covered themes, exact source text, line numbers, rapid replacement, remounts, and worker-backed diffs; a CSP blocking Wasm also exercised Prism/Shiki JS fallback. Standalone native PTY loading was checked after the build fix. The editor regression smokes passed with **Tree-sitter still active**.

The in-app browser bridge was unavailable, so the browser evidence came from isolated temporary headless fixtures. Those temporary fixtures and logs are not committed test infrastructure. No Highlights editor implementation or comparative editor performance evidence exists yet.

Before implementing, check current `git status` and preserve unrelated changes. This handoff is a separate documentation artifact created after the display release; do not assume it is part of `ccbc6c0c`.
