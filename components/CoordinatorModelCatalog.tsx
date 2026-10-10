'use client'
import { useState } from 'react'
import type { CoordinatorCapabilities } from '@/lib/coordinatorCapabilities'
import { Button } from './ui/button'
import { NativeSelect } from './ui/native-select'

type SelectionProps = {
  model: string; effort: string; onModel: (model: string) => void; onEffort: (effort: string) => void; disabled: boolean
}
function CatalogAccount({ catalog, instanceId, onInstance, disabled }: {
  catalog: CoordinatorCapabilities | null; instanceId?: string; onInstance?: (instanceId: string) => void; disabled: boolean
}) {
  const accounts = catalog?.instances?.filter(instance => instance.provider === catalog.provider) ?? []
  if (!onInstance || accounts.length < 2) return null
  return <NativeSelect aria-label="Configured task account" value={instanceId ?? ''} disabled={disabled} onChange={event => onInstance(event.target.value)}>
    <option value="">Inherit lead account or provider default</option>{accounts.map(instance => <option key={instance.id} value={instance.id}>{instance.displayName} ({instance.id})</option>)}
  </NativeSelect>
}
function CatalogSelection({ catalog, model, effort, onModel, onEffort, disabled }: SelectionProps & { catalog: CoordinatorCapabilities }) {
  const selected = catalog.models.find(entry => entry.value === model)
  return <>
    <NativeSelect aria-label="Advertised task model" value={catalog.models.some(entry => entry.value === model) ? model : ''} disabled={disabled} onChange={event => { onModel(event.target.value); onEffort('') }}>
      <option value="">Team default</option>{catalog.models.map(entry => <option key={entry.value} value={entry.value}>{entry.displayName}</option>)}
    </NativeSelect>
    {selected?.supportedEffortLevels?.length ? <NativeSelect aria-label="Advertised task effort" value={selected.supportedEffortLevels.some(level => level === effort) ? effort : ''} disabled={disabled} onChange={event => onEffort(event.target.value)}>
      <option value="">Team default effort</option>{selected.supportedEffortLevels.map(effort => <option key={effort} value={effort}>{effort}</option>)}
    </NativeSelect> : null}
  </>
}
export default function CoordinatorModelCatalog({ endpoint, model, effort, onModel, onEffort, instanceId, onInstance, disabled }: SelectionProps & {
  endpoint: string; instanceId?: string; onInstance?: (instanceId: string) => void
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
  const statusError = error || catalog?.error
  return <div className="space-y-2">
    <Button variant="outline" size="sm" disabled={disabled || busy} onClick={() => void refresh()}>{busy ? 'Reading models…' : 'Refresh model catalog'}</Button>
    <CatalogAccount catalog={catalog} instanceId={instanceId} onInstance={onInstance} disabled={disabled} />
    {catalog?.providerInstanceId ? <p className="text-xs">Account / endpoint: {catalog.providerInstanceId}</p> : null}
    {statusError ? <p role="status">{statusError}</p> : null}
    {catalog?.status === 'unsupported' ? <p role="status">This provider does not expose a session-free catalog. Explicit IDs are checked by its dispatcher.</p> : null}
    {catalog?.status === 'available' ? <CatalogSelection catalog={catalog} model={model} effort={effort} onModel={onModel} onEffort={onEffort} disabled={disabled} /> : null}
  </div>
}
