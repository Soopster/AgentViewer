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

## For mods and plugins
- `toolCard` hooks may return `blocks` (the same vocabulary) beside `lines`, and now receive the call's
  `result` (text, `isError`, `truncated`) once it has one.
- `runtimeEvent` hooks receive `block.unrendered`. (`ui.interaction` is declared in the event type and
  capabilities but nothing reports it yet.)

## Not done
`transcriptCard` for non-tool blocks, project-scoped recipes (the hook has no cwd), `ui.interaction` reporting,
agent tools and skills contributed by plugins, a plugin `model` service, draft `ViewSpec` proposals and usage
suggestions. See the plan for the design.
