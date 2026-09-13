import { parseEditorSnippet } from './editorSnippet'

const parsed = parseEditorSnippet(
  'function ${1:name}(${2:first}, $2, ${3|fast,safe|}) {\n  ${4:${TM_FILENAME_BASE}}\n  $0\n}',
  { TM_FILENAME_BASE: 'worker' },
)

if (parsed.text !== 'function name(first, first, fast) {\n  worker\n  \n}') {
  throw new Error(`Snippet text was not expanded safely: ${JSON.stringify(parsed)}`)
}
if (parsed.tabstops.map((tabstop) => tabstop.index).join(',') !== '1,2,3,4,0') {
  throw new Error(`Snippet tabstops were not ordered with the final cursor last: ${JSON.stringify(parsed.tabstops)}`)
}
const mirrored = parsed.tabstops.find((tabstop) => tabstop.index === 2)
if (mirrored?.ranges.length !== 2
  || parsed.text.slice(mirrored.ranges[0]!.start, mirrored.ranges[0]!.end) !== 'first'
  || parsed.text.slice(mirrored.ranges[1]!.start, mirrored.ranges[1]!.end) !== 'first') {
  throw new Error(`Mirrored snippet placeholder ranges were not retained: ${JSON.stringify(mirrored)}`)
}
const escaped = parseEditorSnippet('cost \\$5, choice ${1|a\\,b,c|}, end \\}')
if (escaped.text !== 'cost $5, choice a,b, end }') {
  throw new Error(`Escaped snippet syntax was corrupted: ${JSON.stringify(escaped)}`)
}

const transformed = parseEditorSnippet(
  '${1:helloWorld} -> ${1/([a-z])([A-Z])/$1_${2:/downcase}/g} · ${TM_FILENAME/(.*)\\..+$/${1:/upcase}/}',
  { TM_FILENAME: 'worker.ts' },
)
if (transformed.text !== 'helloWorld -> hello_world · WORKER') {
  throw new Error(`Snippet transforms were not applied: ${JSON.stringify(transformed)}`)
}
const transformedMirror = transformed.tabstops.find((tabstop) => tabstop.index === 1)
if (!transformedMirror?.ranges[1]?.transform || transformedMirror.ranges[0]?.transform) {
  throw new Error(`Transformed mirrors were not distinguished from editable fields: ${JSON.stringify(transformedMirror)}`)
}

const forwardTransform = parseEditorSnippet('${1/(.*)/${1:/upcase}/} ${1:name}')
if (forwardTransform.text !== 'NAME name'
  || forwardTransform.tabstops[0]?.ranges[0]?.start !== 5
  || !forwardTransform.tabstops[0]?.ranges[1]?.transform) {
  throw new Error(`Forward transformed mirrors did not retain an editable primary: ${JSON.stringify(forwardTransform)}`)
}

const conditional = parseEditorSnippet(
  '${TM_FILENAME/(.*)(\\.ts)$/${1:/capitalize}${2:+-typescript}/}',
  { TM_FILENAME: 'worker.ts' },
)
if (conditional.text !== 'Worker-typescript') {
  throw new Error(`Conditional snippet formats were not applied: ${JSON.stringify(conditional)}`)
}

const unknown = parseEditorSnippet('$CUSTOM_NAME + ${CUSTOM_NAME}')
const unknownTabstop = unknown.tabstops.find((tabstop) => tabstop.index !== 0)
if (unknown.text !== 'CUSTOM_NAME + CUSTOM_NAME' || unknownTabstop?.ranges.length !== 2) {
  throw new Error(`Unknown variables were not retained as editable mirrored placeholders: ${JSON.stringify(unknown)}`)
}

const malformed = parseEditorSnippet('${1:source} ${1/[abc/replacement}')
if (malformed.text !== 'source ${1/[abc/replacement}') {
  throw new Error(`Malformed transforms should remain visible: ${JSON.stringify(malformed)}`)
}

console.log('Editor snippet expansion and tabstop smoke passed.')

// --- Adversarial cases: nesting, repetition, regex-special text, degenerates ---

// A nested placeholder keeps its own tabstop inside the outer one's text.
const nested = parseEditorSnippet('${1:outer ${2:inner}} $1')
const nestedOuter = nested.tabstops.find((tabstop) => tabstop.index === 1)
const nestedInner = nested.tabstops.find((tabstop) => tabstop.index === 2)
if (nested.text !== 'outer inner outer inner'
  || nested.text.slice(nestedOuter!.ranges[0]!.start, nestedOuter!.ranges[0]!.end) !== 'outer inner'
  || nested.text.slice(nestedInner!.ranges[0]!.start, nestedInner!.ranges[0]!.end) !== 'inner') {
  throw new Error(`Nested placeholder ranges drifted: ${JSON.stringify(nested)}`)
}
// Three levels deep still resolves to the innermost default, once.
if (parseEditorSnippet('${1:${2:${3:x}}}').text !== 'x') throw new Error('Deeply nested placeholders were not collapsed')

// The same tabstop repeated gets one range per occurrence, all mirroring the
// first default even when the default is declared after a bare reference.
const repeated = parseEditorSnippet('${1:x} $1 $1')
const backwards = parseEditorSnippet('$1 and ${1:seed}')
if (repeated.tabstops.find((tabstop) => tabstop.index === 1)?.ranges.length !== 3
  || repeated.text !== 'x x x'
  || backwards.text !== 'seed and seed') {
  throw new Error(`Repeated tabstop mirroring drifted: ${JSON.stringify([repeated, backwards])}`)
}
// A second default for an index already seeded does not re-write the first.
if (parseEditorSnippet('${1:first} ${1:second}').text !== 'first first') {
  throw new Error('A repeated placeholder default overwrote the first one')
}

// Placeholder and choice bodies are literal text, never patterns — regex
// metacharacters in them must survive byte for byte.
const metaPlaceholder = parseEditorSnippet('${1:a.*+?[]()|^$} $1')
if (metaPlaceholder.text !== 'a.*+?[]()|^$ a.*+?[]()|^$') {
  throw new Error(`Regex metacharacters in a placeholder were mangled: ${JSON.stringify(metaPlaceholder.text)}`)
}
if (parseEditorSnippet('${1|a.*,b(c|}').text !== 'a.*') throw new Error('Regex metacharacters in a choice were mangled')

// Tabstop ordering is numeric, not lexicographic, and $0 always lands last.
const ordering = parseEditorSnippet('${10:ten} ${2:two} ${1:one} $0')
if (ordering.tabstops.map((tabstop) => tabstop.index).join(',') !== '1,2,10,0') {
  throw new Error(`Tabstop ordering is not numeric: ${JSON.stringify(ordering.tabstops.map((t) => t.index))}`)
}

// Degenerate snippets still produce a usable final cursor rather than throwing.
for (const source of ['', '$0', '$', '${', '${1:unclosed', '}', '\\', '${}']) {
  const degenerate = parseEditorSnippet(source)
  const final = degenerate.tabstops.find((tabstop) => tabstop.index === 0)
  if (!final || final.ranges.length === 0) throw new Error(`Snippet ${JSON.stringify(source)} produced no final cursor`)
  for (const tabstop of degenerate.tabstops) {
    for (const range of tabstop.ranges) {
      if (range.start < 0 || range.end > degenerate.text.length || range.start > range.end) {
        throw new Error(`Snippet ${JSON.stringify(source)} produced an out-of-bounds range: ${JSON.stringify(tabstop)}`)
      }
    }
  }
}
if (parseEditorSnippet('${1:unclosed').text !== '${1:unclosed') throw new Error('An unclosed placeholder must stay visible')

// Astral placeholder text keeps whole code points in every range it reports.
const astral = parseEditorSnippet('${1:\u{1F600}} $1')
for (const range of astral.tabstops.find((tabstop) => tabstop.index === 1)!.ranges) {
  const slice = astral.text.slice(range.start, range.end)
  if (slice !== '\u{1F600}') throw new Error(`Snippet range split a surrogate pair: ${JSON.stringify(slice)}`)
}

// Every reported range must actually address the text that was produced.
const wide = parseEditorSnippet('fn ${1:name}(${2:a}: ${3:T}) -> ${4:${1:name}} { $0 }')
for (const tabstop of wide.tabstops) {
  for (const range of tabstop.ranges) {
    if (range.start < 0 || range.end > wide.text.length || range.start > range.end) {
      throw new Error(`Snippet tabstop ${tabstop.index} addressed text outside the expansion: ${JSON.stringify(range)}`)
    }
  }
}

console.log('Editor snippet nesting/repetition/metacharacter/degenerate smoke passed.')
