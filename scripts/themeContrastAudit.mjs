// Theme contrast audit. Every theme's text tones are checked against that
// theme's own --surface, because that is what panels, cards and the sidebar
// actually paint text on.
//
// Dark themes carry higher floors than light ones on purpose. Dim grey-on-black
// is the readability failure this catches: --text-3 at the WCAG non-text
// minimum reads as decoration on a dark panel even though it technically
// passes, so on dark it must clear the body-text ratio instead.
import fs from 'node:fs'

const css = fs.readFileSync('app/globals.css', 'utf8')

// A theme's variables may be split across several selectors (shared blocks list
// many themes at once), so merge every declaration by theme name.
const themes = new Map()
for (const m of css.matchAll(/((?:\[data-theme="[^"]+"\][\s,]*)+)\{([^}]*)\}/g)) {
  const names = [...m[1].matchAll(/\[data-theme="([^"]+)"\]/g)].map((x) => x[1])
  const vars = {}
  for (const v of m[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[v[1]] = v[2].trim()
  for (const n of names) themes.set(n, { ...(themes.get(n) ?? {}), ...vars })
}
const root = css.match(/:root\s*\{([^}]*)\}/)
if (root) {
  const vars = {}
  for (const v of root[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[v[1]] = v[2].trim()
  themes.set('(:root default)', vars)
}

const hex = (c) => {
  const s = (c ?? '').trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
}
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const [x, y] = [lum(a) + 0.05, lum(b) + 0.05]; return Math.max(x, y) / Math.min(x, y) }

// --text is body prose. --text-2 carries secondary content (session previews,
// timestamps, ids, transcript metadata). --text-3 is decoration.
const FLOORS = {
  dark:  { text: 8.5, 'text-2': 7.0, 'text-3': 4.5 },
  light: { text: 7.0, 'text-2': 4.5, 'text-3': 3.0 },
}
const DARK_SURFACE_MAX_LUM = 0.18

const rows = []
for (const [name, v] of themes) {
  const surface = hex(v.surface)
  if (!surface) continue
  const mode = lum(surface) < DARK_SURFACE_MAX_LUM ? 'dark' : 'light'
  for (const key of ['text', 'text-2', 'text-3']) {
    const fg = hex(v[key])
    if (!fg) continue
    rows.push({ name, mode, key, on: ratio(fg, surface), floor: FLOORS[mode][key], fg: v[key], surface: v.surface })
  }
}

const fails = rows.filter((r) => r.on < r.floor).sort((a, b) => a.on / a.floor - b.on / b.floor)
const darkRows = rows.filter((r) => r.mode === 'dark')

console.log(`${themes.size} theme declarations, ${rows.length} pairs checked (${darkRows.length} dark)`)
console.log(`dark  floors: text ${FLOORS.dark.text}:1  text-2 ${FLOORS.dark['text-2']}:1  text-3 ${FLOORS.dark['text-3']}:1`)
console.log(`light floors: text ${FLOORS.light.text}:1  text-2 ${FLOORS.light['text-2']}:1  text-3 ${FLOORS.light['text-3']}:1\n`)
for (const r of fails) {
  console.log(`${r.on.toFixed(2).padStart(5)}:1 (need ${r.floor})  ${r.key.padEnd(7)} ${r.fg.padEnd(9)} on ${String(r.surface).padEnd(9)}  ${r.name} [${r.mode}]`)
}
if (fails.length) {
  console.log(`\nFAIL: ${fails.length} pair(s) below floor`)
  process.exit(1)
}
const min = (mode, key) => Math.min(...rows.filter((r) => r.mode === mode && r.key === key).map((r) => r.on))
console.log(`PASS — dark minimums: text ${min('dark','text').toFixed(2)}  text-2 ${min('dark','text-2').toFixed(2)}  text-3 ${min('dark','text-3').toFixed(2)}`)
