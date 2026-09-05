import assert from 'node:assert/strict'
import { downloadHtml } from '../lib/downloadHtml'
import { downloadHtml as compatibilityDownload, exportSessionToHtml } from '../lib/export'

assert.equal(downloadHtml, compatibilityDownload, 'existing export API must remain compatible')
const html = exportSessionToHtml({ sessionId: 'export-smoke', summary: 'Export smoke' }, [{
  type: 'user', uuid: 'user-1', session_id: 'export-smoke', parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'text', text: 'Hello **world**\n\n<script>alert("unsafe")</script>' }] },
}])
assert.ok(html.includes('Hello <strong>world</strong>'))
assert.ok(html.includes('&lt;script&gt;'))
assert.ok(!html.includes('<script>alert("unsafe")</script>'))

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
const events: string[] = []
let blob: Blob | undefined
const anchor = { href: '', download: '', click: () => events.push('click') }
try {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: (tag: string) => { assert.equal(tag, 'a'); return anchor },
    body: { appendChild: () => events.push('append'), removeChild: () => events.push('remove') },
  } })
  URL.createObjectURL = value => { blob = value as Blob; return 'blob:export-smoke' }
  URL.revokeObjectURL = value => { assert.equal(value, 'blob:export-smoke'); events.push('revoke') }
  downloadHtml(html, 'export-smoke.html')
  assert.equal(anchor.download, 'export-smoke.html')
  assert.equal(anchor.href, 'blob:export-smoke')
  assert.equal(blob?.type, 'text/html;charset=utf-8')
  assert.equal(await blob?.text(), html)
  assert.deepEqual(events, ['append', 'click', 'remove', 'revoke'])
} finally {
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
  else Reflect.deleteProperty(globalThis, 'document')
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
}
console.log('HTML export content, compatibility and download lifecycle passed')
