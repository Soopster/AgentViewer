// The compactor must paint exactly the cells the original stream paints. A wrong elision fails
// silently (a colour, an attribute or a cursor position off by one), so this replays randomized
// frames, split at arbitrary byte boundaries, through a reference emulator and compares every cell.
import { createAnsiCompactor } from './ansiCompact'

const ROWS = 8
const COLS = 30
type Cell = string
function emulate(stream: string): Cell[] {
  const cells: Cell[] = Array(ROWS * COLS).fill(' |||')
  let row = 1, col = 1
  let fg = '', bg = '', attrs = new Set<string>()
  const state = () => `${fg}|${bg}|${[...attrs].sort().join(',')}`
  for (let i = 0; i < stream.length;) {
    if (stream[i] === '\x1b' && stream[i + 1] === '[') {
      let end = i + 2
      while (!/[@-~]/.test(stream[end]!)) end++
      const body = stream.slice(i + 2, end), final = stream[end]
      i = end + 1
      if (final === 'H') { const [r, c] = body.split(';').map(Number); row = r!; col = c! }
      else if (final === 'm') {
        const p = body === '' ? ['0'] : body.split(';')
        for (let k = 0; k < p.length; k++) {
          const n = p[k]!.includes(':') ? NaN : Number(p[k])
          if (Number.isNaN(n)) { attrs.add(p[k]!); continue }
          if (n === 0) { fg = ''; bg = ''; attrs = new Set() }
          else if (n === 38 || n === 48) { const len = p[k + 1] === '2' ? 5 : 3; const v = p.slice(k, k + len).join(';'); if (n === 38) fg = v; else bg = v; k += len - 1 }
          else if (n === 39) fg = ''
          else if (n === 49) bg = ''
          else if (n === 22) { attrs.delete('1'); attrs.delete('2') }
          else if (n === 24) { attrs.delete('4'); attrs.delete('4:3') }
          else if (n === 23) attrs.delete('3')
          else if (n === 27) attrs.delete('7')
          else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) fg = String(n)
          else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) bg = String(n)
          else attrs.add(String(n))
        }
      }
      continue
    }
    if (row >= 1 && row <= ROWS && col >= 1 && col <= COLS) cells[(row - 1) * COLS + col - 1] = `${stream[i]}${state()}`
    col++
    i++
  }
  return cells
}

let seed = 12345
const rand = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n }
const pick = <T,>(items: T[]) => items[rand(items.length)]!
const COLORS = ['38;2;10;20;30', '38;2;200;100;0', '31', '92', '48;2;5;5;5', '48;2;9;9;9', '44', '38;5;123']
const ATTRS = ['1', '4', '3', '7', '22', '24', '1;4', '4:3', '39', '49']

function randomFrame(): string {
  let out = '\x1b[?2026h'
  for (let n = 5 + rand(30); n > 0; n--) {
    // Half the runs continue exactly where the previous ended, as the renderer's do.
    if (rand(2) === 0) out += `\x1b[${1 + rand(ROWS)};${1 + rand(COLS - 4)}H`
    const style = [pick(COLORS), pick(COLORS), rand(3) === 0 ? pick(ATTRS) : ''].filter(Boolean)
    out += `\x1b[${style.join(';')}m`
    out += pick(['ab', 'x', 'hello', '│─', ' ', '██', 'é'])
    if (rand(2) === 0) out += '\x1b[0m'
    if (rand(10) === 0) out += '\x1b[2K'
  }
  return out + '\x1b[0m\x1b[?2026l'
}

let bytesIn = 0, bytesOut = 0
for (let trial = 0; trial < 400; trial++) {
  const source = Array.from({ length: 1 + rand(4) }, randomFrame).join('')
  const compactor = createAnsiCompactor()
  let compacted = ''
  for (let i = 0; i < source.length;) { const n = 1 + rand(9); compacted += compactor.write(source.slice(i, i + n)); i += n }
  const a = emulate(source), b = emulate(compacted)
  for (let k = 0; k < a.length; k++) {
    if (a[k] !== b[k]) throw new Error(`trial ${trial}: cell ${k} differs: ${JSON.stringify(a[k])} vs ${JSON.stringify(b[k])}\nsource: ${JSON.stringify(source)}\ncompacted: ${JSON.stringify(compacted)}`)
  }
  bytesIn += source.length
  bytesOut += compacted.length
}
if (bytesOut >= bytesIn) throw new Error(`no saving: ${bytesIn} -> ${bytesOut}`)
console.log(`ansiCompactSmoke ok: 400 randomized streams identical, ${bytesIn} -> ${bytesOut} chars`)
