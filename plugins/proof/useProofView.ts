import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProof } from '../../lib/plugins/useProof'
import { proofFixPrompt, proofFreshness, type ProofCheck, type ProofRun, type ProofService } from '../../lib/plugins/proof'
import { modAppStore } from '../../lib/plugins/modApp'
type ScopedState = <T>(name: string, initial: T) => [T, (next: T | ((previous: T) => T)) => void]
export function useProofView(service: ProofService, cwd: string, origin: ProofRun['origin'], insert: ((text: string) => void) | undefined, scoped: ScopedState) {
  const { snapshot, error, refresh } = useProof(service, cwd)
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const useViewState = scoped
  const [runId, setRunId] = useViewState<string | null>('run', null), [checkId, setCheckId] = useViewState<string | null>('check', null)
  const [captured, setCaptured] = useState<{ key: string; text: string } | null>(null), [all, setAll] = useViewState('all', false)
  const [selected, setSelected] = useViewState<string[]>('selected', [])
  const lifetime = useMemo(() => ({ alive: true }), [cwd, service])
  useEffect(() => { lifetime.alive = true; return () => { lifetime.alive = false } }, [lifetime])
  const run = snapshot?.runs.find(item => item.id === runId) ?? snapshot?.runs[0]
  const result = run?.results.find(item => item.check.id === checkId) ?? run?.results[0]
  useEffect(() => {
    if (!run || !result) return
    const controller = new AbortController()
    void service.output(cwd, run.id, result.check.id, controller.signal).then(text => { if (!controller.signal.aborted) setCaptured({ key: `${run.id}:${result.check.id}:${result.status}`, text }) }).catch(cause => { if (!controller.signal.aborted) setNotice(String(cause)) })
    return () => controller.abort()
  }, [service, cwd, run?.id, result?.check.id, result?.status])
  const action = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true); setNotice('')
    try { await fn(); if (lifetime.alive) await refresh(); return true } catch (cause) { if (lifetime.alive) setNotice(cause instanceof Error ? cause.message : String(cause)); return false }
    finally { setBusy(current => lifetime.alive ? false : current) }
  }, [refresh, lifetime])
  const configure = (checks: ProofCheck[]) => action(async () => {
    if (!snapshot) return
    await service.configure(cwd, checks, snapshot.config.version)
    if (lifetime.alive) setNotice('Checks saved. Select checks, then run them.')
  })
  const start = () => action(async () => {
    if (!snapshot) return
    const ids = selected.filter(id => snapshot.config.checks.some(check => check.id === id))
    const next = await service.start(cwd, ids, snapshot.config.version, origin)
    if (lifetime.alive) { setRunId(next.id); setCheckId(null) }
  })
  const outputKey = run && result ? `${run.id}:${result.check.id}:${result.status}` : ''
  const output = captured?.key === outputKey ? captured.text : ''
  const prepare = () => {
    if (!run || !result || !snapshot || !insert || !run.origin || !['failed', 'timeout', 'cancelled', 'interrupted'].includes(result.status)) return
    if (captured?.key !== outputKey) { setNotice('Wait for this check’s output to load.'); return }
    const source = run.origin
    // A repository-pinned window may outlive the session composer it opened beside.
    const app = modAppStore.getSnapshot(), current = app.sessions.find(session => session.key === app.selectedKey)
    if (!current || current.target.provider !== source.provider || current.target.sessionId !== source.sessionId || (current.target.providerInstanceId ?? '') !== (source.providerInstanceId ?? '')) { setNotice('Select the originating session before preparing its fix prompt.'); return }
    insert(proofFixPrompt(run, result, proofFreshness(result, snapshot), output)); setNotice('Fix prompt added to the composer; review before sending.')
  }
  return { snapshot, error, notice, busy, selected: selected.filter(id => snapshot?.config.checks.some(check => check.id === id)), setSelected, run, result, output, all, setAll, setRunId, setCheckId, refresh, configure, start, prepare,
    cancel: () => action(async () => { const active = snapshot?.runs.find(item => !item.finishedAt); if (active) await service.cancel(cwd, active.id) }),
    toggle: (id: string) => setSelected(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]),
  }
}

export type ProofViewState = ReturnType<typeof useProofView>
