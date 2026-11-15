import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InstalledSkill, SkillCopyPreview, SkillCopyReceipt, SkillsManagerService, SkillsSnapshot } from '../../lib/plugins/skillsManager'
type ScopedState = <T>(name: string, initial: T) => [T, (value: T | ((previous: T) => T)) => void]
export function useSkillsView(service: SkillsManagerService, cwd: string, scoped: ScopedState) {
  const owner = useMemo(() => ({ alive: true }), [service, cwd])
  const [captured, setCaptured] = useState<{ owner: object; value: SkillsSnapshot } | null>(null)
  const [activity, setActivity] = useState<object | null>(null), [notice, setNotice] = useState('')
  const useViewState = scoped
  const [query, setQuery] = useViewState('search', ''), [rootId, setRootId] = useViewState('root', '')
  const [skillId, setSkillId] = useViewState('skill', ''), [fileName, setFileName] = useViewState('file', 'SKILL.md')
  const [targetIds, setTargetIds] = useViewState<string[]>('targets', [])
  const [previewValue, setPreviewValue] = useState<{ key: string; value: SkillCopyPreview } | null>(null)
  const [replacement, setReplacement] = useState<{ id: string; roots: string[] } | null>(null)
  const [fileValue, setFileValue] = useState<{ key: string; value: string } | null>(null)
  const [receipt, setReceipt] = useState<SkillCopyReceipt | null>(null)
  const requests = useMemo(() => new Map<string, string>(), [owner]), lock = useRef<object | null>(null)
  useEffect(() => { owner.alive = true; return () => { owner.alive = false } }, [owner])
  const snapshot = captured?.owner === owner ? captured.value : null
  const skills = useMemo(() => snapshot?.skills.filter(skill => (!rootId || skill.rootId === rootId) && `${skill.name} ${skill.description} ${skill.key}`.toLowerCase().includes(query.toLowerCase())) ?? [], [snapshot, rootId, query])
  const skill: InstalledSkill | undefined = skills.find(item => item.id === skillId) ?? skills[0]
  const sourceRoot = snapshot?.roots.find(root => root.id === skill?.rootId)
  const targets = targetIds.filter(id => id !== skill?.rootId && snapshot?.roots.some(root => root.id === id))
  const selectionKey = JSON.stringify([cwd, skill?.id, targets.slice().sort()])
  const preview = previewValue?.key === selectionKey ? previewValue.value : null
  const replaceIds = replacement?.id === preview?.id ? replacement?.roots ?? [] : []
  const file = skill?.files.some(item => item.path === fileName) ? fileName : 'SKILL.md'
  const fileKey = JSON.stringify([cwd, skill?.id, skill?.hash, file])
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try { const value = await service.scan(cwd, signal); if (owner.alive && !signal?.aborted) setCaptured({ owner, value }) }
    catch (error) { if (owner.alive && !signal?.aborted) setNotice(error instanceof Error ? error.message : String(error)) }
  }, [service, cwd, owner])
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort() }, [refresh])
  useEffect(() => {
    if (!skill) return
    const controller = new AbortController()
    void service.file(cwd, skill.id, file, controller.signal).then(value => {
      if (!controller.signal.aborted && owner.alive) setFileValue({ key: fileKey, value: value.text + (value.truncated ? '\n\n[Preview truncated at 256 KiB]' : '') })
    }).catch(error => { if (!controller.signal.aborted && owner.alive) setFileValue({ key: fileKey, value: String(error) }) })
    return () => controller.abort()
  }, [service, cwd, skill?.id, skill?.hash, file, fileKey, owner])
  const action = async (run: () => Promise<void>) => {
    if (lock.current === owner) return
    lock.current = owner; setActivity(owner); setNotice('')
    try { await run() } catch (error) { if (owner.alive) setNotice(error instanceof Error ? error.message : String(error)) }
    finally { if (lock.current === owner) lock.current = null; setActivity(current => current === owner ? null : current) }
  }
  const prepare = () => action(async () => {
    if (!skill || !targets.length) throw new Error('Select a skill and at least one destination')
    const value = await service.preview(cwd, { sourceId: skill.id, targetIds: targets })
    if (owner.alive) { setPreviewValue({ key: selectionKey, value }); setReplacement(null) }
  })
  const apply = () => action(async () => {
    if (!preview || !canApply) throw new Error('Preview the copy and explicitly select any replacements first')
    const key = JSON.stringify([preview.id, replaceIds.slice().sort()])
    let requestId = requests.get(key)
    if (!requestId) { requestId = crypto.randomUUID(); requests.set(key, requestId) }
    const value = await service.apply(cwd, { sourceId: preview.sourceId, targetIds: preview.targets.map(target => target.rootId), previewId: preview.id, replaceIds, requestId })
    if (owner.alive) {
      setReceipt(value); setNotice(value.status === 'applied' ? 'Skills copied. Reload skills or start a new provider session to use the changes.' : `Copy ${value.status}. Inspect the receipt before retrying.`)
      if (value.status === 'applied') setPreviewValue(null)
      await refresh()
    }
  })
  const canApply = !!preview?.targets.length && preview.targets.every(target => target.status !== 'blocked' && (target.status !== 'replace' || replaceIds.includes(target.rootId)))
  return { snapshot, skills, skill, sourceRoot, query, setQuery, rootId, setRootId, setSkillId, file, setFileName, targetIds: targets, preview, replaceIds, receipt, notice, busy: activity === owner, fileText: fileValue?.key === fileKey ? fileValue.value : 'Loading resource…', canApply, refresh, prepare, apply,
    toggleTarget: (id: string) => setTargetIds(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]),
    toggleReplacement: (id: string) => { if (preview) setReplacement({ id: preview.id, roots: replaceIds.includes(id) ? replaceIds.filter(root => root !== id) : [...replaceIds, id] }) },
  }
}
export type SkillsViewState = ReturnType<typeof useSkillsView>
