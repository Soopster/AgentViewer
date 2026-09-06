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
