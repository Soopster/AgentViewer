'use client'

import { useSyncExternalStore } from 'react'
import { LoaderCircle } from 'lucide-react'
import { getLoadingProviders, getServerLoadingProviders, providerLoadingLabel, subscribeLoadingProviders } from '@/lib/providerLoading'

export function ProviderLoadingToasts() {
  const providers = useSyncExternalStore(subscribeLoadingProviders, getLoadingProviders, getServerLoadingProviders)
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="pointer-events-none fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
      {providers.map(provider => (
        <div key={provider} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] shadow-lg">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          {providerLoadingLabel(provider)}
        </div>
      ))}
    </div>
  )
}
