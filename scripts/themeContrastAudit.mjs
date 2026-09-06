import fs from 'node:fs'
const css = fs.readFileSync('app/globals.css', 'utf8')

// Collect every theme block's variable map. A theme's vars may be split across
// several selectors (shared blocks list many themes), so merge by theme name.
const themes = new Map()
const re = /((?:\[data-theme="[^"]+"\][\s,]*)+)\{([^}]*)\}/g
let m
while ((m = re.exec(css))) {
  const names = [...m[1].matchAll(/\[data-theme="([^"]+)"\]/g)].map(x => x[1])
  const body = m[2]
  const vars = {}
  for (const v of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[v[1]] = v[2].trim()
  for (const n of names) themes.set(n, { ...(themes.get(n) ?? {}), ...vars })
}
// :root is the default (dark) theme
const root = css.match(/:root\s*\{([^}]*)\}/)
if (root) {
  const vars = {}
  for (const v of root[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[v[1]] = v[2].trim()
  themes.set('(:root default)', { ...vars, ...(themes.get('dark') ?? {}) })
}

const hex = (c) => {
  const s = c.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{3,8}$/.test(s)) return null
  const h = s.length === 3 ? s.split('').map(x => x + x).join('') : s.slice(0, 6)
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
}
const lum = (rgb) => {
  const [r, g, b] = rgb.map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const [x, y] = [lum(a) + 0.05, lum(b) + 0.05]; return (Math.max(x, y) / Math.min(x, y)) }

const rows = []
for (const [name, v] of themes) {
  const surface = hex(v.surface ?? '')
  for (const key of ['text-2', 'text-3']) {
    const fg = hex(v[key] ?? '')
    if (!fg || !surface) continue
    rows.push({ name, key, on: ratio(fg, surface), fg: v[key], surface: v.surface })
  }
}

// --text-2 carries secondary *content* (session previews, timestamps, ids,
// transcript metadata), so it is held to the 4.5:1 body-text ratio. --text-3 is
// decoration, but nothing in a UI is perceivable below the 3:1 non-text floor.
const FLOORS = { 'text-2': 4.5, 'text-3': 3.0 }
const fails = rows.filter((r) => r.on < FLOORS[r.key]).sort((a, b) => a.on - b.on)

console.log(`${themes.size} theme declarations, ${rows.length} pairs checked`)
console.log(`floors: --text-2 ${FLOORS['text-2']}:1 (content), --text-3 ${FLOORS['text-3']}:1 (non-text)\n`)
for (const r of fails) {
  console.log(`${r.on.toFixed(2).padStart(5)}:1  ${r.key.padEnd(7)} ${r.fg.padEnd(9)} on ${String(r.surface).padEnd(9)}  ${r.name}`)
}
if (fails.length) {
  console.log(`\nFAIL: ${fails.length} pair(s) below floor`)
  process.exit(1)
}
console.log('PASS: every theme meets both floors')
