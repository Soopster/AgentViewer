// The Web editor's language server, through its route, against a real
// typescript-language-server in a throwaway project: diagnostics arrive,
// completion after `.`, hover, definition as a workspace path, a path outside
// the workspace is refused, and closing releases the document. Skips (and
// says so) when no TypeScript server is installed.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

try { execFileSync('which', ['typescript-language-server'], { stdio: 'ignore' }) } catch { console.log('Web editor LSP smoke: SKIP (typescript-language-server is not installed)'); process.exit(0) }
const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'web-editor-lsp-')))
writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2022', module: 'esnext' } }))
writeFileSync(path.join(root, 'shapes.ts'), 'export type Shape = { width: number; height: number }\nexport function area(shape: Shape): number { return shape.width * shape.height }\n')
const text = "import { area, type Shape } from './shapes'\nconst box: Shape = { width: 2, height: 3 }\nconst total: string = area(box)\nbox.\n"
writeFileSync(path.join(root, 'main.ts'), text)
const usesText = 'export const n = area({ width: 1, height: 2 })\n'
writeFileSync(path.join(root, 'uses.ts'), usesText)
execFileSync('git', ['init', '-q'], { cwd: root })

const route = await import('../app/api/editor/lsp/route')
const { openLspDocumentCount } = await import('../plugins/editor/server/lspHost')
const call = async (body: Record<string, unknown>) => { const response = await route.POST(new NextRequest('http://localhost/api/editor/lsp', { method: 'POST', body: JSON.stringify({ cwd: root, path: 'main.ts', ...body }) })); return { status: response.status, body: await response.json() } }
const until = async <T>(what: string, read: () => Promise<T | null>, ms = 30_000): Promise<T> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 300)) }
  throw new Error(`timed out: ${what}`)
}
try {
  assert.equal((await call({ action: 'open', path: '../escape.ts', text: '' })).status, 400, 'a path outside the workspace is refused')
  const opened = await call({ action: 'open', text })
  assert.equal(opened.status, 200, JSON.stringify(opened.body))
  const status = await until('the server is ready', async () => { const state = (await call({ action: 'state' })).body; return state.status?.state === 'ready' ? state.status : null })
  console.log(`Open: ${status.name} ready.`)
  const diagnostics = await until('a type error is reported', async () => { const state = (await call({ action: 'state' })).body; return state.diagnostics?.find((d: { line: number }) => d.line === 2) ?? null })
  assert.equal(diagnostics.severity, 1)
  assert.match(diagnostics.message, /number.*string|string/)
  console.log(`Diagnostics: line 3 — ${diagnostics.message}`)
  const completion = await until('members complete after `.`', async () => { const items = (await call({ action: 'completion', position: { line: 3, character: 4 }, trigger: '.' })).body.items ?? []; return items.length ? items : null })
  assert.deepEqual(completion.map((item: { label: string }) => item.label).filter((label: string) => ['width', 'height'].includes(label)).sort(), ['height', 'width'])
  assert.equal(completion[0].rawItem, undefined, 'the server\'s raw item stays on the server')
  console.log(`Completion: ${completion.length} items, width and height among them.`)
  const hover = (await call({ action: 'hover', position: { line: 2, character: 23 } })).body.hover
  assert.match(hover?.contents ?? '', /area\(shape: Shape\): number/)
  const definition = (await call({ action: 'definition', position: { line: 2, character: 23 } })).body.locations
  assert.deepEqual(definition.map((location: { path: string; inside: boolean }) => [location.path, location.inside]), [['shapes.ts', true]])
  assert.equal(definition[0].range.start.line, 1)
  console.log('Hover and definition: area\'s signature, and its definition as a workspace path.')
  assert.equal((await call({ action: 'change', text: text.replace('const total: string', 'const total: number') })).status, 200)
  let last: unknown = null
  await until('the fixed error clears', async () => { const state = (await call({ action: 'state' })).body; last = state.diagnostics; return state.diagnostics?.some((d: { line: number; severity: number }) => d.line === 2 && d.severity === 1) ? null : true }, 15_000)
    .catch(error => { throw new Error(`${error.message}; diagnostics: ${JSON.stringify(last)}`) })
  console.log('Change: fixing the type error clears it (a hint about the unused variable may remain).')

  // Rename: the edits come back as workspace paths for the browser to apply to its buffers.
  // From the definition (from a usage TypeScript renames only the local import, as `area as surface`).
  const shapesText = 'export type Shape = { width: number; height: number }\nexport function area(shape: Shape): number { return shape.width * shape.height }\n'
  await call({ action: 'open', path: 'shapes.ts', text: shapesText })
  const renamed = (await call({ action: 'rename', path: 'shapes.ts', position: { line: 1, character: 17 }, newName: 'surface' })).body.edit
  await call({ action: 'close', path: 'shapes.ts' })
  assert.deepEqual(renamed.changes.map((change: { path: string }) => change.path).sort(), ['main.ts', 'shapes.ts'], `rename reaches both files: ${JSON.stringify(renamed)}`)
  assert.deepEqual(renamed.outside, [])
  console.log('Rename: one symbol renamed across two files, as edits for the browser.')

  // A code action: the missing import's quick fix.
  const usesCall = async (body: Record<string, unknown>) => call({ path: 'uses.ts', ...body })
  await usesCall({ action: 'open', text: usesText })
  await until('the missing name is reported', async () => ((await usesCall({ action: 'state' })).body.diagnostics?.length ? true : null))
  const offered = await until('an import fix is offered', async () => {
    const actions = (await usesCall({ action: 'code-actions', position: { line: 0, character: 17 }, end: { line: 0, character: 21 } })).body.actions ?? []
    return actions.find((action: { title: string }) => /import/i.test(action.title)) ?? null
  })
  const fix = (await usesCall({ action: 'apply-code-action', index: offered.index })).body.edit
  assert.equal(fix.changes[0]?.path, 'uses.ts')
  assert.match(fix.changes[0].edits.map((edit: { newText: string }) => edit.newText).join(''), /import \{ area \} from ["']\.\/shapes["']/)
  await usesCall({ action: 'close' })
  console.log(`Code action: "${offered.title}" returns its edit for the browser.`)
} finally {
  await call({ action: 'close' })
}
assert.equal(openLspDocumentCount(), 0, 'closing released the document')

// Project search: git grep over the working tree, including untracked files.
const search = await import('../app/api/editor/search/route')
const found = await (await search.GET(new NextRequest(`http://localhost/api/editor/search?${new URLSearchParams({ cwd: root, q: 'AREA(' })}`))).json()
assert.deepEqual(found.results.map((result: { path: string; line: number }) => `${result.path}:${result.line}`).sort(), ['main.ts:3', 'shapes.ts:2', 'uses.ts:1'], `search is case-insensitive and finds untracked files: ${JSON.stringify(found)}`)
const none = await (await search.GET(new NextRequest(`http://localhost/api/editor/search?${new URLSearchParams({ cwd: root, q: 'no-such-text' })}`))).json()
assert.deepEqual(none.results, [])
console.log('Search: a fixed string across the project, case-insensitive, untracked files included.')
assert.equal((await call({ action: 'state' })).status, 409, 'a closed document answers as not open')
console.log('Web editor LSP smoke: PASS')
process.exit(0)
