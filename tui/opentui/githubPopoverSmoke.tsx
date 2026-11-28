/** @jsxImportSource @opentui/react */
// The GitHub popover against a fake `gh`: each tab lists what the CLI returned,
// detail and the failed-step log render, and a destructive key asks before it
// acts and does nothing on anything but `y`. Keys are fed straight to the
// handler the popover registers, which is the contract the host drives it by.
import React from 'react'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-popover-smoke-'))
const log = path.join(dir, 'calls.log')
fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh
echo "$*" >> "${log}"
case "$1 $2" in
  "auth status") exit 0 ;;
  "repo view") if echo "$*" | grep -q stargazerCount; then echo '{"nameWithOwner":"octo/repo","description":"Parser toolkit","url":"https://github.com/octo/repo","defaultBranchRef":{"name":"main"},"visibility":"PUBLIC","isFork":false,"stargazerCount":5,"forkCount":1,"issues":{"totalCount":3},"pullRequests":{"totalCount":2},"primaryLanguage":{"name":"TypeScript"},"licenseInfo":{"name":"MIT"},"pushedAt":"t"}'; else echo "octo/repo"; fi ;;
  "api repos/octo/repo/branches?per_page=30") echo '[{"name":"main","protected":true,"commit":{"sha":"abcdef123456"}}]' ;;
  "api repos/octo/repo/commits?per_page=15") echo '[{"sha":"abcdef123456","html_url":"cu","author":{"login":"ann"},"commit":{"message":"Tighten the lexer","author":{"name":"Ann","date":"d"}}}]' ;;
  "api repos/octo/repo/assignees?per_page=50") echo '["ann"]' ;;
  "label list") echo '[]' ;;
  "pr list") echo '[{"number":9,"title":"Speed up the lexer","state":"OPEN","isDraft":false,"url":"u9","author":{"login":"bob"},"headRefName":"fast","baseRefName":"main","updatedAt":"t","reviewDecision":"REVIEW_REQUIRED","labels":[],"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS"}]}]' ;;
  "pr view") echo '{"number":9,"title":"Speed up the lexer","state":"OPEN","isDraft":false,"url":"u9","author":{"login":"bob"},"headRefName":"fast","baseRefName":"main","updatedAt":"t","reviewDecision":"REVIEW_REQUIRED","labels":[],"statusCheckRollup":[{"name":"unit","status":"COMPLETED","conclusion":"SUCCESS"}],"body":"Caches token tables.","additions":10,"deletions":2,"changedFiles":1,"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","reviewRequests":[],"assignees":[],"reviews":[],"commits":[],"files":[{"path":"lexer.ts","additions":10,"deletions":2}],"comments":[]}' ;;
  "api graphql") if echo "$*" | grep -q resolveReviewThread; then exit 0; fi; echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[{"id":"PRRT_abc12345","isResolved":false,"isOutdated":false,"path":"lexer.ts","line":4,"comments":{"totalCount":1,"nodes":[{"author":{"login":"rev"},"body":"Use a Map here"}]}}]}}}}}' ;;
  "release list") echo '[]' ;;
  "pr comment"|"pr review"|"issue create") if echo "$*" | grep -q -- --body-file; then cat > "${dir}/stdin-$1-$2.txt"; fi; echo "https://github.com/octo/repo/x/1" ;;
  "api repos/octo/repo/dependabot/alerts?state=open&per_page=50") echo '[{"number":1,"html_url":"d","created_at":"2","security_advisory":{"summary":"Prototype pollution","severity":"high"},"dependency":{"package":{"name":"lodash","ecosystem":"npm"},"manifest_path":"package.json"}}]' ;;
  "api repos/octo/repo/code-scanning/alerts?state=open&per_page=50") echo "HTTP 404: no analysis found" >&2; exit 1 ;;
  "api repos/octo/repo/secret-scanning/alerts?state=open&per_page=50") echo '[]' ;;
  "api user") echo "me" ;;
  "api notifications?participating=true&per_page=30") echo '[]' ;;
  "search prs") if echo "$*" | grep -q review-requested; then echo '[{"number":7,"title":"Fix the parser","url":"u7","state":"OPEN","isDraft":false,"author":{"login":"you"},"updatedAt":"t","labels":[],"repository":{"nameWithOwner":"octo/repo"}}]'; else echo '[]'; fi ;;
  "search issues") echo '[]' ;;
  "issue list") echo '[{"number":3,"title":"Crash on startup","state":"OPEN","url":"u3","author":{"login":"ann"},"assignees":[],"labels":[],"comments":2,"updatedAt":"t"}]' ;;
  "issue view") echo '{"number":3,"title":"Crash on startup","state":"OPEN","url":"u3","author":{"login":"ann"},"assignees":[],"labels":[],"updatedAt":"t","body":"It crashes when the config is empty.","comments":[]}' ;;
  "run list") echo '[{"databaseId":11,"displayTitle":"CI build","workflowName":"ci","headBranch":"feat","event":"push","status":"completed","conclusion":"failure","url":"ru","createdAt":"t","updatedAt":"t"}]' ;;
  "run view") if echo "$*" | grep -q -- --log-failed; then echo "npm ERR! test failed at step 4"; else echo '{"databaseId":11,"displayTitle":"CI build","workflowName":"ci","headBranch":"feat","status":"completed","conclusion":"failure","jobs":[{"databaseId":5,"name":"unit-tests","status":"completed","conclusion":"failure","url":"j","steps":[{"name":"npm test","status":"completed","conclusion":"failure"}]}]}'; fi ;;
  "run rerun") exit 0 ;;
esac
`, { mode: 0o755 })
process.env.PATH = `${dir}:${process.env.PATH}`
process.chdir(dir)

const { testRender, act } = await import('./testRender')
const { getThemePalette } = await import('../theme')
const { GitHubPopover } = await import('../../plugins/github/tui/GitHubPopover')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '')
const settle = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms))

let handler: ((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null = null
const notices: string[] = []
const asked: string[] = []
const setup = await testRender(
  <GitHubPopover
    theme={getThemePalette('dark')}
    width={120}
    height={36}
    cwd={dir}
    docked
    onClose={() => notices.push('closed')}
    onNotice={(_tone, text) => notices.push(text)}
    onAskAgent={(prompt) => asked.push(prompt)}
    onKeyHandlerReady={(next) => { handler = next as typeof handler }}
  />,
  { width: 120, height: 36 },
)
// Waits without blocking the thread (the renderer drains on it) until `until`
// is on screen or the deadline passes; the caller's assertion reports a miss.
const press = async (sequence: string, name = sequence, until?: string) => {
  await act(async () => { handler!({ name, ctrl: false, shift: false, sequence }) })
  const deadline = Date.now() + 8000
  for (;;) {
    await act(async () => { await settle(100); await setup.flush() })
    const frame = setup.captureCharFrame()
    if (!until || frame.includes(until) || Date.now() > deadline) return frame
  }
}

const text = async (value: string) => { for (const ch of value) await press(ch, ch) }
const submit = () => press('\r', 'return')
const waitCall = async (needle: string) => { for (let i = 0; i < 60 && !calls().includes(needle); i += 1) await act(async () => { await settle(100); await setup.flush() }) }

// Overview is the landing tab.
let frame = await press('1', '1', 'Parser toolkit')
assert(frame.includes('1 Overview') && frame.includes('7 Security'), `the tab bar names all seven tabs:\n${frame}`)
assert(frame.includes('Tighten the lexer') && frame.includes('main'), `overview shows recent commits and branches:\n${frame}`)

frame = await press('2', '2', 'Fix the parser')
assert(frame.includes('Fix the parser'), `the inbox lists a review request:\n${frame}`)

// Pull requests: the detail follows the cursor in the split layout.
frame = await press('3', '3', 'Caches token tables.')
assert(frame.includes('Speed up the lexer') && frame.includes('Caches token tables.'), `the PR detail loads beside the list without enter:\n${frame}`)
assert(frame.includes('○ lexer.ts:4') && frame.includes('Use a Map here'), `an unresolved review thread is shown:\n${frame}`)
assert(frame.includes('mergeable'), 'merge state is visible')
await press('v')
assert((await press('x', 'x')).length > 0 && !calls().includes('pr review'), 'v asks first; any other key declines')
await press('v'); await press('y'); await waitCall('pr review 9 --approve')
assert(calls().includes('pr review 9 --approve'), 'y approves')
await press('c')
frame = await press('N', 'N')
assert(frame.includes('Comment on #9') && frame.includes('N'), `c opens a text box and typed keys land in it:\n${frame}`)
await text('LGTM')
await submit(); await waitCall('pr comment 9 --body-file -')
assert(calls().includes('pr comment 9 --body-file -') && fs.readFileSync(path.join(dir, 'stdin-pr-comment.txt'), 'utf8') === 'NLGTM', 'the typed text is sent over stdin')
await press('c'); await press('\u001b', 'escape')
assert(!(await press('f', 'f')).includes('Comment on #9'), 'escape cancels composing')
await press('r'); frame = await press('y', 'y')
await waitCall('resolveReviewThread')
assert(calls().includes('resolveReviewThread') && calls().includes('id=PRRT_abc12345'), 'r then y resolves the first unresolved thread')

// Issues: create through two text boxes.
frame = await press('4', '4', 'Crash on startup')
assert(frame.includes('Crash on startup'), `the issues tab lists issues:\n${frame}`)
frame = await press('\r', 'return', 'It crashes when the config is empty.')
assert(frame.includes('It crashes when the config is empty.'), `enter opens the issue body:\n${frame}`)
await press('a')
assert(asked.length === 1 && asked[0].includes('Work on issue #3') && asked[0].includes('config is empty'), 'a hands the issue to the agent with its body')
await press('n'); await text('Fix lexer'); await submit()
frame = await press('x', 'x')
assert(frame.includes('description'), `a second box asks for the description:\n${frame}`)
await text('details'); await submit(); await waitCall('issue create')
assert(calls().includes('issue create --title Fix lexer --body-file -') && fs.readFileSync(path.join(dir, 'stdin-issue-create.txt'), 'utf8') === 'xdetails', 'the issue is created with both texts')

// Actions.
frame = await press('5', '5', 'CI build')
assert(frame.includes('CI build'), `the actions tab lists runs:\n${frame}`)
frame = await press('\r', 'return', 'unit-tests')
assert(frame.includes('unit-tests') && frame.includes('npm test'), `a run shows its failed job and step:\n${frame}`)
frame = await press('l', 'l', 'npm ERR!')
assert(frame.includes('npm ERR! test failed at step 4'), `l shows the failed-step log:\n${frame}`)
frame = await press('r')
assert(frame.includes('Rerun failed jobs') && frame.includes('y/n'), `a rerun asks first:\n${frame}`)
await press('n')
assert(!calls().includes('run rerun'), 'anything but y declines, and nothing ran')
await press('r'); await press('y'); await waitCall('run rerun')
assert(calls().includes('run rerun 11 --failed'), 'y runs the rerun')

// Security: an off feature is said to be off.
frame = await press('7', '7', 'Prototype pollution')
assert(frame.includes('Prototype pollution'), `alerts are listed:\n${frame}`)

await press('\u001b', 'escape')
assert(notices.includes('closed'), 'escape with nothing open closes the popover')

fs.rmSync(dir, { recursive: true, force: true })
console.log('github popover smoke passed')
process.exit(0)
