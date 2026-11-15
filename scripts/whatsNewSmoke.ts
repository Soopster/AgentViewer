// What's new: grouping, scoring and the git-log parser, plus the reader against this repository.
import assert from 'node:assert/strict'
import { buildWhatsNew, classifyCommit, formatWhatsNewMarkdown, scoreCommit, whatsNewLineTone, type WhatsNewCommit } from '../lib/whatsNew'
import { parseWhatsNewLog, readWhatsNew } from '../lib/whatsNewReader'

const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).getTime()
const commit = (sha: string, subject: string, when: number, extra: Partial<WhatsNewCommit> = {}): WhatsNewCommit => ({
  sha, subject, body: '', author: 'me', timestampMs: when, tags: [], files: [{ path: 'lib/x.ts', added: 10, removed: 2 }], ...extra,
})

assert.equal(classifyCommit('Add a gallery'), 'feature')
assert.equal(classifyCommit('Fix the scroll jump'), 'fix')
assert.equal(classifyCommit('Bump dependencies to latest'), 'chore')
assert.equal(classifyCommit('feat(web): add panels'), 'feature', 'a conventional prefix is read through')
assert.equal(classifyCommit('Adaptive UI: patches and history'), 'improvement')

// No tags: one revision per local day, newest first; a chore never headlines.
{
  const big = commit('a', 'Add the gallery', at(15), { body: 'Why: people could not find recipes.\n\nMore.', files: Array.from({ length: 12 }, (_, i) => ({ path: `plugins/adaptive-ui/f${i}.ts`, added: 120, removed: 4 })) })
  const small = commit('b', 'Fix a typo in a label', at(15, 9))
  const chore = commit('c', 'Bump dependencies', at(14), { files: [{ path: 'package-lock.json', added: 9000, removed: 9000 }] })
  const summary = buildWhatsNew([chore, small, big])
  assert.equal(summary.grouping, 'day')
  assert.equal(summary.revisions.length, 2)
  const [today, yesterday] = summary.revisions
  assert.equal(today!.highlights[0]!.sha, 'a', 'the big explained feature leads')
  assert.equal(today!.highlights[0]!.area, 'adaptive-ui', 'the area is the plugin, not "plugins"')
  assert.equal(today!.highlights[0]!.detail, 'Why: people could not find recipes.')
  assert.equal(yesterday!.highlights.length, 0, 'a chore-only day has no highlights')
  assert.equal(yesterday!.added, 0, 'lockfile churn is not counted as work')
  assert.ok(scoreCommit(chore) < scoreCommit(small))
  const md = formatWhatsNewMarkdown(summary)
  assert.match(md, /^# What's new/)
  assert.match(md, /Maintenance only/)
  assert.equal(whatsNewLineTone('## v1'), 'revision')
  assert.equal(whatsNewLineTone('- **New:** x'), 'item')
  assert.equal(whatsNewLineTone('  why'), 'detail')
  assert.equal(whatsNewLineTone('_3 commits · 2 files · +1 −0_'), 'stats')
  assert.equal(whatsNewLineTone('- _and 2 other changes_'), 'note')
}

// Tags: a tag closes a release at its own commit; newer commits are unreleased; the limit says it cut.
{
  const commits = [
    commit('n1', 'Add newest', at(20)),
    commit('t2', 'Add second release', at(18), { tags: ['v2.0.0'] }),
    commit('n2', 'Fix between', at(17)),
    commit('t1', 'Add first release', at(10), { tags: ['v1.0.0'] }),
  ]
  const summary = buildWhatsNew(commits)
  assert.equal(summary.grouping, 'release')
  assert.deepEqual(summary.revisions.map(r => r.id), ['unreleased', 'v2.0.0', 'v1.0.0'])
  assert.equal(summary.revisions[1]!.commits, 2)
  assert.equal(buildWhatsNew(commits, { limit: 2 }).truncated, true)
  assert.equal(buildWhatsNew(commits, { limit: 3 }).truncated, false)
  assert.equal(buildWhatsNew([]).revisions.length, 0)
  assert.match(formatWhatsNewMarkdown(buildWhatsNew([])), /No commits/)
}

// The parser: tags from decorations, numstat with renames and binaries, bodies with newlines.
{
  const F = '\x1f'
  const out = [
    `\x1e${'a'.repeat(40)}${F}1700000000${F}Ann${F}HEAD -> main, tag: v1.2.0, origin/main${F}Add thing${F}Line one\n\nLine two\x1d\n\n3\t1\tlib/a.ts\n-\t-\tlogo.png\n5\t0\tlib/{old => new}/b.ts\n`,
    `\x1e${'b'.repeat(40)}${F}1699990000${F}Bo${F}${F}Fix it${F}\x1d\n\n1\t1\tc.ts\n`,
  ].join('')
  const [first, second] = parseWhatsNewLog(out)
  assert.deepEqual(first!.tags, ['v1.2.0'])
  assert.equal(first!.body, 'Line one\n\nLine two')
  assert.deepEqual(first!.files.map(f => f.path), ['lib/a.ts', 'logo.png', 'lib/new/b.ts'])
  assert.equal(first!.files[1]!.added, 0, 'a binary file counts as zero lines')
  assert.equal(second!.tags.length, 0)
  assert.equal(second!.files.length, 1)
}

// The reader, against this repository: real history yields revisions with highlights.
{
  const summary = await readWhatsNew({ limit: 3 })
  assert.ok(summary.scanned > 0 && summary.revisions.length > 0 && summary.revisions.length <= 3)
  assert.ok(summary.revisions.some(r => r.highlights.length > 0))
}
await assert.rejects(readWhatsNew({ cwd: '/' }), /not a git repository|Could not read/i)

console.log("What's new groups by release or day, scores highlights, and parses real git history.")
