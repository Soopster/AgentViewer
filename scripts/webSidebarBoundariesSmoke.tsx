import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import SessionList from '../components/SessionList'
import { SidebarProvider } from '../components/ui/sidebar'
import type { Session } from '../lib/types'
import { bestScore, highlightedSnippetParts, highlightTermsForQuery, sessionTabKey } from '../components/command-palette/searchModel'
import { sessionAttentionPresentation } from '../components/session-list/presentation'

const sessions: Session[] = [
  { sessionId: 'shared', provider: 'claude', summary: 'Review sidebar', firstPrompt: 'Separate filtering from presentation', cwd: '/src/alpha', tag: 'review, work', lastModified: Date.parse('2026-10-29T00:00:00Z') },
  { sessionId: 'shared', provider: 'codex', providerInstanceId: 'codex-work', customTitle: 'Implement sidebar', cwd: '/src/beta', tag: 'work', lastModified: Date.parse('2026-10-28T00:00:00Z') },
  { sessionId: 'other', provider: 'opencode', summary: 'Check stream', cwd: '/src/alpha', firstPrompt: 'Check stream', createdAt: '2026-10-27T00:00:00Z' },
]
const noop = () => {}
const props: React.ComponentProps<typeof SessionList> = {
  sessions, loading: false, error: null, provider: 'all', providerInstanceId: 'all', providerInstances: [],
  switchingProvider: false, selectedId: 'codex-work:shared', selectedProject: null,
  teamAttention: { 'claude:shared': { waiting: 1, finished: 0 } },
  onSelect: noop, onSelectProject: noop, onRename: noop, onTag: noop,
  onChangeProvider: noop, scopeMode: 'all', scopeProjectName: null, canScopeToProject: true,
  includeWorktrees: true, onChangeScope: noop, onToggleWorktrees: noop, onOpenCommandPalette: noop,
  onOpenCoordinator: noop, canOpenGit: true, onOpenGit: noop,
  onNewSession: noop,
}
// Guard the sidebar structure, including the metadata-driven Messaging launcher,
// teammate attention, loading/error/empty states, and both sidebar sizes.
const html = [true, false].flatMap(defaultOpen => [
  {}, { loading: true }, { error: 'Fixture error' }, { sessions: [] },
].map(overrides => renderToStaticMarkup(
  <SidebarProvider defaultOpen={defaultOpen}><SessionList {...props} {...overrides} /></SidebarProvider>,
)))
assert.ok(html[0]!.includes('codex-work:shared'))
assert.ok(html[0]!.includes('Review sidebar'))
assert.ok(html[4]!.includes('Expand sidebar'))
const digest = createHash('sha256').update(JSON.stringify(html)).digest('hex')
assert.ok(html[0]!.includes('aria-label="Open cross-session messaging"'))
assert.ok(html[0]!.includes('✉'))
// The run dashboard and Agent Operations launchers are plugin dashboards too, in metadata order.
const launchers = [...html[0]!.matchAll(/aria-label="(Open (?:run dashboard|Agent Operations dashboard|cross-session messaging))"/g)].map(match => match[1])
assert.deepEqual(launchers, ['Open run dashboard', 'Open Agent Operations dashboard', 'Open cross-session messaging'])
assert.ok(html[4]!.includes('aria-label="Open run dashboard"') && html[4]!.includes('aria-label="Open Agent Operations dashboard"'), 'the collapsed rail lost a dashboard launcher')
assert.equal(digest, '9957cf513b68f34d956c78583f36889d54f1f67819c7a6f96dd11002287a2c53')
assert.equal(sessionTabKey(sessions[1]!), 'codex-work:shared')
assert.notEqual(sessionTabKey(sessions[0]!), sessionTabKey(sessions[1]!))
assert.ok(bestScore(['alpha'], 'alpha') > bestScore(['alpha task'], 'alpha'))
assert.ok(bestScore(['alpha task'], 'alpha') > bestScore(['task alpha'], 'alpha'))
assert.equal(bestScore(['other task'], 'alpha'), -1)
const snippet = 'Review ALPHA task in alpha.ts'
const parts = highlightedSnippetParts(snippet, highlightTermsForQuery('alpha task'))
assert.equal(parts.map(part => part.text).join(''), snippet)
assert.deepEqual(parts.filter(part => part.highlight).map(part => part.text), ['ALPHA task', 'alpha'])
assert.equal(sessionAttentionPresentation({ waiting: 1, finished: 3 })?.label, '! 1')
assert.equal(sessionAttentionPresentation({ waiting: 0, finished: 1 })?.color, 'var(--green)')
assert.equal(sessionAttentionPresentation({ waiting: 0, finished: 0 }), null)
console.log('Web sidebar boundaries: rendered output parity passed')
