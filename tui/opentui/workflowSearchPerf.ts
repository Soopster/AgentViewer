// Deterministic output parity plus warmed median helper timings. These are not
// terminal FPS measurements. Run: bun tui/opentui/workflowSearchPerf.ts
import assert from 'node:assert/strict'
import type { Session } from '../../lib/types'
import { formatSessionProject, formatSessionTitle } from '../format'
import { buildEditorFileTree, type TreeNode } from './editorFileTree'
import { filterComposerMentionEntries } from './composerMentionRanking'
import { createSidebarSessionSearch } from './sidebarSessionSearch'

// Pre-optimization algorithm retained as a correctness and timing reference.
function baselineTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'directory', children: [] }
  for (const filePath of paths) {
    const parts = filePath.split('/').filter(Boolean)
    let parent = root
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index]!
      const nodePath = parts.slice(0, index + 1).join('/')
      const kind: TreeNode['kind'] = index === parts.length - 1 ? 'file' : 'directory'
      let child = parent.children.find((entry) => entry.name === name)
      if (!child) {
        child = { name, path: nodePath, kind, children: [] }
        parent.children.push(child)
      }
      parent = child
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'directory' ? -1 : 1)
    for (const node of nodes) sort(node.children)
  }
  sort(root.children)
  return root.children
}


function median(run: () => unknown): number {
  for (let i = 0; i < 5; i += 1) run()
  const samples: number[] = []
  for (let i = 0; i < 25; i += 1) {
    const start = performance.now()
    run()
    samples.push(performance.now() - start)
  }
  return samples.sort((a, b) => a - b)[12]!
}
function compare(label: string, before: () => unknown, after: () => unknown) {
  assert.deepEqual(after(), before(), label)
  const baseline = median(before)
  const optimized = median(after)
  console.log(`${label}: ${baseline.toFixed(3)} -> ${optimized.toFixed(3)} ms (${(baseline / optimized).toFixed(1)}x); identical output`)
}
for (const wide of [true, false]) {
  const paths = Array.from({ length: 5000 }, (_, i) => `${wide ? 'src' : `packages/pkg${i % 100}/src`}/file${(i * 7919) % 5000}.ts`)
  paths.push('src/Éclair2.ts', 'src/eclair10.ts', 'src/Z.ts', 'src/a.ts', 'src/a.ts')
  compare(`editor tree ${wide ? 'wide' : 'nested'} 5000`, () => baselineTree(paths), () => buildEditorFileTree(paths))
}
assert.deepEqual(buildEditorFileTree([]), [])
const entries = Array.from({ length: 5000 }, (_, i) => ({ path: `packages/project${i % 100}/src/component${i}.tsx`, basename: `component${i}.tsx` }))
const prefix = '/Users/example/projects/a-long-project-root'
const scores = Object.fromEntries(entries.map((entry, i) => [`${prefix}/${entry.path}`, (i * 7919) % 5000]))
compare('composer bare @ 5000', () => entries.map((entry, order) => ({ entry, order }))
  .sort((a, b) => scores[`${prefix}/${b.entry.path}`]! - scores[`${prefix}/${a.entry.path}`]! || a.order - b.order)
  .slice(0, 20).map(({ entry }) => entry), () => filterComposerMentionEntries(entries, '', 20, scores, prefix))
assert.deepEqual(filterComposerMentionEntries(entries, '', 20), entries.slice(0, 20), 'No history retains walk order')
assert.deepEqual(filterComposerMentionEntries(entries, '', 0), [], 'Zero limit remains empty')
const sessions: Session[] = Array.from({ length: 5000 }, (_, i) => ({
  sessionId: `SESSION-${i}`, summary: `Investigate rendering performance ${i}`, cwd: `/repo/project-${i % 100}`,
}))
sessions.push({ sessionId: 'untitled' }, { sessionId: 'custom', customTitle: 'Custom title', summary: 'hidden summary', cwd: 'C:\\repo\\Windows' })
const baselineSearch = (query: string) => query ? sessions.filter((session) => {
  const title = formatSessionTitle(session).toLowerCase()
  const project = formatSessionProject(session).toLowerCase()
  const id = session.sessionId.toLowerCase()
  return title.includes(query) || project.includes(query) || id.includes(query)
}) : sessions
const search = createSidebarSessionSearch(sessions)
assert.equal(search(''), sessions, 'Empty search preserves list identity')
for (const query of ['render', 'project-5', 'session-49', 'untitled', 'custom', 'windows', 'hidden summary', 'missing']) {
  assert.deepEqual(search(query), baselineSearch(query), query)
}
const queries = ['r', 're', 'ren', 'rend', 'rende', 'render', 'missing', 'project-5']
compare('sidebar 8-query sequence 5000', () => queries.map(baselineSearch), () => queries.map(search))
const renamed = sessions.map((session, i) => i === 0 ? { ...session, customTitle: 'renamed session' } : session)
assert.equal(createSidebarSessionSearch(renamed)('renamed session')[0], renamed[0], 'Replacement lists refresh indexed titles')
console.log('Workflow output parity passed')
