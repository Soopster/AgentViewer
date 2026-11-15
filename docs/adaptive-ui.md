# Adaptive UI: cards designed as data

Tool calls that nothing draws specially (most MCP tools) read as a generic card. The Adaptive UI plugin
(`plugins/adaptive-ui`) lets a card be **designed as data**, reviewed, saved as a file and reused, in both
renderers, without shipping renderer code.

## The loop
1. The transcript read path reports a call no dedicated card draws, once per shape per process: the
   `block.unrendered` runtime event (tool, MCP server, input **key names**, result size; never values).
2. The plugin's `toolCard` hook sees each finished call, tallies its shape and keeps up to three **redacted**
   samples (secret-looking keys removed, strings truncated).
3. **Design card** in the gallery (Web: *Adaptive UI*, TUI: palette, `g`) puts a design request in the composer. An
   agent writes `<recipes dir>/<id>.json` with its ordinary file tools, as a `draft`.
4. The gallery previews the draft against its samples. **Enable** (`a`) makes it `active`; only active rules draw.
5. A rule on disk is watched: editing it clears cached cards (a transcript already on screen updates when it
   next reloads its window).

Recipes live in `$AGENT_VIEWER_UI_RECIPES_DIR`, else `$XDG_CONFIG_HOME/agent-viewer/ui-recipes`, else
`~/.config/agent-viewer/ui-recipes`: one `<id>.json` per rule.

## A rule
```json
{ "id": "linear.get_issue", "status": "active",
  "match": { "tool": "mcp__linear__get_issue" },
  "title": "{{input.id}} · {{result.json.title}}",
  "tone": [{ "when": { "path": "result.json.state", "equals": "Done" }, "tone": "success" }],
  "blocks": [{ "type": "badge", "text": "{{result.json.state}}" },
             { "type": "kv", "rows": [["Assignee", "{{result.json.assignee.name | default none}}"]] }] }
```
Blocks: `heading`, `text`, `badge`, `code`, `progress`, `kv`, `table` (`rowsFrom` + `columns`). Bindings start with
`input.`, `result.` (`text`, `isError`, `json`) or `tool.name`; formatters: `basename dirname truncate join upper
lower count default`. There is no code and no expression language.

## Guarantees (each pinned by `npm run adaptive-ui:smoke`, by mutation)
- A **draft or disabled rule never draws**; a rule that fails validation is listed with its reasons, never drawn.
- A rule **does not replace a built-in card** unless it sets `overridesNative`.
- **A failed call is an error** whatever the rule says, and the host's own "tool call failed" row always shows.
- Output is scrubbed of escape sequences, control and bidi characters and capped (60 blocks, 20,000 characters of code).
- Bindings cannot reach prototypes; the narrower of two matching rules wins.
- Events never carry values; samples are redacted, process-local, and served only by the `write`-scoped
  `/api/adaptive-ui` route.

## Designing a card
- **With an agent:** *Design card* (`g` in the TUI) puts the request in the composer. The agent writes the file,
  runs `agent-viewer cards check <file>` (exit 1 and the reasons if it is not usable) and `agent-viewer cards preview <id>`,
  and leaves it a draft. `agent-viewer cards list|enable|disable` flip rules from a shell. The `adaptive-ui` skill
  (`.agents/skills/adaptive-ui`) teaches the format.
- **In place:** *Design here* (`h`) asks a model with no tools, no persistence and no setting sources (the one-shot
  `lib/plugins/modelService.ts`), validates the reply as a rule, feeds refusals back for up to three tries and writes a
  draft for that tool only. It cannot activate a rule, retarget it or ask to replace a built-in card, and is limited to
  20 designs a day.

## Suggestions
The gallery lists what the app could change about itself, from how it is used: a card for a tool called often or opened
often, a view that groups tool calls when they are rarely opened, a view that opens cards by default when most are.
A view suggestion adds a new custom view (never selected for you). Counts come from `tool.completed` events and the
`ui.interaction` event, which the Web reports in batches (30s) when a generic, MCP or plugin card is opened or folded.
`ui.interaction` is not reported from the TUI yet.

## Rules shipped by a mod
A mod may keep card rules in a `ui-recipes/` folder beside its `plugin.json`. They apply while the mod is enabled,
reload with it, show in the gallery marked "from mod …" and are read-only there (the mod owns the files). A rule of
your own with the same id wins. Every mod needs a server module, so a rules-only mod ships an empty `server.mjs`.

## Reload
Mods reload when their files change (`lib/plugins/modWatch.ts`: source-like files only, at most one reload every
3s, `AGENT_VIEWER_MODS_WATCH=0` turns it off), on **Reload mods** in the palette, or with `agent-viewer mods reload`.
A rule file edited on disk clears cached cards. Bundled plugins' own code reloads through Next's dev reload (Web) or
`npm run tui:dev`.

## For mods and plugins
- `toolCard` hooks may return `blocks` (the same vocabulary) beside `lines`, and receive the call's `result`
  (text, `isError`, `truncated`) once it has one.
- `runtimeEvent` hooks receive `block.unrendered` and `ui.interaction`.

## Not done
`transcriptCard` for non-tool blocks, `ui.interaction` from the TUI, and a general mechanism for plugins to contribute agent tools (the
`agent-viewer cards` CLI and the skill cover what an agent needs here).

Project-scoped recipes (`<repo>/.agent-viewer/ui-recipes`) are deliberately not loaded: a cloned repository would decide how
your tool calls look. If they are added they should arrive as drafts to adopt, like a design from an agent.
