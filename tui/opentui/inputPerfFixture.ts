// Deterministic transcripts for inputPerf.tsx.
//
// `realistic` is what a coding session is actually made of — long markdown
// answers with fenced code, Bash output, Edit diffs, Read results, thinking and
// runs of tool calls — because a reader's scroll cost is the cost of laying out
// and painting THOSE rows. `trivial` is the original workload (alternating
// one-line prompts and replies); it stays selectable so old numbers remain
// comparable, but every card in it is two rows tall and it flatters scrolling.
import type { ContentBlock, SessionMessage } from '../../lib/types'

export type InputPerfFixtureKind = 'realistic' | 'trivial'

export function resolveInputPerfFixtureKind(value: string | undefined): InputPerfFixtureKind {
  return value === 'trivial' ? 'trivial' : 'realistic'
}

const FIXED_TIMESTAMP_MS = Date.UTC(2026, 0, 1)

type Draft =
  | { role: 'user'; content: string | ContentBlock[] }
  | { role: 'assistant'; content: ContentBlock[] }

const text = (value: string): ContentBlock => ({ type: 'text', text: value })
const thinking = (value: string): ContentBlock => ({ type: 'thinking', thinking: value })

function codeLines(turn: number, count: number): string {
  const lines: string[] = [`export function reconcileWindow${turn}(cards: Card[], start: number, end: number) {`]
  for (let line = 1; line < count - 1; line += 1) {
    lines.push(
      line % 7 === 0
        ? `  // step ${line}: keep the anchor card stable while the window slides`
        : line % 5 === 0
          ? `  if (cards[start + ${line}]?.key === anchorKey) return { start: start + ${line}, end, reason: 'anchor' }`
          : `  const row${line} = measure(cards[(start + ${line}) % cards.length], { width: ${80 + (line % 40)}, density })`,
    )
  }
  lines.push('}')
  return lines.join('\n')
}

function markdownAnswer(turn: number): string {
  const fenceLines = 30 + ((turn * 13) % 51) // 30-80 lines
  return [
    `## Why the reader window slid (turn ${turn})`,
    '',
    `The slide is driven by \`READER_CARD_WINDOW\` in \`tui/opentui/App.tsx:${790 + (turn % 40)}\`, and the poll that`,
    'triggers it reads `scrollTop` on a timer because the scrollbox emits no scroll events. See',
    `[the OpenTUI scrollbox docs](https://opentui.dev/docs/scrollbox#viewport-culling) and \`lib/threading.ts:${120 + turn % 300}\`.`,
    '',
    '### What changed',
    '',
    `1. **Anchor selection** now prefers the first card both windows share, in \`findReaderCard\`.`,
    '2. The fixup retries until Yoga has visibly laid the new window out — *not* at commit time.',
    `3. \`settleScrollbackPosition\` parks the hidden cursor on a message the viewport still shows.`,
    '',
    '- Wheel floods no longer wedge the poll behind a pending fixup.',
    `- \`npm run tui:inputperf\` covers each view; compare \`./tui/opentui/inputPerf.tsx\` before and after.`,
    '- A long paragraph follows so that word wrapping has real work to do: the quick brown fox jumps over the lazy dog while the transcript reader lays out every mounted card to compute its scroll height, even with viewport culling enabled, which is why the mounted window is bounded.',
    '',
    '```ts',
    codeLines(turn, fenceLines),
    '```',
    '',
    `> Note: measured at 140x44; rerun with \`INPUT_SCENARIO=stream-wheel\` after touching \`/Users/dev/src/app/tui/format.ts:${2600 + turn % 200}\`.`,
  ].join('\n')
}

function bashOutput(turn: number, lines: number): string {
  return Array.from({ length: lines }, (_, line) => (
    line % 9 === 0
      ? `tui/opentui/App.tsx:${1000 + turn + line * 17}:  const transcriptRenderStart = clamp(readerWindowStart, 0, total - READER_CARD_WINDOW)`
      : `lib/module${(turn + line) % 37}.ts:${40 + line * 3}:    return cache.get(key${line}) ?? compute(key${line}, options) // ${'x'.repeat(line % 60)}`
  )).join('\n')
}

function readOutput(turn: number, lines: number): string {
  return Array.from({ length: lines }, (_, line) => (
    `${String(line + 1).padStart(6)}\t${line % 11 === 0 ? `// section ${line / 11} of fixture file ${turn}` : `  const value${line} = transform(input[${line}], { stable: true, turn: ${turn} })`}`
  )).join('\n')
}

function toolPair(id: string, name: string, input: Record<string, unknown>, result: string, lead?: ContentBlock[]): Draft[] {
  return [
    { role: 'assistant', content: [...(lead ?? []), { type: 'tool_use', id, name, input }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result }] },
  ]
}

function realisticTurn(turn: number): Draft[] {
  const id = (suffix: string) => `toolu_fixture_${turn}_${suffix}`
  switch (turn % 6) {
    case 0:
      return [
        { role: 'user', content: `Explain why the reader window slid during turn ${turn}, with the relevant code.` },
        { role: 'assistant', content: [text(markdownAnswer(turn))] },
      ]
    case 1:
      return [
        { role: 'user', content: `Find every caller of transcriptRenderStart (${turn}).` },
        ...toolPair(
          id('bash'),
          'Bash',
          { command: `rg -n "transcriptRenderStart|READER_CARD_WINDOW" tui lib | head -n 160`, description: 'Search for window callers' },
          bashOutput(turn, 110 + (turn % 50)),
          [thinking(`The slide effect and the recenter effect both read the window bounds. I should list every caller before changing either, since a missed one would desync the anchor (${turn}).`)],
        ),
        { role: 'assistant', content: [text(`There are **${12 + turn % 9}** callers. The two that matter are the slide poll and the recenter effect; the rest only read the bounds for the \`readerWindowGaugeRef\` gauges.`)] },
      ]
    case 2:
      return [
        { role: 'user', content: `Apply the anchor fix from turn ${turn - 1}.` },
        ...toolPair(
          id('edit'),
          'Edit',
          {
            file_path: `/Users/dev/src/app/tui/opentui/readerWindow${turn % 9}.ts`,
            old_string: codeLines(turn, 14),
            new_string: `${codeLines(turn, 9)}\n\n${codeLines(turn + 1, 12)}`,
          },
          `The file /Users/dev/src/app/tui/opentui/readerWindow${turn % 9}.ts has been updated successfully.`,
        ),
        { role: 'assistant', content: [text(`Applied. The anchor is now the first card both windows share, so the viewport offset survives the slide.`)] },
      ]
    case 3:
      return [
        { role: 'user', content: `Show me the fixture file for turn ${turn}.` },
        ...toolPair(
          id('read'),
          'Read',
          { file_path: `/Users/dev/src/app/tui/opentui/fixture${turn % 13}.ts` },
          readOutput(turn, 160 + (turn % 80)),
        ),
        { role: 'assistant', content: [text(`That file is ${160 + (turn % 80)} lines. The part you want is the \`transform\` loop near the top — everything below section 3 is generated.`)] },
      ]
    case 4: {
      const calls: Draft[] = [
        ...toolPair(id('g1'), 'Grep', { pattern: 'readerScrollFixupRef', path: 'tui/opentui' }, bashOutput(turn, 18), [thinking(`Seven lookups in a row: this is the tool-group shape (${turn}).`)]),
        ...toolPair(id('g2'), 'Glob', { pattern: 'tui/opentui/*Smoke.tsx' }, Array.from({ length: 24 }, (_, i) => `tui/opentui/case${i}Smoke.tsx`).join('\n')),
        ...toolPair(id('g3'), 'Read', { file_path: '/Users/dev/src/app/tui/opentui/scrollVelocity.ts' }, readOutput(turn, 60)),
        ...toolPair(id('g4'), 'Read', { file_path: '/Users/dev/src/app/tui/opentui/performanceBudget.ts' }, readOutput(turn, 12)),
        ...toolPair(id('g5'), 'Bash', { command: 'git log --oneline -20 -- tui/opentui/App.tsx' }, Array.from({ length: 20 }, (_, i) => `${(turn * 7919 + i * 104729).toString(16).padStart(7, '0').slice(0, 7)} Reader window change ${i}`).join('\n')),
        ...toolPair(id('g6'), 'Read', { file_path: '/Users/dev/src/app/lib/threading.ts', offset: 100, limit: 80 }, readOutput(turn, 80)),
        ...toolPair(id('g7'), 'Bash', { command: 'npm run tui:check' }, '> tsc --noEmit -p tsconfig.opentui.json\n'),
      ]
      return [
        { role: 'user', content: `Audit the scroll fixups before we change them (${turn}).` },
        ...calls,
        { role: 'assistant', content: [text(`### Audit\n\n- \`readerScrollFixupRef\` has three writers.\n- Type-check is clean.\n- Nothing outside \`tui/opentui/\` reads the window bounds.`)] },
      ]
    }
    default:
      return [
        { role: 'user', content: `Is turn ${turn} safe to ship?` },
        { role: 'assistant', content: [text(`Yes — the change is confined to the reader and \`npm run tui:check\` passes.`)] },
      ]
  }
}

export function buildInputPerfMessages(
  kind: InputPerfFixtureKind,
  count: number,
  sessionId: string,
): SessionMessage[] {
  const provider = kind === 'trivial' ? 'codex' as const : 'claude' as const
  const messages: SessionMessage[] = []
  const push = (draft: Draft) => {
    const index = messages.length
    messages.push({
      uuid: `input-perf-message-${index}`,
      session_id: sessionId,
      parent_tool_use_id: null,
      timestamp: new Date(FIXED_TIMESTAMP_MS + index * 1_000).toISOString(),
      provider,
      type: draft.role,
      message: { role: draft.role, content: draft.content },
    })
  }
  if (kind === 'trivial') {
    for (let index = 0; index < count; index += 1) {
      push(index % 2 === 0
        ? { role: 'user', content: `Inspect deterministic workload ${index}.` }
        : { role: 'assistant', content: [text(`Deterministic response ${index} keeps the mounted reader window busy.`)] })
    }
    return messages
  }
  // Whole turns only: a tool_use cut off from its result would render as a
  // call still running, which no settled transcript contains.
  for (let turn = 0; messages.length < count; turn += 1) {
    for (const draft of realisticTurn(turn)) push(draft)
  }
  return messages
}
