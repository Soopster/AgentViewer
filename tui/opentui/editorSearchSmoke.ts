import { expandEditorSearchReplacement, findEditorSearchMatches } from './editorSearch'

const literal = findEditorSearchMatches('CAFÉ café', 'café', { matchCase: false, regex: false })
if (literal.matches.length !== 2 || literal.matches[1]!.start !== 5) throw new Error(`Unicode literal offsets drifted: ${JSON.stringify(literal)}`)
const regex = findEditorSearchMatches('alpha-12 beta-34', '(?<name>\\w+)-(\\d+)', { matchCase: true, regex: true })
const replacement = expandEditorSearchReplacement('alpha-12 beta-34', regex.matches[0]!, '$<name>[$2]')
if (replacement !== 'alpha[12]') throw new Error(`Regex capture replacement failed: ${replacement}`)
const scoped = findEditorSearchMatches('one one one', 'one', { matchCase: true, regex: false, range: { start: 4, end: 7 } })
if (scoped.matches.length !== 1 || scoped.matches[0]!.start !== 4) throw new Error(`Selection-scoped search failed: ${JSON.stringify(scoped)}`)
const zeroWidth = findEditorSearchMatches('abc', '(?=.)', { matchCase: true, regex: true })
if (zeroWidth.matches.length !== 3) throw new Error(`Zero-width regex did not advance safely: ${JSON.stringify(zeroWidth)}`)
const unicodeZeroWidth = findEditorSearchMatches('A👩‍💻B', '(?=.)', { matchCase: true, regex: true })
if (unicodeZeroWidth.matches.length !== 5 || unicodeZeroWidth.matches.some((match) => match.start === 2 || match.start === 5)) {
  throw new Error(`Zero-width regex split a Unicode surrogate pair: ${JSON.stringify(unicodeZeroWidth)}`)
}
const invalid = findEditorSearchMatches('abc', '[', { matchCase: true, regex: true })
if (!invalid.error || invalid.matches.length) throw new Error(`Invalid regex was not reported: ${JSON.stringify(invalid)}`)

console.log('Editor Unicode literal/regex/capture/scope/zero-width search smoke passed')

// --- Adversarial cases: boundaries, Unicode, and replacement-token parity ---

const emptyFile = findEditorSearchMatches('', 'a', { matchCase: true, regex: false })
if (emptyFile.matches.length || emptyFile.error) throw new Error(`Empty file search misbehaved: ${JSON.stringify(emptyFile)}`)

const atZero = findEditorSearchMatches('abc', 'a', { matchCase: true, regex: false })
const atEof = findEditorSearchMatches('abc', 'c', { matchCase: true, regex: false })
if (atZero.matches[0]?.start !== 0 || atEof.matches[0]?.end !== 3) {
  throw new Error(`Matches at position 0 / EOF drifted: ${JSON.stringify([atZero, atEof])}`)
}

const noTrailingNewline = findEditorSearchMatches('one\ntwo', 'two', { matchCase: true, regex: false })
if (noTrailingNewline.matches[0]?.start !== 4) throw new Error(`Match on an unterminated last line failed: ${JSON.stringify(noTrailingNewline)}`)

// Literal search never overlaps itself: "aa" in "aaaa" is two matches, not three.
const overlapping = findEditorSearchMatches('aaaa', 'aa', { matchCase: true, regex: false })
if (overlapping.matches.map((match) => match.start).join(',') !== '0,2') {
  throw new Error(`Repeated-literal matches overlapped: ${JSON.stringify(overlapping)}`)
}

// A capturing zero-width pattern must terminate, one match per position plus EOF.
const zeroWidthGroup = findEditorSearchMatches('ab\tc', '()', { matchCase: true, regex: true })
if (zeroWidthGroup.matches.map((match) => match.start).join(',') !== '0,1,2,3,4') {
  throw new Error(`Zero-width capture group did not walk every position once: ${JSON.stringify(zeroWidthGroup)}`)
}

// Regex metacharacters typed into a plain-text query are literals, not syntax.
for (const [content, query] of [['a$b', '$'], ['a.b', '.'], ['a\\b', '\\'], ['a[b', '['], ['a(b', '(']] as const) {
  const literalMeta = findEditorSearchMatches(content, query, { matchCase: true, regex: false })
  if (literalMeta.error || literalMeta.matches[0]?.start !== 1) {
    throw new Error(`Literal metacharacter query "${query}" was not escaped: ${JSON.stringify(literalMeta)}`)
  }
}

const insensitive = findEditorSearchMatches('Tab\tTAB tab', 'tab', { matchCase: false, regex: false })
const sensitive = findEditorSearchMatches('Tab\tTAB tab', 'tab', { matchCase: true, regex: false })
if (insensitive.matches.length !== 3 || sensitive.matches.length !== 1 || sensitive.matches[0]!.start !== 8) {
  throw new Error(`Case sensitivity toggle failed: ${JSON.stringify([insensitive, sensitive])}`)
}

// Combining marks are ordinary code units; a decomposed query matches decomposed text.
const combining = findEditorSearchMatches('café latte', 'é', { matchCase: true, regex: false })
if (combining.matches.length !== 1 || combining.matches[0]!.start !== 3 || combining.matches[0]!.end !== 5) {
  throw new Error(`Combining-mark search drifted: ${JSON.stringify(combining)}`)
}

// An out-of-bounds or inverted range clamps instead of producing negative offsets.
const clamped = findEditorSearchMatches('one one', 'one', { matchCase: true, regex: false, range: { start: -50, end: 500 } })
const inverted = findEditorSearchMatches('one one', 'one', { matchCase: true, regex: false, range: { start: 7, end: 0 } })
if (clamped.matches.length !== 2 || inverted.matches.length !== 0) {
  throw new Error(`Search range was not clamped: ${JSON.stringify([clamped, inverted])}`)
}

// Replacement tokens must expand exactly as every regex engine does, because
// anything else is pasted verbatim into the user's file.
const twoGroups = findEditorSearchMatches('alpha-12', '(\\w+)-(\\d+)', { matchCase: true, regex: true }).matches[0]!
for (const template of ['$1', '$2', '$12', '$21', '$10', '$99', '$0', '$$1', '$&', '$`', "$'", '$3']) {
  const ours = expandEditorSearchReplacement('alpha-12', twoGroups, template)
  const native = 'alpha-12'.replace(/(\w+)-(\d+)/, template)
  if (ours !== native) throw new Error(`Replacement "${template}" expanded to ${JSON.stringify(ours)}, not ${JSON.stringify(native)}`)
}

const optional = findEditorSearchMatches('ab', '(a)(z)?', { matchCase: true, regex: true }).matches[0]!
if (expandEditorSearchReplacement('ab', optional, '[$2]') !== '[]') {
  throw new Error('An unmatched optional group must expand to an empty string')
}

console.log('Editor search boundary/Unicode/overlap/replacement-token smoke passed')
