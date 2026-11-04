# Window management review (TUI)

A deliberate review of what a user can do with a window, by kind of window, and
where the experience is thin. Evidence is the smoke that pins each cell; "—" is
a known gap, not an oversight.

**How verified.** The *menu* cells below are checked on the painted menu of a
real window of that kind (`windowControlsSmoke`: session, placed browser,
floating session; `popoverWindowSmoke`: analytics window): the common entries
and the slot entries (split, resize, swap) are present on a docked window and
absent on a floating one. That an entry *works* is pinned by the smoke named in
the last column, which exercises it on a session or surface window; the same
entry on the other kinds runs the same code path (`runRunWindowControlAction`
resolves a window by key, not by kind) but is not separately driven.

## Window kinds

| Kind | What it is |
|---|---|
| Session pane | a transcript window (every window is one `SplitTranscriptPane`) |
| Surface window | terminal, browser, diff, files, pull request, agents, editor, GitHub… |
| Popover window | a popover (analytics, daily summary, prompts, playbooks, handoff…) moved into the layout |
| Popover tab | the same, as a strip tab taking over a window |
| Floating | any of the above lifted over the layout |
| Peeked | a surface window with no room in the layout, shown over it on request |

## What each kind can do

| Capability | Session | Surface | Popover window | Floating | Peeked | Pinned by |
|---|---|---|---|---|---|---|
| `≡` menu with the common entries | ✓ | ✓ | ✓ | ✓ | short menu | `windowControlsSmoke`, `popoverWindowSmoke` |
| Menu shows the `⌃B` key for each entry | ✓ | ✓ | ✓ | ✓ | partly | `windowingAuditSmoke` |
| Zoom / fullscreen | ✓ | ✓ | ✓ | ✓ | back to layout | `windowingSmoke` |
| Split right / below | ✓ | ✓ | ✓ | — (in no slot) | — | `windowTreeSmoke`, menu availability table |
| Resize, swap, equalize | ✓ | ✓ | ✓ | resize by `◢` | — | `windowingMoreSmoke` |
| Tab onto another window / break out | ✓ | ✓ | ✓ | tab by drop | — | `windowTabsSmoke`, `windowingMoreSmoke` |
| Float / dock | ✓ | ✓ | ✓ | dock | — | `windowControlsSmoke` |
| Move to another workspace | ✓ | ✓ | ✓ | ✓ | — | `workspaceWindowMoveSmoke`, `windowUsabilitySmoke` |
| Layout menu (`⊞ layout`) | ✓ | ✓ | ✓ | ✓ | ✓ | `windowControlsSmoke` |
| Close / close others (one undo step) | ✓ | ✓ | ✓ | ✓ | close | `windowingSmoke` |
| Drag to move, with a preview of the drop | ✓ | ✓ | ✓ | ✓ | — | `windowingSmoke`, `windowingMoreSmoke` |
| Undo / redo / reopen closed | ✓ | ✓ | ✓ | ✓ | — | `windowUsabilitySmoke` |

## Whole-workspace features

| Feature | State |
|---|---|
| Layout presets and `⌃B space` to cycle them | ✓ (`windowingSmoke`) |
| Saved layouts: save, rename, update in place, preview, restore, delete (two presses) | ✓ (`windowingMoreSmoke`, `windowingAuditSmoke`) |
| Workspace overview, recent windows, window switcher, identify (`⌃B q`) | ✓ (`windowUsabilitySmoke`, `windowTreeSmoke`) |
| Broadcast a prompt to selected windows | ✓ (`windowBroadcastSmoke`) |
| Attention across windows (`⌃B a`) and per-window activity | ✓ (`windowActivitySmoke`) |
| Lightweight windows, reachable from the window menu | ✓ (`lightweightWindowSmoke`) |
| Responsive layout: a small terminal hides windows without rewriting the saved tree | ✓ (`windowTreeSmoke`) |
| Keyboard help derived from the chord table; no undocumented chord | ✓ (`chordHelpSmoke`, `splitPaneSmoke`) |

## Consistency rules that now hold

- One availability table decides which menu entries a window is offered, from its
  state (docked, floating, zoomed, tabbed), never from what it shows.
- Every window kind has the same title controls.
- Anything that closes more than one window, or deletes something the user named,
  is undoable or asks twice.
- A window that cannot be placed is never silently dead: it is peeked, says so in
  a banner, and its menu opens.

## Scripting

`agent-viewer terminal windows` lists the TUI's windows (number, key, title,
focus) and `agent-viewer terminal window <n|key> <action>` runs a window-menu
action on one (`focus zoom fullscreen float tab detach split-columns split-rows
close close-others equalize undo`); `window layout <arrangement>` applies a layout
(`two main-stack grid grid-six fill fullscreen`). The App registers a bridge
(`windowControlBridge.ts`) so a script runs the same `runWindowControlAction` a
menu click does. Pinned by `terminalControlSmoke` (verbs, errors, routing, the
no-bridge answer) and `windowingSmoke` (a script zooming, closing others and
undoing real windows).

## Known gaps

- A peeked window can float and move to another workspace, but not tab or split:
  it is in no slot to tab onto or split.
- **A floating *surface* window's own title controls (`≡`, `⊞ layout`, `⇥ panel`,
  `×`) cannot be clicked**: the transparent `floating-window` box that carries
  its drag handling sits above them (hit test lands on `floating-window`). Its
  menu is reachable from a session window or the keyboard. Not fixed: moving the
  drag handling onto a title strip did not make the controls reachable, so the
  cause is not understood yet.
- "Close other windows" does not remember what it closed for "reopen closed
  window"; `⌃B u` is the way back.
- Saved layouts restore windows by identity; a session deleted since is skipped
  with a notice rather than replaced.
- The per-kind matrix above is driven on a session, a placed browser, a floating
  session and an Analytics popover window; other surface kinds share the code path
  but are not separately driven.
