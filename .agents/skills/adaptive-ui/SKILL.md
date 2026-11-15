---
name: adaptive-ui
description: Design a transcript card (a card rule) for a tool call that the app draws with a generic card. Use when asked to design, fix or review a card for a tool, or when a design request names a rule file to write.
---

# Designing a card rule

A card rule is one JSON file in the recipes directory (`agent-viewer cards list` prints it). It maps a tool call to a
card made of a title and a few blocks. It is data: there is no code and no expression language.

```json
{ "id": "linear.get_issue", "status": "draft",
  "match": { "tool": "mcp__linear__get_issue" },
  "title": "{{input.id}} · {{result.json.title}}",
  "tone": [{ "when": { "path": "result.json.state", "equals": "Done" }, "tone": "success" }],
  "blocks": [ { "type": "badge", "text": "{{result.json.state}}" },
              { "type": "kv", "rows": [["Assignee", "{{result.json.assignee.name | default none}}"]] } ] }
```

- **Blocks:** `heading`, `text`, `badge`, `code`, `progress {label,value,max}`, `kv {rows}`, `table {rowsFrom,columns:[{header,path}]}`.
- **Bindings** start with `input.`, `result.` (`text`, `isError`, `json` when the result is JSON) or `tool.name`.
  Formatters: `basename dirname truncate join upper lower count default`, e.g. `{{input.path | basename}}`.
- **Limits:** 30 blocks, 600 characters per template. `match.tool` is a name with `*` as the only wildcard.

## Rules of the road
1. Write the file as `"status": "draft"`, named `<id>.json`. Never write `active`: a person enables it after the preview.
2. Run `agent-viewer cards check <file>` after writing, and fix every problem it prints. Then `agent-viewer cards preview <id>`.
3. Show what a person needs at a glance: the title says what was asked and what came back; blocks carry the few fields
   that matter, never the whole payload.
4. While the call runs there is no result, so `result.*` bindings are empty. Titles should still read well without them.
5. Do not try to hide a failure. A failed call is shown as an error whatever the rule says.
6. Samples in the request are redacted. Do not invent fields that are not in them.
