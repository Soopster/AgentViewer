import assert from 'node:assert/strict'
import { summarizeShellCommand as s } from './app/shellSummary'
assert.deepEqual(s("sed -n 2335,2355p tui/opentui/App.tsx; sed -n 420,435p tui/opentui/App.tsx; grep -n x y"), { verb: 'Read', detail: 'App.tsx:2335–2355 · 2 more' })
assert.deepEqual(s('grep -rn "borderStyle" tui plugins -r | sort | head'), { verb: 'Searched', detail: '"borderStyle"' })
assert.deepEqual(s('cat tui/opentui/app/borders.tsx | head -80; grep -rn "a;b" lib'), { verb: 'Read', detail: 'borders.tsx · 1 more' })
assert.deepEqual(s('ls scripts | grep -i borders; sed -n 1,30p tui/x.tsx'), { verb: 'Listed', detail: 'scripts · 1 more' })
// Visible file writes read as edits; anything unknown or unrecognised stays raw.
assert.deepEqual(s("cat > a.ts <<'EOF'\nx\nEOF"), { verb: 'Edited', detail: 'a.ts' })
assert.deepEqual(s('sed -i s/a/b/ f.ts'), { verb: 'Edited', detail: 'f.ts' })
assert.deepEqual(s('echo hi > out.txt'), { verb: 'Edited', detail: 'out.txt' })
for (const raw of ['python3 - <<EOF\nx\nEOF', 'git stash -q && npx tsc', 'grep x y; rm -rf z', 'sed -n 1,2p f &', 'echo $(cat f)']) assert.equal(s(raw), null, raw)
// Row text is `$ command`, cut to width with `…`; the complete statements still summarize.
assert.deepEqual(s('$ grep -n "\'session-fleet\'" -A12 tui/App.tsx | head -30; sed -n 2558,2600p tui/App.tsx; grep -n "export type PersistedSessionRecord" -A22 lib/ses…'), { verb: 'Searched', detail: '"\'session-fleet\'" · 2 more' })
// A cut script that shows no write call is not guessed to be an edit.
assert.equal(s("$ python3 - <<'EOF' p='plugins/x/Popover.tsx' s=open(p).read() old=s[s.index(…"), null)
assert.deepEqual(s("python3 - <<'EOF'\np='plugins/x/Popover.tsx'\nopen(p,'w').write(open(p).read())\nEOF"), { verb: 'Edited', detail: 'Popover.tsx' })
assert.deepEqual(s('tail -12 /private/tmp/claude-501/tasks/b1.output'), { verb: 'Read', detail: 'b1.output' })
console.log('shellSummarySmoke ok')
