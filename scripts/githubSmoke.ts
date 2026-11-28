// Drives lib/github against a fake `gh` on PATH. The fake logs each invocation
// and answers from a script chosen by GH_FAKE_MODE, so what is asserted is the
// argv we build and how we read the answers — not GitHub.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-smoke-'))
const log = path.join(dir, 'calls.log')
fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh
echo "$*" >> "${log}"
if [ -n "$GH_FAKE_STDIN" ]; then cat > "${dir}/stdin.txt"; fi
case "$GH_FAKE_MODE" in
  loggedout) if [ "$1" = auth ]; then echo "You are not logged in to any GitHub hosts. Run gh auth login" >&2; exit 1; fi ;;
  ratelimit) echo "API rate limit exceeded" >&2; exit 1 ;;
esac
case "$1 $2" in
  "auth status") exit 0 ;;
  "repo view") if echo "$*" | grep -q stargazerCount; then echo '{"nameWithOwner":"octo/repo","description":"A \\u001b[31mrepo\\u001b[0m","url":"https://github.com/octo/repo","defaultBranchRef":{"name":"main"},"visibility":"PUBLIC","isFork":false,"stargazerCount":5,"forkCount":1,"issues":{"totalCount":3},"pullRequests":{"totalCount":2},"primaryLanguage":{"name":"TypeScript"},"licenseInfo":{"name":"MIT"},"pushedAt":"t"}'; else echo "octo/repo"; fi ;;
  "api repos/octo/repo/branches?per_page=30") echo '[{"name":"main","protected":true,"commit":{"sha":"abcdef123456"}}]' ;;
  "api repos/octo/repo/commits?per_page=15") echo '[{"sha":"abcdef123456","html_url":"cu","author":{"login":"ann"},"commit":{"message":"Fix it","author":{"name":"Ann","date":"d"}}}]' ;;
  "api repos/octo/repo/assignees?per_page=50") echo '["ann","me"]' ;;
  "label list") echo '[{"name":"bug","color":"d73a4a","description":"Broken"}]' ;;
  "pr list") echo '[{"number":7,"title":"Fix","state":"OPEN","isDraft":false,"url":"u","author":{"login":"a"},"headRefName":"f","baseRefName":"main","updatedAt":"t","reviewDecision":"APPROVED","labels":[{"name":"bug"}],"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS"},{"status":"IN_PROGRESS"}]}]' ;;
  "api graphql") if echo "$*" | grep -q resolveReviewThread; then exit 0; fi; echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[{"id":"PRRT_abc12345","isResolved":false,"isOutdated":false,"path":"a.ts","line":4,"comments":{"totalCount":3,"nodes":[{"author":{"login":"rev"},"body":"nit\\u001b[0m"}]}}]}}}}}' ;;
  "release list") echo '[{"tagName":"v1.0.0","name":"One","isDraft":false,"isPrerelease":false,"isLatest":true,"publishedAt":"t"}]' ;;
  "release view") echo '{"tagName":"v1.0.0","name":"One","isDraft":false,"isPrerelease":false,"publishedAt":"t","body":"notes","author":{"login":"ann"},"assets":[{"name":"a.zip","size":10,"downloadCount":2}],"url":"ru"}' ;;
  "release create") echo "https://github.com/octo/repo/releases/tag/v2" ;;
  "workflow list") echo '[{"id":1,"name":"CI","state":"active","path":".github/workflows/ci.yml"}]' ;;
  "workflow run"|"pr update-branch"|"pr comment"|"pr review") exit 0 ;;
  "api -X") exit 0 ;;
  "api repos/octo/repo/dependabot/alerts?state=open&per_page=50") echo '[{"number":1,"html_url":"d","created_at":"2","security_advisory":{"summary":"Prototype pollution","severity":"high"},"dependency":{"package":{"name":"lodash","ecosystem":"npm"},"manifest_path":"package.json"}}]' ;;
  "api repos/octo/repo/code-scanning/alerts?state=open&per_page=50") echo "HTTP 404: no analysis found" >&2; exit 1 ;;
  "api repos/octo/repo/secret-scanning/alerts?state=open&per_page=50") echo '[{"number":9,"html_url":"s","created_at":"3","secret_type_display_name":"AWS key","secret":"AKIASUPERSECRET"}]' ;;
  "api user") echo "me" ;;
  "api notifications?participating=true&per_page=30") echo '[{"id":"9","reason":"review_requested","updated_at":"t","subject":{"title":"Fix \\u001b[31mred\\u001b[0m","type":"PullRequest","url":"https://api.github.com/repos/octo/repo/pulls/7"},"repository":{"full_name":"octo/repo"}}]' ;;
  "search prs") if echo "$*" | grep -q review-requested; then echo '[{"number":7,"title":"Fix","url":"u","state":"OPEN","isDraft":false,"author":{"login":"you"},"updatedAt":"t","labels":[],"repository":{"nameWithOwner":"octo/repo"}}]'; else echo '[{"number":7,"title":"Fix","url":"u","state":"OPEN","isDraft":true,"author":{"login":"me"},"updatedAt":"t","labels":[{"name":"bug"}],"repository":{"nameWithOwner":"octo/repo"}},{"number":8,"title":"Mine","url":"u","state":"OPEN","isDraft":false,"author":{"login":"me"},"updatedAt":"t","labels":[],"repository":{"nameWithOwner":"octo/repo"}}]'; fi ;;
  "search issues") echo '[]' ;;
  "issue list") echo '[{"number":3,"title":"Bad\\u001b]0;pwn\\u0007title","state":"OPEN","url":"u","author":{"login":"a"},"assignees":[{"login":"me"}],"labels":[{"name":"bug"}],"comments":2,"updatedAt":"t"}]' ;;
  "issue view") echo '{"number":3,"title":"T","state":"OPEN","url":"u","author":{"login":"a"},"assignees":[],"labels":[],"updatedAt":"t","body":"b","comments":[{"id":"1","author":{"login":"c"},"body":"hi","createdAt":"t","url":"cu"}]}' ;;
  "run list") echo '[{"databaseId":11,"displayTitle":"CI","workflowName":"ci","headBranch":"feat","event":"push","status":"completed","conclusion":"failure","url":"u","createdAt":"t","updatedAt":"t"}]' ;;
  "run view") if echo "$*" | grep -q -- --log-failed; then printf 'step\\n\\033[31mboom\\033[0m\\n'; else echo '{"databaseId":11,"displayTitle":"CI","workflowName":"ci","headBranch":"feat","status":"completed","conclusion":"failure","jobs":[{"databaseId":5,"name":"test","status":"completed","conclusion":"failure","url":"j","steps":[{"name":"run","status":"completed","conclusion":"failure"}]}]}'; fi ;;
  "run rerun"|"run cancel"|"pr ready"|"pr merge"|"pr close") exit 0 ;;
  "pr view") echo "$GH_FAKE_PR" ;;
  "issue comment"|"issue create") echo "https://github.com/octo/repo/issues/4" ;;
esac
`, { mode: 0o755 })
process.env.PATH = `${dir}:${process.env.PATH}`
const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [])
const reset = () => { fs.rmSync(log, { force: true }) }

const { runGh, classifyGhFailure } = await import('../lib/github/ghRunner')
const { cachedGithubRead, clearGithubCache, invalidateGithubCache, githubCacheKey } = await import('../lib/github/cache')
const { scrubGithubText, tailText } = await import('../lib/github/text')
const { fetchGithubInbox } = await import('../lib/github/inbox')
const { buildIssueListArgs, fetchGithubIssues, fetchGithubIssue, mutateGithubIssue } = await import('../lib/github/issues')

// --- text hygiene
assert.equal(scrubGithubText('a\u001b[31mb\u001b[0m\u001b]0;t\u0007c‮d'), 'abcd')
assert.equal(scrubGithubText('x\r\ny\u0000'), 'x\ny')
assert.deepEqual(tailText('a\nb\nc', 100), { text: 'a\nb\nc', truncated: false })
assert.equal(tailText('x'.repeat(10) + '\nlast', 6).text, 'last')

// --- cache: single flight, TTL, failure not cached, invalidation
clearGithubCache()
let reads = 0
const slow = async () => { reads += 1; await new Promise(r => setTimeout(r, 20)); return reads }
const key = githubCacheKey('/r', 'k')
const [a, b] = await Promise.all([cachedGithubRead(key, 1000, slow), cachedGithubRead(key, 1000, slow)])
assert.equal(reads, 1); assert.equal(a, b)
await cachedGithubRead(key, 1000, slow); assert.equal(reads, 1, 'repeat inside TTL is free')
invalidateGithubCache('/r', 'k'); await cachedGithubRead(key, 1000, slow); assert.equal(reads, 2, 'invalidated')
let attempts = 0
const flaky = async () => { attempts += 1; if (attempts === 1) throw new Error('boom'); return 'ok' }
await assert.rejects(cachedGithubRead(githubCacheKey('/r', 'f'), 1000, flaky))
assert.equal(await cachedGithubRead(githubCacheKey('/r', 'f'), 1000, flaky), 'ok', 'a failure is retried, not cached')

// --- classification
process.env.GH_FAKE_MODE = 'loggedout'
assert.equal(classifyGhFailure(await runGh(dir, ['auth', 'status'])), 'unauthenticated')
process.env.GH_FAKE_MODE = 'ratelimit'
assert.equal(classifyGhFailure(await runGh(dir, ['repo', 'view'])), 'rate-limited')
delete process.env.GH_FAKE_MODE
assert.equal(classifyGhFailure({ stdout: '', stderr: 'spawn gh ENOENT', code: 1 }), 'missing')
assert.equal(classifyGhFailure({ stdout: '', stderr: 'boom', code: 1 }), null)

// --- inbox
clearGithubCache(); reset()
const inbox = await fetchGithubInbox(dir)
assert.equal(inbox.availability.ok, true)
assert.deepEqual(inbox.sections.map(s => [s.id, s.items.map(i => i.number)]), [['review-requested', [7]], ['my-prs', [8]], ['assigned', []], ['mentioned', []]], 'a PR appears once, in the first section')
assert.equal(inbox.notifications[0].title, 'Fix red', 'notification text is scrubbed')
assert.equal(inbox.notifications[0].url, 'https://github.com/octo/repo/pull/7')
assert.ok(calls().every(c => !c.includes('octo/repo') || c.includes('--repo octo/repo') || c.startsWith('repo view')), 'searches are repo-scoped')
const before = calls().length
await fetchGithubInbox(dir); assert.equal(calls().length, before, 'second inbox read is cached')
clearGithubCache(); process.env.GH_FAKE_MODE = 'loggedout'
const out = await fetchGithubInbox(dir)
assert.equal(out.availability.ok, false); assert.deepEqual(out.sections, [])
delete process.env.GH_FAKE_MODE

// --- issues
assert.throws(() => buildIssueListArgs({ label: '--web' }), /Invalid label/)
assert.ok(buildIssueListArgs({ limit: 9999 }).includes('100'), 'limit is capped')
clearGithubCache()
const issues = await fetchGithubIssues(dir, { state: 'open', label: 'bug' })
assert.equal(issues[0].title, 'Badtitle', 'OSC sequence stripped'); assert.equal(issues[0].comments, 2)
const detail = await fetchGithubIssue(dir, 3)
assert.equal(detail.thread[0].body, 'hi'); assert.equal(detail.comments, 1)
await assert.rejects(fetchGithubIssue(dir, 0), /Invalid issue number/)
process.env.GH_FAKE_STDIN = '1'; reset()
const url = await mutateGithubIssue(dir, { action: 'comment', number: 3, body: '`$(rm -rf /)` --web' })
assert.equal(url, 'https://github.com/octo/repo/issues/4')
assert.equal(fs.readFileSync(path.join(dir, 'stdin.txt'), 'utf8'), '`$(rm -rf /)` --web', 'body goes over stdin, never argv')
assert.equal(calls()[0], 'issue comment 3 --body-file -')
delete process.env.GH_FAKE_STDIN
await assert.rejects(mutateGithubIssue(dir, { action: 'comment', number: 3, body: '  ' }), /empty/)
await assert.rejects(mutateGithubIssue(dir, { action: 'create', title: 't', body: '', labels: ['-x'] }), /Invalid label/)
await assert.rejects(mutateGithubIssue(dir, { action: 'edit', number: 3 }), /Nothing to edit/)
clearGithubCache(); await fetchGithubIssues(dir); reset()
await mutateGithubIssue(dir, { action: 'close', number: 3 })
reset(); await fetchGithubIssues(dir); assert.equal(calls().length, 1, 'a mutation invalidates the issue list')

// --- actions
const { fetchGithubRuns, fetchGithubRun, fetchGithubRunFailedLog, actOnGithubRun } = await import('../lib/github/actions')
const { assessMerge, runGithubPrAction } = await import('../lib/github/prActions')
clearGithubCache(); reset()
const runs = await fetchGithubRuns(dir, { branch: 'feat' })
assert.equal(runs.runs[0].conclusion, 'failure'); assert.ok(calls()[0].includes('--branch feat'))
await assert.rejects(fetchGithubRuns(dir, { branch: '--web' }), /Invalid branch/)
assert.equal((await fetchGithubRun(dir, 11)).jobs[0].steps[0].name, 'run')
const failedLog = await fetchGithubRunFailedLog(dir, 11)
assert.ok(!failedLog.text.includes('\u001b') && failedLog.text.includes('boom'), 'CI log is scrubbed')
reset(); await actOnGithubRun(dir, 11, 'rerun-failed'); assert.equal(calls()[0], 'run rerun 11 --failed')
await assert.rejects(actOnGithubRun(dir, 0, 'cancel'), /Invalid run id/)

// --- PR actions
const ok = { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] }
assert.deepEqual(assessMerge(ok, false), { ok: true, reasons: [] })
assert.ok(assessMerge({ ...ok, mergeable: 'CONFLICTING' }, false).reasons.includes('has merge conflicts'))
assert.ok(assessMerge({ ...ok, mergeable: 'UNKNOWN' }, false).reasons.some(r => r.includes('not known')), 'unknown mergeability blocks')
assert.ok(assessMerge({ ...ok, isDraft: true }, false).reasons.includes('pull request is a draft'))
assert.ok(assessMerge({ ...ok, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] }, true).reasons[0].includes('failing'), 'failing checks block even with auto')
const running = { ...ok, statusCheckRollup: [{ status: 'IN_PROGRESS' }] }
assert.equal(assessMerge(running, false).ok, false); assert.equal(assessMerge(running, true).ok, true, 'auto waits for pending checks')
process.env.GH_FAKE_PR = JSON.stringify({ ...ok, mergeable: 'CONFLICTING' }); reset()
await assert.rejects(runGithubPrAction(dir, { action: 'merge', number: 7, method: 'squash' }), /Not merging #7: has merge conflicts/)
assert.ok(!calls().some(c => c.startsWith('pr merge')), 'a refused merge never reaches gh pr merge')
process.env.GH_FAKE_PR = JSON.stringify(ok); reset()
await runGithubPrAction(dir, { action: 'merge', number: 7, method: 'squash', deleteBranch: true })
assert.equal(calls()[1], 'pr merge 7 --squash --delete-branch')
await assert.rejects(runGithubPrAction(dir, { action: 'edit', number: 7, addReviewers: ['-x'] }), /Invalid reviewer/)
await assert.rejects(runGithubPrAction(dir, { action: 'edit', number: 7 }), /Nothing to edit/)
const { execFileSync } = await import('node:child_process')
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-smoke-repo-'))
execFileSync('git', ['init', '-q'], { cwd: repo }); fs.writeFileSync(path.join(repo, 'f'), 'x')
reset()
await assert.rejects(runGithubPrAction(repo, { action: 'checkout', number: 7 }), /uncommitted changes/)
assert.ok(!calls().some(c => c.startsWith('pr checkout')), 'checkout is refused over a dirty tree')
fs.rmSync(repo, { recursive: true, force: true })

// --- repo overview
const { fetchGithubRepoOverview } = await import('../lib/github/repo')
clearGithubCache()
const overview = await fetchGithubRepoOverview(dir)
assert.equal(overview.repo, 'octo/repo'); assert.equal(overview.description, 'A repo', 'description scrubbed')
assert.equal(overview.openIssues, 3); assert.equal(overview.openPullRequests, 2)
assert.equal(overview.branches[0].sha, 'abcdef1'); assert.equal(overview.commits[0].message, 'Fix it'); assert.equal(overview.commits[0].author, 'ann')
assert.deepEqual(overview.collaborators, ['ann', 'me']); assert.equal(overview.labels[0].name, 'bug')

// --- pull requests
const { fetchGithubPrs, fetchGithubPr, buildPrListArgs, rollupState } = await import('../lib/github/prs')
assert.ok(buildPrListArgs({ scope: 'mine' }).join(' ').includes('--author @me'))
assert.ok(buildPrListArgs({ scope: 'review-requested', search: 'parser' }).join(' ').includes('--search review-requested:@me parser'))
assert.equal(rollupState([]), 'none'); assert.equal(rollupState([{ status: 'COMPLETED', conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }]), 'failure', 'a failure outranks pending')
assert.equal(rollupState([{ status: 'COMPLETED', conclusion: 'SUCCESS' }]), 'success')
clearGithubCache()
const prs = await fetchGithubPrs(dir)
assert.equal(prs[0].checks, 'pending'); assert.equal(prs[0].reviewDecision, 'APPROVED'); assert.deepEqual(prs[0].labels, ['bug'])
process.env.GH_FAKE_PR = JSON.stringify({ number: 7, title: 'Fix', state: 'OPEN', statusCheckRollup: [{ name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'x' }], reviews: [{ author: { login: 'rev' }, state: 'APPROVED', body: 'ok', submittedAt: 't' }], reviewRequests: [{ login: 'bob' }], assignees: [], commits: [{ oid: 'abcdef123456', messageHeadline: 'c', authors: [{ login: 'ann' }] }], files: [{ path: 'a.ts', additions: 2, deletions: 1 }], comments: [], body: 'b' })
const pr = await fetchGithubPr(dir, 7)
assert.equal(pr.checkRuns[0].state, 'failure'); assert.deepEqual(pr.reviewRequests, ['bob']); assert.equal(pr.files[0].path, 'a.ts')
assert.equal(pr.threads[0].body, 'nit', 'thread text scrubbed'); assert.equal(pr.threads[0].replies, 2); assert.equal(pr.threads[0].resolved, false)

// --- PR review, comment, update-branch, threads
reset()
await runGithubPrAction(dir, { action: 'review', number: 7, verdict: 'approve' })
assert.equal(calls()[0], 'pr review 7 --approve')
await assert.rejects(runGithubPrAction(dir, { action: 'review', number: 7, verdict: 'request-changes' }), /needs a message/)
await assert.rejects(runGithubPrAction(dir, { action: 'review', number: 7, verdict: 'comment', body: '  ' }), /needs a message/)
process.env.GH_FAKE_STDIN = '1'; reset()
await runGithubPrAction(dir, { action: 'review', number: 7, verdict: 'request-changes', body: 'please fix --web' })
assert.equal(calls()[0], 'pr review 7 --request-changes --body-file -'); assert.equal(fs.readFileSync(path.join(dir, 'stdin.txt'), 'utf8'), 'please fix --web')
await runGithubPrAction(dir, { action: 'comment', number: 7, body: 'hello' })
delete process.env.GH_FAKE_STDIN
await assert.rejects(runGithubPrAction(dir, { action: 'comment', number: 7, body: ' ' }), /empty/)
reset(); await runGithubPrAction(dir, { action: 'update-branch', number: 7 }); assert.equal(calls()[0], 'pr update-branch 7')
await assert.rejects(runGithubPrAction(dir, { action: 'thread', threadId: 'x; drop', resolved: true }), /Invalid review thread/)
reset(); await runGithubPrAction(dir, { action: 'thread', threadId: 'PRRT_abc12345', resolved: true })
assert.ok(calls()[0].includes('resolveReviewThread') && calls()[0].includes('id=PRRT_abc12345'))
reset(); await runGithubPrAction(dir, { action: 'thread', threadId: 'PRRT_abc12345', resolved: false })
assert.ok(calls()[0].includes('unresolveReviewThread'))

// --- releases
const { fetchGithubReleases, fetchGithubRelease, createGithubRelease } = await import('../lib/github/releases')
clearGithubCache()
assert.equal((await fetchGithubReleases(dir))[0].isLatest, true)
assert.equal((await fetchGithubRelease(dir, 'v1.0.0')).assets[0].downloads, 2)
await assert.rejects(fetchGithubRelease(dir, '--web'), /Invalid tag/)
reset(); assert.equal(await createGithubRelease(dir, { tag: 'v2' }), 'https://github.com/octo/repo/releases/tag/v2')
assert.equal(calls()[0], 'release create v2 --generate-notes', 'no notes asks GitHub to generate them')
process.env.GH_FAKE_STDIN = '1'; reset()
await createGithubRelease(dir, { tag: 'v3', notes: 'hand written', draft: true, prerelease: true })
assert.equal(calls()[0], 'release create v3 --draft --prerelease --notes-file -')
delete process.env.GH_FAKE_STDIN
await assert.rejects(createGithubRelease(dir, { tag: '-x' }), /Invalid tag/)

// --- security: an off feature is "unavailable", never "no alerts"; secrets are never carried
const { fetchGithubSecurity } = await import('../lib/github/security')
clearGithubCache()
const security = await fetchGithubSecurity(dir)
assert.deepEqual(security.unavailable, ['code-scanning'], 'a 404 means the feature is off')
assert.deepEqual(security.alerts.map(a => a.kind), ['secret-scanning', 'dependabot'], 'sorted by severity')
assert.ok(!JSON.stringify(security).includes('AKIASUPERSECRET'), 'a secret value never leaves lib/github')

// --- workflows and notifications
const { fetchGithubWorkflows, dispatchGithubWorkflow } = await import('../lib/github/workflows')
const { markGithubNotificationRead, markAllGithubNotificationsRead } = await import('../lib/github/inbox')
assert.equal((await fetchGithubWorkflows(dir))[0].name, 'CI')
reset(); await dispatchGithubWorkflow(dir, { workflow: 'CI', ref: 'main', inputs: { env: 'prod' } })
assert.equal(calls()[0], 'workflow run CI --ref main -f env=prod')
await assert.rejects(dispatchGithubWorkflow(dir, { workflow: 'CI', inputs: { 'bad name': 'x' } }), /Invalid input name/)
await assert.rejects(dispatchGithubWorkflow(dir, { workflow: '--x' }), /Invalid workflow/)
reset(); await markGithubNotificationRead(dir, '123'); assert.equal(calls()[0], 'api -X PATCH notifications/threads/123')
await assert.rejects(markGithubNotificationRead(dir, '1; rm'), /Invalid notification id/)
reset(); await markAllGithubNotificationsRead(dir); assert.equal(calls()[0], 'api -X PUT notifications -F read=true')

// --- TUI text entry (pure)
const { applyComposeKey, composeView } = await import('../plugins/github/tui/githubCompose')
const k = (name: string, sequence = name, ctrl = false) => ({ name, sequence, ctrl, shift: false })
assert.deepEqual(applyComposeKey('ab', k('c')), { kind: 'edit', value: 'abc' })
assert.deepEqual(applyComposeKey('ab', k('backspace', '\u007f')), { kind: 'edit', value: 'a' })
assert.deepEqual(applyComposeKey('日本', k('backspace', '\u007f')), { kind: 'edit', value: '日' }, 'backspace removes a character, not a UTF-16 unit')
assert.deepEqual(applyComposeKey('a', k('x', '\u001b[31mred')), { kind: 'edit', value: 'a[31mred' }, 'an escape byte in pasted text is dropped')
assert.deepEqual(applyComposeKey('a', k('j', 'j', true)), { kind: 'edit', value: 'a\n' }, 'ctrl+j is the newline; enter submits')
assert.deepEqual(applyComposeKey('a', k('return', '\r')), { kind: 'submit' })
assert.deepEqual(applyComposeKey('a', k('escape', '\u001b')), { kind: 'cancel' })
assert.deepEqual(applyComposeKey('a b', k('w', 'w', true)), { kind: 'edit', value: 'a' }, 'ctrl+w deletes a word')
assert.deepEqual(applyComposeKey('a', k('up', '')), { kind: 'ignore' }, 'a key with no text is ignored')
assert.deepEqual(applyComposeKey('a', { ...k('x'), meta: true }), { kind: 'ignore' })
assert.equal(applyComposeKey('', k('x', 'x'.repeat(30_000))).kind, 'edit')
assert.ok((applyComposeKey('', k('x', 'x'.repeat(30_000))) as { value: string }).value.length <= 20_000, 'a paste is bounded')
assert.deepEqual(composeView('abcdef', 4, 5), ['abcd', 'ef▏'], 'long lines wrap and the cursor trails')
assert.deepEqual(composeView('1\n2\n3\n4', 10, 2), ['3', '4▏'], 'only the tail that fits is shown')

fs.rmSync(dir, { recursive: true, force: true })
console.log('github smoke: PASS')
process.exit(0)
