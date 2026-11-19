import { useEffect, useMemo, useRef, useState } from 'react'
import type { PluginPlaybookService } from '../../lib/plugins/playbooks'
import { WORKFLOW_PACKS, parseWorkflowPack, inspectWorkflowPack, installWorkflowPack, type WorkflowPackRow } from '../../lib/plugins/workflowPacks'
type ScopedState = <T>(name: string, initial: T) => [T, (value: T | ((previous: T) => T)) => void]
export function useWorkflowPacks(service: PluginPlaybookService, cwd: string, scoped: ScopedState) {
  const useViewState = scoped, [selected, setSelected] = useViewState('pack', WORKFLOW_PACKS[0].id), [json, setJson] = useViewState('import', '')
  const [inspection, setInspection] = useState<{ key: string; rows: WorkflowPackRow[] } | null>(null), [notice, setNotice] = useState(''), [activity, setActivity] = useState<object | null>(null)
  const owner = useMemo(() => ({ alive: true, controller: new AbortController() }), [service, cwd]), lock = useRef<object | null>(null)
  useEffect(() => { owner.alive = true; if (owner.controller.signal.aborted) owner.controller = new AbortController(); return () => { owner.alive = false; owner.controller.abort() } }, [owner])
  const parsed = useMemo(() => { try { return { pack: selected === 'import' ? parseWorkflowPack(json) : WORKFLOW_PACKS.find(item => item.id === selected)!, error: '' } } catch (error) { return { pack: null, error: error instanceof Error ? error.message : String(error) } } }, [selected, json])
  const pack = parsed.pack, key = JSON.stringify([cwd, selected, selected === 'import' ? json : pack?.version]), rows = inspection?.key === key ? inspection.rows : null
  const action = async (run: () => Promise<void>) => { if (lock.current === owner) return; lock.current = owner; setActivity(owner); setNotice(''); try { await run() } catch (error) { if (owner.alive) setNotice(String(error)) } finally { if (lock.current === owner) lock.current = null; setActivity(value => value === owner ? null : value) } }
  return { pack, selected, setSelected, json, setJson, rows, notice: notice || parsed.error, busy: activity === owner,
    preview: () => action(async () => { if (!pack) return; const value = await inspectWorkflowPack(service, cwd, pack, owner.controller.signal); if (owner.alive) setInspection({ key, rows: value }) }),
    install: () => action(async () => { if (!pack || !rows) throw new Error('Preview the pack before installing'); const result = await installWorkflowPack(service, cwd, pack, owner.controller.signal); if (owner.alive) { setNotice(`Installed ${result.installed.length}; kept ${result.skipped.length} existing workflows.${result.errors.length ? ` ${result.errors.join('; ')}` : ''}`); setInspection({ key, rows: await inspectWorkflowPack(service, cwd, pack, owner.controller.signal) }) } }),
  }
}
