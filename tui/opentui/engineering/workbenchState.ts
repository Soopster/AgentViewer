import { useEffect, useRef } from 'react'
import { useWorkspaceState } from '../workspaceContext'
import type { TextareaRenderable } from '@opentui/core'
import type { EngineeringWorkProps } from './EngineeringWork'
import { editTaskBrief, type BriefField, emptyTaskBrief, type TaskBrief, type WorkSnapshot } from './workbenchModel'

/** Shared across sessions/providers, isolated by workspace and repository. */
export function useEngineeringWorkbench(root: string, active: boolean, current: WorkSnapshot | null, ready: boolean) {
  const [brief, setBrief] = useWorkspaceState<TaskBrief>(`engineering:brief:${root}`, emptyTaskBrief)
  const [checkpoint, setCheckpoint] = useWorkspaceState<WorkSnapshot | null>(`engineering:checkpoint:${root}`, null)
  useEffect(() => {
    if (active && ready && current && !checkpoint) setCheckpoint(previous => previous ?? current)
  }, [active, ready, current, checkpoint, setCheckpoint])
  return { brief, setBrief, checkpoint, setCheckpoint }
}

export type WorkEditorState = { field: BriefField | 'command'; value: string; criterionId?: string; filePaths?: string[] }
export function useEngineeringWorkbenchEditor(props: Pick<EngineeringWorkProps, 'root' | 'brief' | 'setBrief' | 'onRunCheck'>) {
  const [editing, setEditing] = useWorkspaceState<WorkEditorState | null>(`engineering:brief-editor:${props.root}`, null, false)
  const editor = useRef<TextareaRenderable | null>(null)
  const openEditor = (field: BriefField) => setEditing({ field, value: field === 'criteria' ? props.brief.criteria.map(item => item.text).join('\n') : props.brief[field] })
  const runEditor = (criterionId?: string, filePaths?: string[]) => setEditing({ field: 'command', value: '', criterionId, filePaths })
  const save = () => {
    if (!editing) return
    const value = editor.current?.plainText ?? editing.value
    if (editing.field === 'command') {
      if (!value.trim()) return
      props.onRunCheck(value.trim(), editing.criterionId, editing.filePaths)
    } else props.setBrief(previous => editTaskBrief(previous, editing.field as BriefField, value))
    setEditing(null)
  }
  const handleKey = (key: { name: string; ctrl: boolean }): boolean | 'input' => {
    if (!editing) return false
    if (key.name === 'escape') { setEditing(null); return true }
    if (key.ctrl && key.name === 's') { save(); return true }
    return 'input'
  }
  return { editing, setEditing, editor, openEditor, runEditor, save, handleKey }
}
