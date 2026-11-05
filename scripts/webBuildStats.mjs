import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

// Inspect emitted initial scripts, not every lazy chunk in .next/static.
// This is a build-size baseline; browser transfers/hydration need browser traces.
const html = readFileSync('.next/server/app/index.html', 'utf8')
const scripts = new Map()
for (const match of html.matchAll(/<script\b[^>]*>/g)) {
  const tag = match[0]
  const src = tag.match(/\bsrc="([^"?]+)(?:\?[^"]*)?"/)?.[1]
  if (!src?.startsWith('/_next/')) continue
  const path = src.replace('/_next/', '.next/')
  const data = readFileSync(path)
  scripts.set(path, {
    path,
    legacyOnly: /\bnoModule\b|\bnomodule\b/.test(tag),
    bytes: data.length,
    gzipBytes: gzipSync(data).length,
  })
}
if (scripts.size === 0) throw new Error('No initial scripts found; run npm run build first')
const rows = [...scripts.values()].sort((a, b) => b.bytes - a.bytes)
const modern = rows.filter(row => !row.legacyOnly)
console.log(JSON.stringify({
  workload: 'production-initial-script-size',
  scripts: rows,
  modern: {
    count: modern.length,
    bytes: modern.reduce((sum, row) => sum + row.bytes, 0),
    gzipBytes: modern.reduce((sum, row) => sum + row.gzipBytes, 0),
  },
}, null, 2))
