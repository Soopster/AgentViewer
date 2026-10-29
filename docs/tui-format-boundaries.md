# Terminal transcript formatting boundaries

`tui/format.ts` is the public entry point used by OpenTUI, Ink, and transcript
workers. It composes compact and expanded tool output into transcript cards,
including code extraction, density, search fields, images, and timing. Existing
exports remain available from this entry point.

The modules under `tui/format/` own independent formatting responsibilities:

| Module | Responsibility |
| --- | --- |
| `types.ts` | Shared card, code block, line, category, and tone contracts |
| `text.ts` | Sanitization, bounded previews, timestamps, line construction, and fence syntax |
| `tools.ts` | Provider tool aliases, input normalization, MCP identity, and result text adapters |
| `tasks.ts` | Task history context, active forms, task grouping, and task tool output, including OpenCode tasks |
| `coordinator.ts` | MCP, bare, and shell Coordinator calls, result summaries, standing briefs, and mail |
| `protocol.ts` | A2A and legacy protocol fences rendered as readable event lines |
| `diffs.ts` | Unified diff normalization, file-change previews, and synthesized edit/write diffs |
| `code.ts` | Markdown content and code extraction from text, read tools, and MCP results |
| `mermaid.ts` | Lazy renderer loading, Mermaid detection, ASCII rendering, and source fallback |
| `questions.ts` | Pending and answered questions, options, custom answers, and annotations |
| `todos.ts` | Todo normalization, counts, active-task subtitles, and expanded checklists |

Dependencies flow from the entry point to the feature modules, then to text,
tool adapters, and types. Feature modules must not import the entry point or
either terminal renderer. Task history scanning stays with task formatting;
callers continue supplying the existing active-form and registry context.
Provider compatibility belongs in the tool adapters so compact and expanded
output interpret the same calls. Keep the bounded tool-name cache, preview
allocation shortcuts, and identity-preserving normalization behavior.

Code extraction receives an `ExpandedBlockFormatter` callback from the entry
point. It does not import card assembly or own task context. The caller captures
that context in the callback so expanded tool lines and code lifting use the
same formatting policy. Normalized read tools reach the callback without
mutating the original thread.

Mermaid loading remains lazy in `mermaid.ts`, re-exported by the entry point.
Importing these modules must
not eagerly load `beautiful-mermaid`, a renderer, or provider SDK clients into
the transcript worker. Text previews and result adapters intentionally have
different whitespace rules; preserve those rules when extending them.

## Verification

```sh
npx tsc --noEmit
npm run tui:check
node --import tsx scripts/tuiFormatBoundariesSmoke.ts
bun scripts/tuiFormatBoundariesSmoke.ts
node --import tsx scripts/tuiFormatContentSmoke.ts
bun scripts/tuiFormatContentSmoke.ts
node --import tsx tui/opentui/formatCompactionSmoke.ts
node --import tsx scripts/coordinatorTranscriptSmoke.ts
node --import tsx scripts/claudeSdkSurfaceSmoke.ts
node --import tsx scripts/todoCardSmoke.ts
```

The boundary smoke compares complete serialized public output with a baseline
captured before extraction, across all densities and expanded output. Fixtures
cover task history, blockers, pending and failed results, OpenCode tasks,
Coordinator transports, and provider tool aliases. The Coordinator smoke also
checks delivery/mail parsing with the real wire formatter. These are local
formatting checks and do not invoke live providers.

The content smoke captures a second public-output baseline for fenced text,
read line numbers, MCP code lifting, malformed fences, Mermaid source fallback,
file changes, synthesized edits, questions, and todos. It also checks the code
extractor with a custom presenter and concurrent lazy Mermaid loading.
