// Pins the transcript link tokenizer (`lib/tuiLinkTargets.ts`).
//
// This is the whole risk surface of clickable transcript targets, and both
// failure directions are silent. A missed target is invisible — the text simply
// isn't clickable, and nobody knows it should have been. A *false* target is
// worse: ordinary prose gets painted as a link, and clicking it either opens
// nothing or opens the wrong thing. Neither shows up in a frame comparison,
// because an underline is the only visual difference.
//
// So the cases below are mostly about what must NOT become a link. Pure string
// work — no renderer, no filesystem.
import assert from 'node:assert/strict'
import { hasTuiLinkTarget, parseTuiLineTokens, parseTuiLinkTarget } from '../../lib/tuiLinkTargets'

const CWD = '/repo'
// A default parameter fires on an explicit `undefined`, so "no cwd" cannot be
// expressed by passing undefined through a defaulted helper — it would silently
// test the cwd case twice. Separate helpers keep the two distinguishable.
const tokens = (text: string) => parseTuiLineTokens(text, CWD)
const links = (text: string) =>
  tokens(text).flatMap((token) => token.kind === 'link' ? [[token.text, token.url] as const] : [])
const linksWithoutCwd = (text: string) =>
  parseTuiLineTokens(text).flatMap((token) => token.kind === 'link' ? [[token.text, token.url] as const] : [])

// --- reassembly -----------------------------------------------------------
// Every renderer clips these runs the way it would clip the raw string, so the
// runs must concatenate back to the input exactly. A tokenizer that dropped or
// duplicated a character would silently corrupt the line it was decorating.
for (const line of [
  'see https://example.com/a for more',
  'edit lib/permissions.ts:39 and /abs/path/x.ts',
  'no targets here at all',
  '',
  'and/or w/ the thing',
  'trailing https://example.com/a.',
  '[label](https://example.com/q) plus [other](./src/a.ts)',
  '/a /b/c src/d.ts',
]) {
  const reassembled = tokens(line).map((token) => token.text).join('')
  const expected = line.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1')
  assert.equal(reassembled, expected, `tokens do not reassemble: ${JSON.stringify(line)}`)
}

// --- what must become a link ----------------------------------------------
assert.deepEqual(links('see https://example.com/a for more'), [['https://example.com/a', 'https://example.com/a']])
assert.deepEqual(links('at /abs/dir/file.ts now'), [['/abs/dir/file.ts', 'file:///abs/dir/file.ts']])
// An absolute path needs no extension — it is already unambiguous.
assert.deepEqual(links('see /etc/hosts'), [['/etc/hosts', 'file:///etc/hosts']])
// A relative path is resolved against the session cwd, which is what makes a
// transcript reference openable at all.
assert.deepEqual(links('in lib/permissions.ts line 39'), [['lib/permissions.ts', 'file:///repo/lib/permissions.ts']])
assert.deepEqual(links('./scripts/x.sh runs it'), [['./scripts/x.sh', 'file:///repo/scripts/x.sh']])
// `path:line[:col]` is the spelling every stack trace and grep hit uses, so the
// line has to ride along or the link lands at the top of the file.
assert.deepEqual(links('lib/permissions.ts:39 is the spot'), [['lib/permissions.ts:39', 'file:///repo/lib/permissions.ts#L39']])
assert.deepEqual(links('at /a/b.ts:12:5 exactly'), [['/a/b.ts:12:5', 'file:///a/b.ts#L12']])
// A markdown link's target must beat the bare URL inside its own parentheses.
assert.deepEqual(links('[the docs](https://example.com/q) here'), [['the docs', 'https://example.com/q']])

// --- what must NOT become a link ------------------------------------------
// Prose with slashes is the single most common false positive, and the reason a
// bare relative path needs a known extension rather than just a slash.
for (const line of [
  'use and/or as needed',
  'w/ the other approach',
  'a 50/50 split',
  'either/or, his/her',
  'run npm run build/test',
  'TODO/FIXME markers',
]) {
  assert.deepEqual(links(line), [], `prose linkified: ${JSON.stringify(line)}`)
}
// A directory is not a file the editor can open.
assert.deepEqual(links('in /abs/dir/ somewhere'), [])
// A relative path with no cwd to resolve against would be a dead link, and a
// link that does nothing when clicked is worse than plain text.
assert.deepEqual(linksWithoutCwd('in lib/permissions.ts'), [])
// But an absolute path still works with no cwd — nothing needs resolving.
assert.deepEqual(linksWithoutCwd('in /abs/x.ts'), [['/abs/x.ts', 'file:///abs/x.ts']])
// A markdown link to something neither a URL nor a path loses its markers (the
// label is what every other renderer shows) without becoming a link.
assert.deepEqual(links('[mail me](mailto:a@b.c)'), [])

// --- trailing punctuation --------------------------------------------------
// Prose ends sentences and wraps references in brackets, so the punctuation is
// almost never part of the target — but it is still part of the line.
const sentence = tokens('read https://example.com/a.')
assert.deepEqual(links('read https://example.com/a.'), [['https://example.com/a', 'https://example.com/a']])
assert.equal(sentence.map((t) => t.text).join(''), 'read https://example.com/a.')
assert.deepEqual(links('(see https://example.com/a)'), [['https://example.com/a', 'https://example.com/a']])
// A URL carrying its own balanced parens keeps them — trimming on sight would
// break every Wikipedia and MSDN link.
assert.deepEqual(
  links('https://en.wikipedia.org/wiki/Foo_(bar) ok'),
  [['https://en.wikipedia.org/wiki/Foo_(bar)', 'https://en.wikipedia.org/wiki/Foo_(bar)']],
)

// --- the fast-path probe agrees with the tokenizer ------------------------
// `hasTuiLinkTarget` is what lets the renderer skip tokenizing most lines, and a
// probe that says "no" to a line holding a real target silently un-links it. A
// slash-free markdown target is the case that caught this once: the probe
// short-circuited on `includes('/')`, which `[mail me](mailto:a@b.c)` has none
// of, so the line never reached the tokenizer at all.
for (const line of [
  'see https://example.com/a',
  'lib/permissions.ts:39',
  '/etc/hosts',
  '[the docs](https://example.com/q)',
  '[label](a.ts)',
  '[mail me](mailto:a@b.c)',
  'and/or',
  'plain prose',
  '',
  'a 50/50 split',
]) {
  // Markers are stripped only by the markdown branch, so a line the tokenizer
  // rewrote is a line it recognized — the probe had to have let it through.
  const recognized = links(line).length > 0 || tokens(line).map((t) => t.text).join('') !== line
  if (recognized) assert.ok(hasTuiLinkTarget(line), `probe missed a real target: ${JSON.stringify(line)}`)
}
// And the markers really are stripped — the label is what the plain renderer
// shows, so an unrecognized target must not leave raw markdown on screen.
assert.equal(tokens('[mail me](mailto:a@b.c)').map((t) => t.text).join(''), 'mail me')

// --- round trip through the click handler's classifier --------------------
// getLinkAt hands back the url string and nothing else, so this is the only
// thing standing between a clicked cell and the right action.
assert.deepEqual(parseTuiLinkTarget('https://example.com/a'), { kind: 'url', url: 'https://example.com/a' })
assert.deepEqual(parseTuiLinkTarget('file:///repo/lib/a.ts'), { kind: 'file', path: '/repo/lib/a.ts' })
assert.deepEqual(parseTuiLinkTarget('file:///repo/lib/a.ts#L39'), { kind: 'file', path: '/repo/lib/a.ts', line: 39 })
// A path with a space survives the encode/decode round trip, or the editor is
// handed a path that does not exist.
const spaced = parseTuiLineTokens('see /repo/my dir/a.ts', CWD)
void spaced
assert.deepEqual(parseTuiLinkTarget('file:///repo/my%20dir/a.ts'), { kind: 'file', path: '/repo/my dir/a.ts' })
// Anything else is refused rather than guessed at.
assert.equal(parseTuiLinkTarget('mailto:a@b.c'), null)
assert.equal(parseTuiLinkTarget(''), null)
assert.equal(parseTuiLinkTarget('file://relative/x.ts'), null)

console.log('Transcript link target smoke passed (reassembly, prose false positives, path:line, trailing punctuation, probe parity, classifier)')
