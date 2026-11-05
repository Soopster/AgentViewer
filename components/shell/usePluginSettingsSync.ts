'use client'

// The saved plugin choice, loaded into the shared enablement store on page load.
import { useEffect } from 'react'
import { applyPluginSettings, decodePluginSettings } from '@/lib/plugins/enablement'
import { readJsonResponse } from '@/lib/httpResponse'

/** Loads the saved choice once; the manager and every host read the shared store. */
export function usePluginSettingsSync(): void {
  useEffect(() => {
    let live = true
    fetch('/api/plugins').then(response => readJsonResponse<unknown>(response)).then(
      (settings) => { if (live) applyPluginSettings(decodePluginSettings(settings)) },
      () => {},
    )
    return () => { live = false }
  }, [])
}
