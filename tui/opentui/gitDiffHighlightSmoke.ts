import assert from 'node:assert/strict'
import { buildPierreDiffView } from './pierreDiffView'
import { createGitDiffHighlightClient, diffHighlightTarget } from './gitDiffHighlightWorkerClient'
import { DiffHighlightCache } from './diffHighlightCache'
import { diffTextHeight, diffTextWidth, layoutDiffText, matchesDiffFile, resolveDiffLayout } from './gitDiffText'

const text = (lines: ReturnType<typeof layoutDiffText>) => lines.map(line => line.map(span => span.text).join(''))
assert.deepEqual(text(layoutDiffText('a\tb界c', 4, 4, true)), ['a   ', 'b界c'])
assert.equal(diffTextHeight('a\tb界c', 4, 4, true), 2)
assert.equal(diffTextWidth('a\tb界c', 4), 8)
assert.deepEqual(text(layoutDiffText('界abc', 3, 4, false, 1)), [' ab'])
assert.deepEqual(text(layoutDiffText('e\u0301界', 2, 4, true)), ['e\u0301', '界'])
assert.equal(layoutDiffText('abcd', 2, 4, true, 0, [{text:'abcd', fg:'#ffffff', bg:'#123456'}])[1]?.[0]?.bg, '#123456')
assert.equal(resolveDiffLayout('auto', 99), 'stack')
assert.equal(resolveDiffLayout('auto', 100), 'split')
assert.equal(resolveDiffLayout('stack', 180), 'stack')
assert(matchesDiffFile('src/TestFile.ts', 'SRC file'))
assert(!matchesDiffFile('src/TestFile.ts', 'src css'))
const cache = new DiffHighlightCache<string>(400)
cache.set('a', 'a', 20); cache.set('b', 'b', 20); cache.get('a'); cache.set('c', 'c', 20)
assert.equal(cache.peek('b'), undefined)
assert.equal(cache.peek('a'), 'a')
assert(!cache.set('oversized', 'x', 401)); assert(cache.bytes <= 400)
const patch = (value: string) => `diff --git a/test.ts b/test.ts\nindex 1111111..2222222 100644\n--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-const old = 1;\n+const ${value} = 2;\n`
const file = (value: string) => buildPierreDiffView(patch(value), value, null)!.files![0]!
const first = diffHighlightTarget(file('foo'), 'test.ts', 'dark')
const second = diffHighlightTarget(file('bar'), 'test.ts', 'dark')
assert.notEqual(first.key, second.key, 'equal-length edits get distinct identities')
const client = createGitDiffHighlightClient(64 * 1024)
const until = async (predicate: () => boolean) => {
  for (let i = 0; i < 300 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 50))
  assert(predicate(), JSON.stringify(client.stats()))
}
try {
  client.setWindow([first, second]); client.setWindow([second])
  await until(() => client.peek(second.key) !== undefined)
  const result = client.peek(second.key)
  assert(result, 'real worker produces highlighted source spans')
  assert.equal(result.new.get(1)?.map(span => span.text).join(''), 'const bar = 2;')
  assert(result.new.get(1)?.some(span => span.fg), 'worker returns syntax colors')
  assert(client.stats().bytes <= client.stats().budget)
  const requests = client.stats().requests
  client.setWindow([second]); assert.equal(client.stats().requests, requests, 'cached file avoids repeat work')
  const huge = file('big'); huge.additionLines = Array.from({length:12001}, () => 'x')
  const target = diffHighlightTarget(huge, 'huge.ts', 'dark')
  client.setWindow([target]); assert.equal(client.peek(target.key), null)
  assert.equal(client.stats().requests, requests, 'oversized file keeps plain rendering without worker load')
} finally { client.dispose() }
assert.equal(client.stats().bytes, 0); assert.equal(client.stats().pending, 0)
console.log('Git highlight smoke passed: real worker, content identity, latest viewport, bounded cache, teardown, Unicode/tab layout')
