import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InstructionContent, InstructionPreview, InstructionReceipt, InstructionsManagerService, InstructionsSnapshot } from '../../lib/plugins/instructionsManager'
type ScopedState = <T>(name: string, initial: T) => [T, (value: T | ((previous: T) => T)) => void]
type Draft = { text: string; hash: string | null }
export type InstructionsTab = 'read' | 'edit' | 'copy' | 'preview' | 'history'
export function useInstructionsView(service: InstructionsManagerService, cwd: string, scoped: ScopedState) {
  const useViewState = scoped
  const [selected, setSelected] = useViewState('file', ''), [query, setQuery] = useViewState('query', ''), [scope, setScope] = useViewState('scope', 'all')
  const [drafts, setDrafts] = useViewState<Record<string, Draft>>('drafts', {}), [tab, setTab] = useViewState<InstructionsTab>('tab', 'read'), [destination, setDestination] = useViewState('destination', '')
  const owner = useMemo(() => ({ alive: true, controller: new AbortController() }), [cwd, service])
  const [inventory, setInventory] = useState<{ owner: object; value: InstructionsSnapshot } | null>(null)
  const [loaded, setLoaded] = useState<{ owner: object; value: InstructionContent } | null>(null)
  const [prepared, setPrepared] = useState<{ owner: object; value: InstructionPreview; requestId: string } | null>(null)
  const [receipt, setReceipt] = useState<InstructionReceipt | null>(null), [notice, setNotice] = useState(''), [replace, setReplace] = useState(false), [activity, setActivity] = useState<object | null>(null)
  const lock = useRef<object | null>(null)
  const snapshot = inventory?.owner === owner ? inventory.value : null
  const content = loaded?.owner === owner && loaded.value.file.path === selected ? loaded.value : null
  const draft = drafts[selected] ?? (content ? { text: content.text, hash: content.hash } : null)
  const preview = prepared?.owner === owner ? prepared.value : null
  const files = useMemo(() => snapshot?.files.filter(file => (scope === 'all' || file.scope === scope) && `${file.path} ${file.consumers.join(' ')}`.toLowerCase().includes(query.toLowerCase())) ?? [], [snapshot, scope, query])
  useEffect(() => { owner.alive = true; if (owner.controller.signal.aborted) owner.controller = new AbortController(); return () => { owner.alive = false; owner.controller.abort() } }, [owner])
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try { const value = await service.scan(cwd, signal); if (!owner.alive || signal?.aborted) return; setInventory({ owner, value }); setSelected(previous => previous || value.files.find(file => file.exists)?.path || value.files[0]?.path || '') }
    catch (error) { if (owner.alive && !signal?.aborted) setNotice(String(error)) }
  }, [service, cwd, owner, setSelected])
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort() }, [refresh])
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    void service.read(cwd, selected, controller.signal).then(value => { if (owner.alive && !controller.signal.aborted) { setLoaded({ owner, value }); setSelected(previous => previous === selected ? value.file.path : previous) } }).catch(error => { if (owner.alive && !controller.signal.aborted) { setLoaded(null); setNotice(String(error)) } })
    return () => controller.abort()
  }, [selected, service, cwd, owner])
  const action = async (run: () => Promise<void>) => {
    if (lock.current === owner) return
    lock.current = owner; setActivity(owner); setNotice('')
    try { await run() } catch (error) { if (owner.alive) setNotice(error instanceof Error ? error.message : String(error)) }
    finally { if (lock.current === owner) lock.current = null; setActivity(previous => previous === owner ? null : previous) }
  }
  const select = (file: string) => { setSelected(file); setPrepared(null); setReplace(false); setNotice(''); setTab('read') }
  const edit = (text: string) => { if (!draft) return; setDrafts(previous => ({ ...previous, [selected]: { ...draft, text } })); setPrepared(null); setReplace(false) }
  return {
    snapshot, content, draft, files, selected, select, query, setQuery, scope, setScope, tab, setTab, destination, setDestination: (path: string) => { setDestination(path); setPrepared(null); setReplace(false) },
    preview, receipt, notice, replace, setReplace, busy: activity === owner, dirty: !!draft && !!content && draft.text !== content.text,
    refresh: () => action(async () => { await refresh(owner.controller.signal); const value = selected ? await service.read(cwd, selected, owner.controller.signal) : null; if (owner.alive && value) { setLoaded({ owner, value }); setNotice(drafts[selected] ? 'Refreshed disk state. Your draft and its original version are preserved; use Reload editor to discard it.' : 'Instructions refreshed.') } }),
    reload: () => { setDrafts(previous => { const next = { ...previous }; delete next[selected]; return next }); setPrepared(null); setReplace(false) },
    edit, newRule: (path: string) => { select(path); setTab('edit') },
    prepare: (copy: boolean) => action(async () => {
      if (!content || !draft) throw new Error('Wait for the selected instruction file to load')
      if (copy && (!content.hash || draft.text !== content.text)) throw new Error('Save or reload the editor before copying the on-disk source')
      const target = copy ? await service.read(cwd, destination, owner.controller.signal) : content
      const value = await service.preview(cwd, { path: target.file.path, text: copy ? content.text : draft.text, expectedHash: copy ? target.hash : draft.hash, ...(copy ? { source: { path: content.file.path, hash: content.hash! } } : {}) }, owner.controller.signal)
      if (owner.alive) { setPrepared({ owner, value, requestId: crypto.randomUUID() }); setReplace(false); setTab('preview') }
    }),
    apply: () => action(async () => {
      if (!preview || !prepared) throw new Error('Preview the change before applying')
      const result = await service.apply(cwd, prepared.requestId, preview.hash, preview.change, replace, owner.controller.signal)
      if (!owner.alive) return
      setReceipt(result); setPrepared(null); setReplace(false)
      if (!preview.change.source) setDrafts(previous => { const next = { ...previous }; delete next[preview.file.path]; return next })
      await refresh(owner.controller.signal)
      const value = await service.read(cwd, selected, owner.controller.signal)
      if (owner.alive) { setLoaded({ owner, value }); setNotice(`${result.status}: ${result.path}${result.backup ? ` · Backup: ${result.backup}` : ''}`); setTab('history') }
    }),
  }
}
export type InstructionsViewState = ReturnType<typeof useInstructionsView>
