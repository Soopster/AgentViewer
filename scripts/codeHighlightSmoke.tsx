import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { highlightCode } from '../lib/codeHighlight'
import { CODE_THEMES } from '../lib/codeThemes'
import { codeStyleToHighlightsTheme, getCodeThemeStyle } from '../lib/codeThemeStyles'
import { renderCodeHighlight } from '../components/renderCodeHighlight'
import { preferredDiffHighlighter } from '../lib/diffHighlighter'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (process.argv.includes('--without-wasm')) {
  Object.defineProperty(WebAssembly, 'Module', { value: class { constructor() { throw new Error('Wasm blocked') } } })
  assert.equal(preferredDiffHighlighter(), 'shiki-js')
  const fallback = await renderCodeHighlight({ children: 'const x = "safe"', language: 'ts', style: getCodeThemeStyle('atom-dark') })
  assert(renderToStaticMarkup(fallback!).includes('safe'))
  assert.equal(await highlightCode('const x = 1', 'ts'), null)
  console.log('Wasm unavailable: Prism code and Shiki JS diff fallback passed')
  process.exit(0)
}

const samples = ['', '\tconst café = "😀";\n', '/* open\ncomment */\nconst x = `first\nlast`;\n', '<Panel value={true} />', 'const a = "😀"\r\n// café\r\n', '\t\r\n', 'x\ry']
for (const source of samples) {
  const result = await highlightCode(source, 'tsx')
  assert(result)
  assert.equal(result.lines.map(line => line.map(token => token.content).join('')).join('\n'), source)
  for (const line of result.lines) for (const token of line) assert.equal(source.slice(token.offset, token.offset + token.content.length), token.content)
}
const multiline = await highlightCode('const a = `first\nconst b = 1\nlast`\nreturn 2', 'ts')
assert(multiline)
assert(multiline.lines[1]?.every(token => token.scope === 'string'))
assert(multiline.lines[3]?.some(token => token.scope?.startsWith('keyword')))
assert.equal(await highlightCode('hello', 'made-up-language'), null)
for (const alias of ['typescriptreact', 'javascriptreact', 'shell', 'zsh', 'docker', 'ps1']) assert(await highlightCode('hello', alias))
for (const theme of CODE_THEMES) {
  const style = getCodeThemeStyle(theme.id)
  const result = await highlightCode('const name = "hello" // comment', 'ts', codeStyleToHighlightsTheme(style))
  assert(result, theme.id)
  assert(result.lines[0]?.some(token => token.color?.startsWith('#')), theme.id)
  const html = renderToStaticMarkup((await renderCodeHighlight({ children: '<script>alert("x")</script>\nconst n = 1', language: 'tsx', style, showLineNumbers: true, startingLineNumber: 42 }))!)
  assert(!html.includes('<script>'), 'source is escaped by React')
  assert(html.includes('42') && html.includes('43'), 'line numbers retain their starting offset')
}
const fallback = await renderCodeHighlight({ children: 'plain <unknown>', language: 'unknown-language', style: getCodeThemeStyle('atom-dark') })
assert(renderToStaticMarkup(fallback!).includes('&lt;unknown&gt;'), 'unsupported language remains readable and escaped')
const blocked = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--without-wasm'], { encoding: 'utf8', timeout: 30_000 })
assert.equal(blocked.status, 0, blocked.stdout + blocked.stderr)
const { getHighlighterOptions, getSharedHighlighter, getHighlighterType, parseDiffFromFile, renderDiffWithHighlighter } = await import('@pierre/diffs')
const options = { theme: { dark: 'pierre-dark', light: 'pierre-light' }, preferredHighlighter: preferredDiffHighlighter(),
  useTokenTransformer: true, tokenizeMaxLineLength: 1_000, lineDiffType: 'word' as const, maxLineDiffLength: 10_000 }
const highlighter = await getSharedHighlighter(getHighlighterOptions('typescript', options))
assert.equal(getHighlighterType(), 'highlights')
const file = parseDiffFromFile({ name: 'test.ts', contents: 'const old = 1;\n' }, { name: 'test.ts', contents: 'const next = 2;\n' })
const diff = renderDiffWithHighlighter(file, highlighter, options)
assert(diff.code.additionLines.some(Boolean) && diff.code.deletionLines.some(Boolean))
console.log('Highlights smoke passed: exact source/offsets, Unicode, multiline state, aliases, persisted palettes, web rendering and fallback')
