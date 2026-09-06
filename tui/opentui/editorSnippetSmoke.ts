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
