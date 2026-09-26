# TUI performance pass — 26 September 2026

This pass improves sidebar search, composer file suggestions, and editor file
workflows. It does not establish a whole-application 120 FPS guarantee.

## Changes

- Sidebar search builds lowercase titles, projects, and IDs once per session
  list, on the first nonempty query. Subsequent keystrokes reuse that index.
  Replacing the session list refreshes it, and empty searches return the original
  list without building an index.
- Composer mention ranking reads each candidate's frecency score once, rather
  than joining paths and reading scores inside every sort comparison. A bare
  `@` with no history returns the original ordering directly. Match tiers,
  candidate limits, ties, and rank-before-limit behavior are preserved.
- Editor tree construction indexes each directory's children instead of scanning
  siblings for every file. Natural sorting reuses one `Intl.Collator`, including
  create/rename refreshes. Construction indexes are discarded after building.
- The editor skips quick-open ranking while the picker is closed. Previously,
  changes to the active buffer could rebuild the hidden project-file results.

## Reproduce

```sh
bun tui/opentui/workflowSearchPerf.ts
bun tui/opentui/frecencySmoke.ts
bun tui/opentui/editorPopoverSmoke.tsx
bun tui/opentui/editorRecentFilesSmoke.tsx
bun tui/opentui/tabReaderPositionSmoke.tsx
EDITOR_TYPING_SIZES=200,6000 EDITOR_TYPING_KEYSTROKES=20 npm run tui:editortypingperf
INPUT_SECONDS=1 npm run tui:inputperf
npx tsc --noEmit
npm run tui:check
```

The workflow benchmark compares the previous tree/search/bare-mention algorithms
with the production helpers, asserts identical output, then reports warmed
medians across 25 iterations. Fixtures contain 5,000 files or sessions, numeric
and Unicode filenames, duplicate paths, missing metadata, custom titles, and
renamed sessions. These are helper timings, not rendered interaction latency.

## Measured helper improvements

Final warmed medians on Bun 1.4.2, milliseconds:

| Workflow (5,000 entries) | Before | After | Speedup |
| --- | ---: | ---: | ---: |
| Editor tree, wide directory | 103.697 | 8.498 | 12.2× |
| Editor tree, nested directories | 23.003 | 4.667 | 4.9× |
| Composer bare `@`, with frecency | 6.905 | 0.656 | 10.5× |
| Sidebar, eight successive queries | 10.100 | 0.497 | 20.3× |

All comparisons asserted identical output. Sidebar timings measure reuse of the
index; the first nonempty query still pays its construction cost. The hidden
quick-open change removes work while editing, but no isolated speedup is claimed
for that change.

## Validation

Web and OpenTUI type checks passed. Frecency, editor interactions, recent-file
ordering, and tab reader-position smokes passed. The editor interaction smoke
covers editing, quick open, file creation, navigation, saving, and LSP actions.
Tab restoration covers anchors, offsets, rapid switching, and tail following.

The rendered editor typing check recorded 42 commits at each size, with no
commits above 8.33 ms. Worst commits were 1.2 ms at 200 lines and 1.5 ms at 6,000
lines. This measures React/native commit cost, not physical display FPS.

`npx react-doctor@latest --verbose --diff` could not download because npm DNS
resolution failed. The installed Doctor ran via `npx --no-install react-doctor
--verbose --diff`; its score was unavailable because maintainability checks
failed. It reported nine findings in pre-existing code (complexity, ref
initialization/render mutation, and state-updater side effects). No clean Doctor
score is claimed.

The initial input-matrix run overlapped implementation and is diagnostic only,
not a clean before/after comparison. A separate final-state run covers all
navigation, search, composer, editor, tab, and split-pane scenarios.

The final input run passed **all 24 scenarios**, with **zero commits over 8.33 ms**
and no skipped scenarios (10,000-message/120-session fixture, one second of
input per scenario). The worst measured commit was 6.6 ms. This is a short
hermetic run, not proof of sustained 120 FPS with live providers or every project.

```text
  scenario              commits  over-8.33ms  worst frame   cards
  sidebar-scroll             66            0        6.4ms   10000
  sidebar-scroll-alt         67            0        6.1ms   10000
  reader-scroll              14            0        6.2ms   10000
  reader-scroll-alt          49            0        4.8ms   10000
  reader-page                50            0        4.5ms   10000
  reader-jump-ends           53            0        5.3ms   10000
  reader-expand              40            0        3.8ms   10000
  focus-toggle               40            0        4.6ms   10000
  view-cycle                 38            0        3.0ms   10000
  transcript-search          63            0        6.6ms   10000
  sidebar-search             39            0        6.1ms   10000
  composer-type              29            0        4.6ms   10000
  composer-window-type       29            0        2.4ms   10000
  composer-slash-filter       27            0        6.0ms   10000
  composer-mention-filter       28            0        6.3ms   10000
  command-palette-nav        38            0        4.9ms   10000
  command-palette-filter       40            0        4.7ms   10000
  editor-nav                 39            0        6.0ms   10000
  tab-switch                 75            0        6.0ms   10000
  split-reader-columns       66            0        6.2ms   10000
  split-pane-columns         42            0        1.9ms   10000
  split-reader-rows          63            0        6.5ms   10000
  split-pane-rows            39            0        5.6ms   10000
  turn-jump                  37            0        3.2ms   10000
Input performance gate passed: all 24 scenarios stayed within 8.33ms.
```
