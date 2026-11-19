# Agent Viewer plugin UI design

Read this for new or redesigned Web/OpenTUI surfaces. These conventions express
the app's existing workspace metaphors; adapt them to the task and available
space. A small inspector does not need three panes. User screenshots and explicit
requirements take precedence over these defaults.

## Workspace hierarchy

Git is the primary reference: choose a scope, select an item, inspect or act on it.
A substantial plugin commonly uses this hierarchy:

```text
Repository / session context                         scoped controls
Scope or filters | Item list | Detail tabs
                 | Search    | Selected item and status
                 | Items     | Document, editor, or preview
                 |           | Contextual actions
Short navigation and help hints
```

Use two panes when there is no meaningful scope selector; use a single pane for a
small form or accessory. Detail tabs change the view of the selected item, while
scope navigation changes the collection. Keep related workflow steps in the same
workspace. Do not invent tabs for backend capabilities that do not exist.

Inspect the current source before copying a pattern. Useful checkout references:

- `plugins/git/tui/GitBrowser.tsx`: repository navigation, tabs and pane focus.
- `plugins/git/web/`: Web Git components and repository workflow conventions.
- `plugins/skills-manager/tui/index.tsx`: locations, inventory, file breadcrumbs,
  reading, destination selection, copy preview and history.
- `plugins/plan-review/tui/index.tsx`: artifacts, notes, revision comparisons and
  separate approval/implementation actions.
- `plugins/project-memory/tui/index.tsx`: filters, note editing, provenance and
  opt-in recall.
- `plugins/workflow-packs/tui/index.tsx`: pack selection, stages, installation
  preview and full definitions.

These examples illustrate patterns; they are not proof that every renderer and
state has already adopted all of them.

## Shell, context and state

The host owns outer window chrome, placement, focus, stacking, session identity
and runtime lifetimes. Use its window/panel/overlay treatment. A plugin in a
window or panel draws content without adding another outer window frame. Keep
feature navigation, filters, tabs, editors and dialogs inside the plugin. Reach
host presentation primitives through its SDK; add a narrow shared seam when
multiple plugins need the same behavior.

Keep the opening repository/session visible in a short context row. Long absolute
paths must not push controls out of the header. Put full paths and qualified
provider-instance/message details in file browsers or a Source view where they
help inspection. Capture immutable targets before asynchronous work; late replies
must not change a different item's selection.

Separate selected item, focused pane and active tab. Selection remains visible
when focus moves. Keep search with its collection, and show counts and meaningful
status labels. Preserve local drafts, filters, file selection and preview
preferences through relocation with the host's named state hook. That state is
not automatically durable across app restarts; describe persistence accurately.

## Density, scrolling and navigation

Navigation should scan like the Git browser. Location/filter rows usually need
one line; inventory items often need two: a name and a muted source/status line.
Avoid blank padding above and below every row. Use counts and short labels;
provide a way to inspect full labels if compact rows truncate them.

Give the main document the available height. Prefer side-by-side browsing over a
large list stacked above a permanently small reader. Reserve explicit space for
headers, selected-item identity, tabs and actions so they cannot shrink away;
scroll the body. Keyboard selection must scroll into view. Reset reading position
when changing items/files, and preserve it through unrelated renders.

Drill-down views need a visible way back. Use clickable file breadcrumbs to the
resource list and containing folders, preserving the selected file and location.
Switching detail tabs must not silently select another artifact or lose a draft.

Use actual surface dimensions: even a large screen may contain a small docked
panel. Collapse scope navigation into a drawer as needed. At narrower sizes,
switch between list and detail with a clear way back instead of squeezing three
unreadable panes together. Keep primary actions reachable.

## Reading and visual hierarchy

Give titles and Markdown headings a clear visual hierarchy. Offer Raw / Rich
controls when users need both exact source and readable Markdown. Render
frontmatter as metadata, with bounded or collapsible detail if it would dominate
the instructions. Keep code, links, lists and tables within the reading pane;
other resource types retain an appropriate raw/file preview. File content is
read as data, never executed.

Use existing theme tokens and semantic colors in both renderers. Surface shades,
borders and text weight separate regions. Express selection and status through
labels or markers as well as color. Avoid hard-coded colors or plugin-local
copies of the theme palette. Use BMP-safe terminal glyphs.

## Actions and workflow meaning

Keep actions with their context: edit controls with the note/file, destinations
in Copy, Apply with the inspected preview. Collection actions such as New,
Import and Refresh belong with collection navigation or the context header.

Use explicit labels: Save draft, Approve, Implement, Preview installation, Install
missing workflows. Approval and installation must not imply that work or agents
have started. Reflect the domain's prerequisites consistently in mouse and
keyboard actions. Explain a disabled action when its prerequisite is unclear.
Show authoritative pending, success, conflict and failure states; do not label
uninspected items as installed or ready to apply.

Preserve replacement, stale-write, qualified-source and delivery-receipt rules.
A redesign must not collapse preparation and execution into one action. Put
outcomes and supported recovery near the affected operation instead of filling
routine flows with implementation details.

## Input and help

In OpenTUI, reuse workspace keys where they fit: Tab/Shift+Tab moves pane focus,
left/right changes detail tabs, j/k or up/down moves within the focused region,
Enter opens, numbered hints select panes, Ctrl+N toggles navigation, and Escape
returns a level before closing. Keep visible tabs, rows, breadcrumbs and actions
clickable. Ordinary workflows should not require memorizing hidden shortcuts.

Keep the footer short, with navigation and `?` help. Put the full reference in a
bounded, scrollable panel, grouped by task with keys aligned beside descriptions.
Help must not reduce the workspace's layout height or repeat its footer. The
shared OpenTUI SDK exports `ShortcutHelp`; its owner routes help scrolling,
captures input and consumes background actions until help closes. Escape or ?
closes help before affecting the underlying view.

Editors own text input. Do not treat letters, slashes or punctuation as feature
shortcuts while typing. Gate keys and mouse actions by focus and modal state;
unregister on disposal. State whether leaving an editor keeps its draft, and
provide explicit save/leave behavior.

On Web, use semantic buttons, labelled fields, accessible tabs/dialogs, visible
focus and focus restoration. Reuse `components/ui` primitives and the shadcn
workflow for new components. Do not copy terminal pane numbers and letter keys
mechanically into Web. Preserve terminology, hierarchy, selected state and action
meaning while using each renderer's native controls and responsive layout.

## Empty, loading and error states

An empty surface names its purpose and offers the real next actions: New note,
Capture reply, Open Markdown file, Import JSON or Choose a location. A concise
empty state can sit centrally in the detail pane while navigation stays available.
Do not show approval/review state for an artifact that does not exist.

Distinguish loading, no data and no search/filter matches. Keep content readable
during refresh. Show errors near the affected operation. Report discovery limits
and partial results without presenting them as a complete inventory. Preserve
unsaved input on failure and expose retry or reconciliation where supported.

## Validate the rendered result

For UI changes, inspect populated, empty/filtered, long-list/document, editing and
narrow-panel states. Exercise meaningful fixture mutations: approval after save,
selection before apply, installation after preview. Check mouse and keyboard
navigation, selection scrolling, breadcrumbs/back, Raw / Rich controls when
present, and help capturing input without changing the background selection.
Check contrast and ensure titles and actions remain visible.

Run both application typechecks and relevant plugin/render smokes; follow the
React Doctor skill for React changes. Report render-harness, browser,
native-terminal and live-provider evidence separately. Types and mocked provider
checks do not prove all of them. Treat screenshots as concrete constraints and
iterate on observed issues rather than enforcing every pattern mechanically.
