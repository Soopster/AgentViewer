import type { CardBlock, CardTone } from '@/lib/plugins/cardBlocks'

const TONE_COLOR: Record<CardTone, string> = { default: 'var(--text-2)', muted: 'var(--text-3, var(--text-2))', success: 'var(--green, #3fb950)', warning: 'var(--amber, #d29922)', error: 'var(--red, #f85149)' }

/** The web drawing of a plugin card's blocks (lib/plugins/cardBlocks.ts); the TUI draws the same blocks as text lines. */
export function PluginCardBlocks({ blocks }: { blocks: readonly CardBlock[] }) {
  return <div data-card-blocks style={{ display: 'grid', gap: 4, marginTop: 4 }}>
    {blocks.map((block, index) => {
      if (block.type === 'heading') return <div key={index} style={{ fontWeight: 600, color: 'var(--text)' }}>{block.text}</div>
      if (block.type === 'text') return <div key={index} style={{ color: TONE_COLOR[block.tone ?? 'default'], whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{block.text}</div>
      if (block.type === 'badge') return <span key={index} style={{ justifySelf: 'start', fontSize: 11, padding: '1px 8px', borderRadius: 999, border: `1px solid ${TONE_COLOR[block.tone ?? 'default']}`, color: TONE_COLOR[block.tone ?? 'default'] }}>{block.text}</span>
      if (block.type === 'kv') return <dl key={index} style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '2px 12px', margin: 0 }}>{block.rows.map(([key, value], row) => [<dt key={`k${row}`} style={{ color: 'var(--text-3, var(--text-2))' }}>{key}</dt>, <dd key={`v${row}`} style={{ margin: 0, color: 'var(--text-2)', wordBreak: 'break-word' }}>{value}</dd>])}</dl>
      if (block.type === 'progress') return <label key={index} style={{ display: 'block', color: 'var(--text-2)' }}>{block.label} <progress aria-label={block.label} value={block.value} max={block.max} /> {Math.round(100 * block.value / block.max)}%</label>
      if (block.type === 'code') return <pre key={index} style={{ margin: 0, overflow: 'auto', maxHeight: 280, padding: 8, background: 'var(--surface-2)', fontSize: 11.5 }}><code data-language={block.language}>{block.text}</code></pre>
      return <div key={index} style={{ overflowX: 'auto' }}><table><thead><tr>{block.columns.map((column, c) => <th key={c} scope="col" style={{ textAlign: 'left', paddingRight: 16 }}>{column}</th>)}</tr></thead><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} style={{ paddingRight: 16 }}>{cell}</td>)}</tr>)}</tbody></table></div>
    })}
  </div>
}
