import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { blankMemory, memoryDraft, rankProjectMemory, type MemoryDraft, type ProjectMemorySnapshot, type ProjectMemoryService, type ProjectMemorySource, type MemoryOperation } from '../../lib/plugins/projectMemory'
type ScopedState = <T>(name: string, initial: T) => [T, (value: T | ((previous: T) => T)) => void]
export function useMemoryView(service: ProjectMemoryService, cwd: string, scoped: ScopedState) {
  const owner = useMemo(() => ({ alive: true }), [service, cwd]), fresh = useMemo(blankMemory, [])
  const [captured, setCaptured] = useState<{ owner: object; value: ProjectMemorySnapshot } | null>(null)
  const [activity, setActivity] = useState<object | null>(null), [notice, setNotice] = useState('')
  const lock = useRef<object | null>(null), useViewState = scoped
  const [selected, setSelected] = useViewState('selected', fresh.id), [drafts, setDrafts] = useViewState<Record<string, MemoryDraft>>('drafts', {}), [query, setQuery] = useViewState('search', '')
  const snapshot = captured?.owner === owner ? captured.value : null
  const note = snapshot?.notes.find(item => item.id === selected)
  const draft = drafts[selected] ?? (note ? memoryDraft(note) : { ...fresh, id: selected })
  const dirty = !note || JSON.stringify(draft) !== JSON.stringify(memoryDraft(note))
  const notes = useMemo(() => rankProjectMemory(snapshot?.notes ?? [], query), [snapshot, query])
  useEffect(() => { owner.alive = true; return () => { owner.alive = false } }, [owner])
  const refresh = useCallback(async (signal?: AbortSignal) => { try { const value = await service.read(cwd, signal); if (owner.alive && !signal?.aborted) setCaptured({ owner, value }) } catch (error) { if (owner.alive && !signal?.aborted) setNotice(String(error)) } }, [service, cwd, owner])
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort() }, [refresh])
  const action = async (operation: MemoryOperation) => {
    if (lock.current === owner) return false
    lock.current = owner; setActivity(owner); setNotice('')
    try {
      const value = await service.mutate(cwd, crypto.randomUUID(), operation)
      if (owner.alive) {
        setCaptured({ owner, value })
        const next = value.notes.find(item => item.id === selected)
        if (next && operation.type !== 'settings') setDrafts(previous => ({ ...previous, [next.id]: memoryDraft(next) }))
        if (operation.type === 'delete') { const blank = blankMemory(); setDrafts(previous => { const copy = { ...previous }; delete copy[selected]; return { ...copy, [blank.id]: blank } }); setSelected(blank.id) }
        setNotice(operation.type === 'save' ? 'Saved as a draft. Approve it before automatic recall.' : operation.type === 'review' ? operation.reviewed ? 'Note approved for recall.' : 'Note returned to draft.' : operation.type === 'settings' ? operation.autoRecall ? 'Automatic recall enabled for this project.' : 'Automatic recall disabled.' : 'Note deleted.')
      }
      return true
    } catch (error) { if (owner.alive) setNotice(error instanceof Error ? error.message : String(error)); return false }
    finally { if (lock.current === owner) lock.current = null; setActivity(current => current === owner ? null : current) }
  }
  const create = (body = '', source?: ProjectMemorySource) => { const value = { ...blankMemory(), title: body ? 'Captured session note' : '', body, source }; setDrafts(previous => ({ ...previous, [value.id]: value })); setSelected(value.id) }
  return { snapshot, note, notes, draft, dirty, query, setQuery, notice, busy: activity === owner, refresh, select: setSelected, create,
    edit: (patch: Partial<MemoryDraft>) => setDrafts(previous => ({ ...previous, [selected]: { ...draft, ...patch } })),
    save: () => action({ type: 'save', note: draft }),
    review: () => note && !dirty ? action({ type: 'review', id: note.id, expectedVersion: note.version, reviewed: !note.reviewed }) : Promise.resolve(false),
    remove: () => note ? action({ type: 'delete', id: note.id, expectedVersion: note.version }) : Promise.resolve(false),
    recall: () => snapshot ? action({ type: 'settings', expectedSequence: snapshot.sequence, autoRecall: !snapshot.autoRecall }) : Promise.resolve(false),
  }
}
export type MemoryViewState = ReturnType<typeof useMemoryView>
