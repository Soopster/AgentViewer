import assert from 'node:assert/strict'
import { fileEditStatsFromToolCalls, formatFileEditSummary, shellWrittenFiles } from '../../lib/turnEditStats'
const paths = (command: string) => shellWrittenFiles(command).map(stat => stat.path)
assert.deepEqual(paths("python3 - <<'EOF'\np='tui/opentui/App.tsx'\nopen(p,'w').write(open(p).read())\nEOF"), ['tui/opentui/App.tsx'])
assert.deepEqual(shellWrittenFiles("cat > tui/a.ts <<'EOF'\n1\n2\n3\nEOF"), [{ path: 'tui/a.ts', added: 3, removed: 0 }])
assert.deepEqual(paths("sed -i '1s/a/b/' tui/App.tsx && sed -i.bak s/x/y/ lib/a.ts"), ['tui/App.tsx', 'lib/a.ts'])
// Reads, pipes to /dev/null and checks write nothing.
for (const readOnly of ['grep -n x lib/a.ts | head; cat lib/b.ts', 'echo hi > /dev/null', 'npx tsc --noEmit 2>&1 | tail -3', "python3 -c \"print(open('lib/a.ts').read())\""]) assert.deepEqual(paths(readOnly), [], readOnly)
const stats = fileEditStatsFromToolCalls([
  { name: 'Bash', input: { command: 'sed -i s/a/b/ lib/a.ts' }, failed: false },
  { name: 'Bash', input: { command: 'sed -i s/a/b/ lib/failed.ts' }, failed: true },
])
assert.equal(formatFileEditSummary(stats), '1 file', 'unknown line counts are not invented')
console.log('shellEditStatsSmoke ok')
