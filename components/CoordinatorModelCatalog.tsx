'use client'
import { useState } from 'react'
import type { CoordinatorCapabilities } from '@/lib/coordinatorCapabilities'
import { Button } from './ui/button'
import { NativeSelect } from './ui/native-select'

export default function CoordinatorModelCatalog({ endpoint, model, effort, onModel, onEffort, disabled }: {
  endpoint: string; model: string; effort: string; onModel: (model: string) => void; onEffort: (effort: string) => void; disabled: boolean
}) {
  const [catalog, setCatalog] = useState<CoordinatorCapabilities | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function refresh() {
    setBusy(true); setError('')
    try {
      const response = await fetch(endpoint, { cache: 'no-store' })
      if (!response.ok) throw new Error('Could not read the provider catalog')
      setCatalog(await response.json())
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not read the provider catalog') }
    finally { setBusy(false) }
  }
  const selected = catalog?.models.find(entry => entry.value === model)
  return <div className="space-y-2">
    <Button variant="outline" size="sm" disabled={disabled || busy} onClick={() => void refresh()}>{busy ? 'Reading models…' : 'Refresh model catalog'}</Button>
    {error || catalog?.error ? <p role="status">{error || catalog?.error}</p> : null}
    {catalog?.status === 'unsupported' ? <p role="status">This provider does not expose a session-free catalog. Explicit IDs are checked by its dispatcher.</p> : null}
    {catalog?.status === 'available' ? <>
      <NativeSelect aria-label="Advertised task model" value={catalog.models.some(entry => entry.value === model) ? model : ''} disabled={disabled} onChange={event => { onModel(event.target.value); onEffort('') }}>
        <option value="">Team default</option>{catalog.models.map(entry => <option key={entry.value} value={entry.value}>{entry.displayName}</option>)}
      </NativeSelect>
      {selected?.supportedEffortLevels?.length ? <NativeSelect aria-label="Advertised task effort" value={selected.supportedEffortLevels.some(level => level === effort) ? effort : ''} disabled={disabled} onChange={event => onEffort(event.target.value)}>
        <option value="">Team default effort</option>{selected.supportedEffortLevels.map(effort => <option key={effort} value={effort}>{effort}</option>)}
      </NativeSelect> : null}
    </> : null}
  </div>
}
