// The facet state becomes the index query it names, and no more: a blank query
// searches nothing, and an unset facet is absent from the query rather than a default.
import assert from 'node:assert/strict'
import { changeFacet, EMPTY_FACETS, editText, searchParamsFor, stepField } from '../../plugins/session-insights/tui/index-search/model'

const now = Date.parse('2026-11-02T00:00:00Z')
assert.equal(searchParamsFor(EMPTY_FACETS, now), null)
assert.equal(searchParamsFor({ ...EMPTY_FACETS, query: '   ' }, now), null)
assert.deepEqual(searchParamsFor({ ...EMPTY_FACETS, query: ' resize ' }, now), { query: 'resize', limit: 25 })
assert.deepEqual(
  searchParamsFor({ query: 'x', provider: 'codex', date: 'week', hasError: true, touchedFile: ' App.tsx ' }, now),
  { query: 'x', limit: 25, provider: 'codex', sinceMs: now - 7 * 86_400_000, hasError: true, touchedFile: 'App.tsx' },
)
// Facet changes: cycle with wrap, toggle, and text fields are not facets.
assert.equal(changeFacet(EMPTY_FACETS, 'provider', -1)?.provider, 'pi')
assert.equal(changeFacet(EMPTY_FACETS, 'date', 1)?.date, 'day')
assert.equal(changeFacet(EMPTY_FACETS, 'errors', 1)?.hasError, true)
assert.equal(changeFacet(EMPTY_FACETS, 'query', 1), null)
assert.equal(stepField('file', 1), 'query')
assert.equal(stepField('query', -1), 'file')
// Text editing.
const key = (name: string, sequence = name, extra = {}) => ({ name, sequence, ctrl: false, ...extra })
assert.equal(editText('ab', key('c')), 'abc')
assert.equal(editText('ab', key('backspace', '\x7f')), 'a')
assert.equal(editText('ab cd', key('w', 'w', { ctrl: true })), 'ab')
assert.equal(editText('ab', key('u', 'u', { ctrl: true })), '')
assert.equal(editText('ab', key('left', '\x1b[D')), null, 'an arrow is not text')
console.log('Session search model smoke passed (params, facets, text editing)')
