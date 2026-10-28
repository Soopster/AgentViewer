import assert from 'node:assert/strict'
import { toV1Question, toV2FormAnswer, type V2FormInfo } from '../lib/opencode2Mapping'
import { extractOpenCodeQuestion, initialQuestionState } from '../lib/permissions'

const form: V2FormInfo = { id: 'form', sessionID: 'session', title: 'Settings', fields: [
  { key: 'count', title: 'Count', type: 'integer', required: true, minimum: 1, maximum: 10, default: 3 },
  { key: 'enabled', type: 'boolean', default: false },
  { key: 'choice', type: 'string', options: [{ label: 'Friendly label', value: 'internal' }], default: 'internal' },
  { key: 'optional', type: 'number', required: false },
  { key: 'browser', type: 'external', url: 'https://example.com/form' },
] }
assert.deepEqual(toV2FormAnswer(form, []), { count: 3, enabled: false, choice: 'internal' })
for (const invalid of ['nope', 'NaN', 'Infinity', '1.5', '0', '11']) {
  assert.throws(() => toV2FormAnswer(form, [[invalid]]), /Count/, `must reject ${invalid}`)
}
assert.throws(() => toV2FormAnswer(form, [['2'], ['possibly']]), /Yes or No/)
assert.throws(() => toV2FormAnswer(form, [['']]), /required/, 'clearing a required default must not silently restore it')
assert.deepEqual(toV2FormAnswer({ ...form, fields: [{ key: 'choices', type: 'multiselect', default: ['a'], custom: true }] }, [[]]),
  { choices: [] }, 'deselecting defaults must preserve the empty selection')
assert.throws(() => toV2FormAnswer({ ...form, fields: [{ key: 'choices', type: 'multiselect', required: true }] }, [[]]), /required/)
assert.throws(() => toV2FormAnswer(form, [['2'], ['No'], ['unknown']]), /listed option/)
assert.deepEqual(toV2FormAnswer(form, [['2'], ['Yes'], ['Friendly label'], ['1.5']]), {
  count: 2, enabled: true, choice: 'internal', optional: 1.5,
})
assert.throws(() => toV2FormAnswer({ ...form, fields: [{ key: 'required', type: 'string', required: true }] }, []), /required/)
assert.deepEqual(toV2FormAnswer({ ...form, fields: [{ key: '__proto__', type: 'multiselect', custom: true }] }, [['value']]),
  JSON.parse('{"__proto__":["value"]}'), 'field keys must remain own answer properties')
assert.throws(() => toV2FormAnswer({ ...form, fields: [{ key: 'choice', type: 'string', options: [
  { label: 'Same', value: 'a' }, { label: 'Same', value: 'b' },
] }] }, [['Same']]), /ambiguous/)

const pending = extractOpenCodeQuestion({ type: 'opencode_event', event: {
  type: 'question.asked', properties: toV1Question(form),
} })!
assert.ok(pending.questions)
assert.match(pending.questions[0]!.question, /Whole number, minimum 1, maximum 10/)
assert.equal(pending.questions[3]!.required, false)
assert.equal(pending.questions[4]!.externalUrl, 'https://example.com/form')
assert.equal(pending.questions[4]!.allowFreeform, false)
const initial = initialQuestionState(pending.questions)
assert.deepEqual(initial.freeformAnswers, { 0: '3' })
assert.deepEqual(initial.selections[1], ['No'])
assert.deepEqual(initial.selections[2], ['Friendly label'])
const unsafe = extractOpenCodeQuestion({ type: 'opencode_event', event: {
  type: 'question.asked', properties: toV1Question({ ...form, fields: [{ key: 'link', type: 'external', url: 'javascript:alert(1)' }] }),
} })!
assert.equal(unsafe.questions![0]!.externalUrl, undefined)
console.log('OpenCode forms smoke passed: typed validation, bounds, defaults, optional fields, option values, external links')
