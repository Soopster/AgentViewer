'use client'
import { useState } from 'react'
import type { ModViewBlock } from '@/lib/plugins/modViews'

type ExtraBlock = Exclude<ModViewBlock, { type: 'heading' | 'text' | 'item' | 'button' }>
export function PortableBlock({ block, busy, run }: { block: ExtraBlock; busy: boolean; run: (action: string, value?: string) => Promise<void> }) {
  const [value, setValue] = useState(block.type === 'input' || block.type === 'select' ? block.value ?? '' : '')
  if (block.type === 'progress') return <label style={{ display: 'block' }}>{block.label} <progress aria-label={block.label} value={block.value} max={block.max} /> {Math.round(100 * block.value / block.max)}%</label>
  if (block.type === 'code') return <pre style={{ overflow: 'auto', whiteSpace: 'pre', padding: 8, background: 'var(--surface-2)' }}><code data-language={block.language}>{block.text}</code></pre>
  if (block.type === 'table') return <div style={{ overflowX: 'auto' }}><table><thead><tr>{block.columns.map((column, index) => <th key={index} scope="col" style={{ textAlign: 'left', paddingRight: 16 }}>{column}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column} style={{ paddingRight: 16 }}>{cell}</td>)}</tr>)}</tbody></table></div>
  return <form onSubmit={event => { event.preventDefault(); if (!busy) void run(block.action, value) }} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{block.label}
      {block.type === 'input' ? <input aria-label={block.label} disabled={busy} maxLength={4000} value={value} placeholder={block.placeholder} onChange={event => setValue(event.target.value)} /> : <select aria-label={block.label} disabled={busy} value={value} onChange={event => setValue(event.target.value)}>{block.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}
    </label><button type="submit" disabled={busy}>Apply</button>
  </form>
}
