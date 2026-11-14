import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { projectMarkdownBlocks } from '../lib/markdownStream'

const render = (source: string) =>
  renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] } as never, source))

const normalize = (html: string) => html.replace(/\s+/g, ' ').trim()

const CORPUS: Array<{ name: string; text: string }> = [
  { name: 'prose only', text: 'One paragraph.\n\nA second paragraph with `code` and **bold**.\n' },
  {
    name: 'headings, list, fenced code',
    text: '# Title\n\nIntro line.\n\n- one\n- two\n  - nested\n\n```ts\nconst a: number = 1\n```\n\nTrailing prose.\n',
  },
  { name: 'table', text: 'Before.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter.\n' },
  { name: 'blockquote and rule', text: '> quoted line\n> continued\n\n---\n\nAfter the rule.\n' },
  { name: 'ordered list', text: 'Steps:\n\n1. first\n2. second\n3. third\n' },
  { name: 'unterminated fence', text: '# Streaming\n\nHere it comes:\n\n```ts\nconst partial = ' },
  { name: 'setext heading', text: 'Title\n=====\n\nBody text.\n' },
  { name: 'html block', text: 'Text.\n\n<div>raw html</div>\n\nMore text.\n' },
  { name: 'nested code in list', text: '- item\n\n  ```sh\n  echo hi\n  ```\n\n- next item\n' },
  { name: 'hard breaks', text: 'line one  \nline two\n\nnext para\n' },
]

// ── the blocks must be the document ────────────────────────────────────────
for (const { name, text } of CORPUS) {
  const blocks = projectMarkdownBlocks(text)
  assert.equal(blocks.map((block) => block.raw).join(''), text,
    `Blocks must reassemble into exactly the input (${name})`)
  assert.ok(blocks.length > 0, `A non-empty document produces at least one block (${name})`)
  assert.equal(blocks[blocks.length - 1]?.complete, false,
    `The tail block is never finished — the next delta may extend it (${name})`)
  for (const block of blocks.slice(0, -1)) {
    assert.equal(block.complete, true, `Every block before the tail is finished (${name})`)
  }
}

assert.deepEqual(projectMarkdownBlocks(''), [], 'An empty document produces no blocks')

// ── rendering a block at a time must render the same document ──────────────
// This is the whole risk of splitting: a construct that means one thing in the
// document and another on its own renders differently and nobody notices,
// because both outputs look like plausible markdown.
for (const { name, text } of CORPUS) {
  const whole = normalize(render(text))
  // Joined with the newline react-markdown itself puts between top-level
  // children, so the comparison is about the markup and not about a separator.
  // Whitespace is only collapsed, never stripped, so a difference *inside* an
  // element — where it would be visible — still fails.
  const perBlock = normalize(projectMarkdownBlocks(text).map((block) => render(block.raw)).join('\n'))
  assert.equal(perBlock, whole, `Per-block rendering must equal whole-document rendering (${name})`)
}

// ── document-scoped constructs bail out ────────────────────────────────────
// A link reference resolves anywhere in the document. Split apart, the
// paragraph loses its definition and renders literal bracket text — a silent
// downgrade from a link, with no error and a plausible-looking result.
const withReference = 'See [the docs][1] for detail.\n\nMore prose.\n\n[1]: https://example.com\n'
assert.equal(projectMarkdownBlocks(withReference).length, 1,
  'A link reference definition forces whole-document rendering')
assert.ok(render(withReference).includes('href="https://example.com"'),
  'Sanity: the reference does resolve when the document is rendered whole')
assert.ok(!render('See [the docs][1] for detail.').includes('href="https://example.com"'),
  'Sanity: and does not resolve when that paragraph is split away — which is why the bail-out exists')

const withFootnote = 'Claim with a note.[^a]\n\nMore prose.\n\n[^a]: The note body.\n'
assert.equal(projectMarkdownBlocks(withFootnote).length, 1,
  'A GFM footnote definition forces whole-document rendering')

// A document that merely mentions `[^` without defining a footnote must still
// split, or one stray bracket in prose disables the optimization for the answer.
const bracketProse = 'Regex `[^a-z]` matches a non-letter.\n\nSecond paragraph.\n\nThird paragraph.\n'
assert.ok(projectMarkdownBlocks(bracketProse).length > 1,
  'A bracket in prose is not a footnote definition and must not disable splitting')

// ── the tail grows without re-cutting the finished blocks ──────────────────
// Memoization only pays if a finished block's raw is byte-identical across
// deltas; if the cut moved, every block would re-render on every token.
{
  const body = '# Title\n\nFirst paragraph.\n\n- a\n- b\n\n'
  let previous: string[] = []
  for (const suffix of ['Tail', 'Tail w', 'Tail wo', 'Tail wor', 'Tail word']) {
    const blocks = projectMarkdownBlocks(body + suffix)
    const finished = blocks.slice(0, -1).map((block) => block.raw)
    if (previous.length > 0) {
      assert.deepEqual(finished, previous,
        'A finished block must be byte-identical across deltas, or nothing memoizes')
    }
    previous = finished
  }
  assert.ok(previous.length >= 3, 'The finished prefix really was split into several blocks')
}

console.log('Markdown stream smoke passed (reassembly, render equivalence, document-scoped bail-out, stable prefix)')
