import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { expandDiffContext, readDiffBaseLines, type DiffContextExpansion, type DiffContextGap } from './gitDiffContext'

const EMPTY_EXPANSIONS = new Map<string, DiffContextExpansion>()

/** Load omitted context on demand and discard completions from replaced comparisons. */
export function useGitDiffContext(cwd: string, scope: string) {
  const [state, setState] = useState({ scope, gaps: EMPTY_EXPANSIONS })
  const scopeRef = useRef(scope)
  const pending = useRef(new Map<string, AbortController>())
  useLayoutEffect(() => { scopeRef.current = scope }, [scope])
  useEffect(() => {
    const requests = pending.current
    return () => { for (const request of requests.values()) request.abort(); requests.clear() }
  }, [cwd, scope])
  const expansions = state.scope === scope ? state.gaps : EMPTY_EXPANSIONS
  const change = useCallback((gap: DiffContextGap, collapse = false) => {
    const previous = expansions.get(gap.id)
    pending.current.get(gap.id)?.abort()
    const update = (value: DiffContextExpansion) => {
      if (scopeRef.current !== scope) return
      setState(current => ({ scope, gaps: new Map(current.scope === scope ? current.gaps : EMPTY_EXPANSIONS).set(gap.id, value) }))
    }
    if (collapse || (previous?.total !== undefined && previous.count >= previous.total)) {
      update({ count: 0, total: previous?.total, lines: [] })
      return
    }
    const request = new AbortController()
    pending.current.set(gap.id, request)
    update({ count: previous?.count ?? 0, total: previous?.total, lines: previous?.lines ?? [], loading: true })
    void readDiffBaseLines(cwd, gap.baseOid, request.signal).then(lines => {
      if (!request.signal.aborted) update(expandDiffContext(gap, lines, previous?.count ?? 0))
    }).catch(() => {
      if (!request.signal.aborted) update({ count: previous?.count ?? 0, lines: previous?.lines ?? [], total: previous?.total, error: true })
    }).finally(() => { if (pending.current.get(gap.id) === request) pending.current.delete(gap.id) })
  }, [cwd, expansions, scope])
  return { expansions, change }
}
