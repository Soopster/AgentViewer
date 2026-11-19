# Web message rendering boundaries

`components/MessageItem.tsx` remains the Web transcript entry point. It owns
message composition, view selection, density and session context, and the
public providers consumed by `MessageView`. Its public exports and memoization
contract are unchanged.

Focused modules live under `components/message-item/`:

| Module | Responsibility |
| --- | --- |
| `toolModel.ts` | Web tool aliases, result text, native-card normalization, summaries, metadata badges, and edit statistics |
| `streamModel.ts` | Activity grouping, duplicate-status selection, file-update previews, and bounded diff rows |
| `format.ts` | Message timestamps, durations, token counts, and JSON display text |
| `appearance.ts` | Tool colors, flat/gradient treatment subscription, and header washes |
| `claudeSystemModel.ts` | Pure system-event interpretation: previews, badges, tone, and expanded detail text |
| `ClaudeSystemCard.tsx` | Interactive Claude system-event rendering, expansion, and hover state |

The tool, stream, and system-event models have no React or component dependencies. The stream
model depends on the tool model; neither imports `MessageItem`. Keep Web alias
semantics here rather than importing the terminal formatter: the Web's native
cards and task summaries intentionally interpret some provider names differently.

Appearance and system cards are client modules. Color treatment retains its
existing external-store subscription and server snapshot. The system card owns
its local expansion and hover state, memoizes event interpretation by subtype
and payload, and uses the same artifact-link handling as the other cards.
Pure formatting remains separate from that component. System-event summary,
badge, tone, and body interpretation each have their own helper in the model.

Preserve each file mutation in stream chronology. Deduplication applies to
repeated activity summaries and selects the highest-ranked status, including
failures and approval warnings. Preview limits and line-number calculation stay
in the stream model so rendering does not recreate those policies.

## Verification

```sh
npx tsc --noEmit
npm run tui:check
node --import tsx scripts/webMessageItemBoundariesSmoke.tsx
node --import tsx scripts/codexNewSchemaSupportSmoke.tsx
node --import tsx scripts/claudeMcpArtifactsSmoke.tsx
npx react-doctor@latest --verbose --diff
```

The Web boundary smoke compares rendered HTML with a baseline captured before
extraction across three densities and all five views. It also checks status
deduplication, repeated edits, non-mutating normalization, and bounded file
previews through the standalone models. Direct system-model checks also cover
refusal precedence, first-byte timeout details, and nested hook context. These are local rendering and model
checks; they do not exercise browser interaction or live providers.
