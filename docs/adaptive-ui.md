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

## Changing, explaining and remembering
Ideas taken from a shared design for self-describing UIs (a capability contract the agent reads, patches instead of
rewrites, explanations grounded in the spec, authority levels, an audit trail):

- **One vocabulary, generated.** `lib/adaptiveUi/vocabulary.ts` describes each block (what it is for, when to use it),
  binding and formatter once. The design request, `agent-viewer cards schema` and the docs come from it, and
  `adaptiveVocabularySmoke` fails if the validator and the vocabulary disagree in either direction.
- **Patches, not rewrites.** `agent-viewer cards show <id>` prints a rule with its `revision`; `cards patch <id> <file|->`
  applies `{ "baseRevision": N, "operations": [set-title, set-tone, replace-block, insert-block, remove-block, set-rationale] }`.
  A patch against a stale revision is a conflict (exit 4), not an overwrite. A patched rule always goes back to `draft`,
  and no operation can change what it matches, add a control or replace a built-in card. In the gallery, **Change**
  takes a plain-language instruction (a tool-less model answers with a patch) and **Change with an agent** hands an
  agent the request. `cards refine <id> "<instruction>"` does the former from a shell.
- **Why this card.** A rule may carry a `rationale` (intent, a reason per block, alternatives, assumptions). The gallery and
  `cards explain <id>` show it beside what the host *derives* from the rule: the fields it reads, what each block shows,
  when it applies, its tone rules, and what it can never do. The two are labelled apart: the declared part is a claim.
- **Who did what.** Every write is recorded (`.history.jsonl` beside the rules): actor (`user`, `model`, `agent`, `cli`,
  `mod`), action and revision. `cards history [id]`, and the gallery's per-rule history.
- **It learns what you keep.** Once there are three decisions of yours, design requests carry a hint of the block types you
  keep and the ones you removed. Decisions by a model or an agent never count as yours.
- **Authority.** A card is presentation only: it cannot run anything, call a tool, change state or add a button. The
  vocabulary states this and the smoke checks that no block can act.

## Checked against real data
Found by running it live against a real coordinator session and a real model:
- **Hooks see the JSON of the whole result.** A hook's `result.text` is cut at 8,000 characters, which breaks JSON, so a rule
  reading `result.json.*` of a large result found nothing. The host now parses the whole result (up to 2 MB) and hands
  `result.json`, thinned to a bounded size (long lists keep their first 100 items), beside the text.
- **Samples stay valid JSON.** A sample is thinned structurally, never cut mid-object, so a card previewed against it
  reads what a real call would.
- **Coverage.** The gallery, `cards preview` and the design flow say what a rule reads that its samples do not have
  ("`result.json.checkout.diff` is empty in 1 of 1 samples", "the result is not JSON: use result.text").
- **The model is taught the rule's own fields**, not just blocks: the card tone is `info|success|warning|error` (a block's
  `default` is not one of them, and was what a model wrote), and a formatter argument is literal text.
- **A call is counted once**, however many windows or instance keys present it, and a model question that never got an
  answer (quota, network) is not charged to the day.

## Suggestions
The gallery lists what the app could change about itself, from how it is used: a card for a tool called often or opened
often, a view that groups tool calls when they are rarely opened, a view that opens cards by default when most are.
A view suggestion adds a new custom view (never selected for you). Counts come from `tool.completed` events and the
`ui.interaction` event, which the Web reports in batches (30s) when a generic, MCP or plugin card is opened or folded.
The TUI reports the same when a card is expanded or folded with `e` (cards carry their tools' real names), delivered in process on the first flush or to the daemon when attached.

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
- **`transcriptCard`** presents a block that is not a tool call. Today that is a system message: the hook gets `{ target, block: { kind: 'system', id, subtype, payload } }` (payload bounded to 8,000 characters) and answers like `toolCard`; the card rides on the payload through threading, so both renderers draw it, and the Web keeps a *show original* toggle. A rule with `match: { kind: 'system', tool: '<subtype>' }` does the same declaratively (`input.*` is the message's fields); a failed system message (`level: error`, or an `error` field) is an error card whatever the rule says. A tool rule never draws a system message or the reverse. System messages are not designed from observed shapes (the host cannot tell which are drawn generically), so these rules are written by hand, by an agent, or by a mod.

## Not done
A general mechanism for plugins to contribute agent tools (the `agent-viewer cards` CLI and the skill cover what an agent needs here), and
`transcriptCard` for blocks other than system messages (text, thinking, slash commands).

Project-scoped recipes (`<repo>/.agent-viewer/ui-recipes`) are deliberately not loaded: a cloned repository would decide how
your tool calls look. If they are added they should arrive as drafts to adopt, like a design from an agent.
