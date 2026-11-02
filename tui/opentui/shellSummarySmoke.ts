import assert from 'node:assert/strict'
import { summarizeShellCommand as s } from './app/shellSummary'
assert.deepEqual(s("sed -n 2335,2355p tui/opentui/App.tsx; sed -n 420,435p tui/opentui/App.tsx; grep -n x y"), { verb: 'Read', detail: 'App.tsx:2335–2355 · 2 more' })
assert.deepEqual(s('grep -rn "borderStyle" tui plugins -r | sort | head'), { verb: 'Searched', detail: '"borderStyle"' })
assert.deepEqual(s('cat tui/opentui/app/borders.tsx | head -80; grep -rn "a;b" lib'), { verb: 'Read', detail: 'borders.tsx · 1 more' })
assert.deepEqual(s('ls scripts | grep -i borders; sed -n 1,30p tui/x.tsx'), { verb: 'Listed', detail: 'scripts · 1 more' })
// Anything that writes or is unknown stays raw.
for (const raw of ["cat > a.ts <<'EOF'\nx\nEOF", 'python3 - <<EOF\nx\nEOF', 'sed -i s/a/b/ f.ts', 'git stash -q && npx tsc', 'echo hi > out.txt', 'grep x y; rm -rf z', 'sed -n 1,2p f &', 'echo $(cat f)']) assert.equal(s(raw), null, raw)
console.log('shellSummarySmoke ok')
