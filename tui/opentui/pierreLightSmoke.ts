// Transcript diff cards load @pierre's parser and file order without the rest
// of either package, and get the same answers the packages give.
//
// A fallback to the package entry points is correct but costs ~23MB on the
// render thread at launch — and is invisible, since every card still renders.
// So the source is asserted, and the order is compared with the package's own.
import assert from 'node:assert/strict'
import { cleanLastNewline as packageCleanLastNewline, parsePatchFiles as packageParsePatchFiles } from '@pierre/diffs'
import { prepareFileTreeInput } from '@pierre/trees'
import { cleanLastNewline, parsePatchFiles, pierreLightSource, sortTreePaths } from './pierreLight'

assert.equal(pierreLightSource, 'internal', '@pierre internals moved: pierreLight fell back to the package entry points')

const segments = ['src', 'lib', 'a', 'B', 'file10.ts', 'file2.ts', 'README.md', 'z', 'Zeta', 'x.y', 'v1', 'v10', 'v2']
let seed = 7
const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 1000) / 1000
for (let round = 0; round < 300; round++) {
  const paths = new Set<string>()
  const count = 1 + Math.floor(random() * 12)
  while (paths.size < count) {
    const depth = 1 + Math.floor(random() * 4)
    paths.add(Array.from({ length: depth }, () => segments[Math.floor(random() * segments.length)]).join('/') + (random() < 0.1 ? '/' : ''))
  }
  const input = [...paths]
  assert.deepEqual(sortTreePaths(input), [...prepareFileTreeInput(input, { flattenEmptyDirectories: true, sort: 'default' }).paths], `order differs for ${JSON.stringify(input)}`)
}

const patch = 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n-a\n+b\n c\n'
assert.deepEqual(parsePatchFiles(patch, 'k', false), packageParsePatchFiles(patch, 'k', false))
assert.equal(cleanLastNewline('a\n'), packageCleanLastNewline('a\n'))
console.log('pierre light smoke passed (internals load without the package entry points; file order and patch parsing match the packages)')
