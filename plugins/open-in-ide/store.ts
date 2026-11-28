// Open in IDE's client half, one per renderer process: the cached choice and the
// file-open route that hands files to it. The picker and the route read one
// controller, so a choice made in the picker applies to the next click at once.
import { useSyncExternalStore } from 'react'
import { effectiveIde, setFileOpenRoute, type FileOpenRequest, type IdeState, type PluginIdeService } from '../../lib/plugins/openInIde'
import type { IdeId } from '../../lib/ideCatalog'

export type IdeController = ReturnType<typeof createIdeController>
export type IdeNotify = (text: string, urgent: boolean) => void

const shortPath = (file: string) => file.split(/[\\/]/).slice(-2).join('/')

export function createIdeController(service: PluginIdeService) {
  let state: IdeState | null = null
  let error: string | null = null
  let loading: Promise<void> | null = null
  const listeners = new Set<() => void>()
  let snapshot: { state: IdeState | null; error: string | null } = { state, error }
  const emit = () => { snapshot = { state, error }; for (const listener of listeners) listener() }

  function refresh(signal?: AbortSignal): Promise<void> {
    loading ??= service.read(signal)
      .then(next => { state = next; error = null })
      .catch(cause => { error = cause instanceof Error ? cause.message : String(cause) })
      .finally(() => { loading = null; emit() })
    return loading
  }

  async function choose(id: IdeId) {
    state = await service.setPreference(id)
    error = null
    emit()
  }

  async function open(request: FileOpenRequest, ide: IdeId, notify: IdeNotify | null) {
    if (ide === 'builtin') return
    const { label } = await service.open({ path: request.path, line: request.line ?? null, column: request.column ?? null, cwd: request.cwd ?? null, ide })
    notify?.(`Opened ${shortPath(request.path)}${request.line ? `:${request.line}` : ''} in ${label}`, false)
  }

  /** Installs the route for this renderer. The TUI keeps its own editor until a person chooses another. */
  function activate(renderer: 'web' | 'tui', notify: IdeNotify) {
    void refresh()
    const release = setFileOpenRoute((request, fallback) => {
      const decide = (): IdeId | null => effectiveIde(state, renderer)
      const known = state ? decide() : undefined
      if (renderer === 'tui' && (known === 'builtin' || known === null)) return false
      void (async () => {
        if (!state) await refresh()
        const ide = decide()
        if (ide === null || ide === 'builtin') {
          if (renderer === 'tui') fallback()
          else notify('No editor found on this machine to open files in — palette: "Open files in…"', true)
          return
        }
        try { await open(request, ide, notify) } catch (cause) {
          notify(cause instanceof Error ? cause.message : String(cause), true)
          // The terminal still has an editor of its own; the web has nowhere else to go.
          if (renderer === 'tui') fallback()
        }
      })()
      return true
    })
    return release
  }

  return {
    refresh, choose, activate,
    /** Opens `path` in the chosen editor now, whatever the route would do (the picker's test). */
    openWith: (request: FileOpenRequest, ide: IdeId) => open(request, ide, null),
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

const controllers = new WeakMap<PluginIdeService, IdeController>()
export function ideController(service: PluginIdeService): IdeController {
  let controller = controllers.get(service)
  if (!controller) { controller = createIdeController(service); controllers.set(service, controller) }
  return controller
}

export function useIde(controller: IdeController) {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
}
