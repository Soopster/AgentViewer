import assert from 'node:assert/strict'
import { readReaderLayout } from './readerLayout'

const layout = { top: 12, height: 24 }
const modern = { layout, getLayout() { return this.layout } }
const alternate = { layout, getComputedLayout() { return this.layout } }
assert.equal(readReaderLayout(modern), layout)
assert.equal(readReaderLayout(alternate), layout)
assert.equal(readReaderLayout({}), null)
assert.equal(readReaderLayout({ isDestroyed: true, getLayout() { throw new Error('destroyed') } }), null)
assert.equal(readReaderLayout({ getLayout: () => ({ top: NaN, height: 24 }) }), null)
console.log('reader layout smoke passed')
