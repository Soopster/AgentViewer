/** @jsxImportSource @opentui/react */
import { useImperativeHandle, useRef, useState, type Dispatch, type Ref, type SetStateAction } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../../theme'
import type { TuiTranscriptCard } from '../../format'
import type { ProtocolAgent, ProtocolRunSnapshot } from '../../../lib/agentProtocol'
import { EngineeringCoordination, type EngineeringCoordinationFeed } from './EngineeringCoordination'
import type { AttentionItem } from '../AttentionInboxPopover'
import { useWorkspaceState } from '../workspaceContext'
import { useEngineeringActions } from './useEngineeringActions'
import { useEngineeringWorkbenchEditor } from './workbenchState'
import { WorkEditorView, renderWorkChecks, WorkBriefSection, WorkCatchupSection, WorkEvidenceSection } from './EngineeringWorkSections'
import {
  pinTaskEvidence, type ChangeEvidence, type EngineeringCheck,
  type TaskBrief, type Verification, type WorkDelta, type WorkSession, type WorkSnapshot,
} from './workbenchModel'

export type WorkSection = 'brief' | 'catchup' | 'evidence' | 'agents'
type WorkKey = { name: string; sequence: string; ctrl: boolean; shift: boolean }
export type EngineeringWorkHandle = { handleKey: (key: WorkKey) => boolean | 'input' }
export type WorkCheck = { check: EngineeringCheck; verification: Verification }
export type EngineeringWorkProps = {
  root: string; width: number; height: number; theme: TuiThemePalette; focused: boolean; ready: boolean
  brief: TaskBrief; setBrief: Dispatch<SetStateAction<TaskBrief>>
  section: WorkSection; onSection: (section: WorkSection) => void
  checkpoint: WorkSnapshot | null; current: WorkSnapshot | null; delta: WorkDelta; onAcknowledge: () => void
  currentSession: WorkSession | null; selectedMessage: TuiTranscriptCard | null; selectedMessageFiles: string[]
  coordination?: ProtocolRunSnapshot | null
  coordinationFeed?: EngineeringCoordinationFeed
  onOpenCoordinator?: (runId?: string) => void
  onOpenCoordinatorAgent?: (agent: ProtocolAgent) => void
  composerContext?: string; selectedFile: string | null; sources: Map<string, ChangeEvidence[]>
  checks: WorkCheck[]; attention: AttentionItem[]
  onRunCheck: (command: string, criterionId?: string, filePaths?: string[]) => void
  onOpenFile: (path: string) => void; onChooseFile: (path: string) => void
  onOpenSession: (key: string) => void; onJump: (session: WorkSession, cardKey: string) => void
  onCopy: (text: string) => void; onAppend: (text: string) => void; onFocus: () => void
  onAttention: (item: AttentionItem) => void; handleRef?: Ref<EngineeringWorkHandle | null>
}
const SECTION_KEYS = { '1': 'brief', '2': 'catchup', '3': 'evidence', '4': 'agents' } as const

/** Shared task data stays mounted independently of native editor and pane focus. */
export function EngineeringWork(props: EngineeringWorkProps) {
  const { brief, theme, focused } = props
  const [criterionId, setCriterionId] = useWorkspaceState<string | null>(`engineering:criterion:${props.root}`, null, false)
  const [expanded, setExpanded] = useState(false)
  const [selectedCheck, setSelectedCheck] = useState<string | null>(null)
  const scroll = useRef<ScrollBoxRenderable | null>(null)
  const coordinationRef = useRef<EngineeringWorkHandle | null>(null)
  const edit = useEngineeringWorkbenchEditor(props)
  const actions = useEngineeringActions('engineering-work', theme, focused && !edit.editing, props.onFocus, scroll, `${props.section}:${edit.editing?.field ?? ''}`, Math.max(1, props.height - 2))
  const { button } = actions
  const criterion = brief.criteria.find(item => item.id === criterionId) ?? brief.criteria[0]
  useImperativeHandle(props.handleRef, () => ({ handleKey: key => {
    if (!focused) return false
    if (edit.editing) return edit.handleKey(key)
    const section = SECTION_KEYS[key.name as keyof typeof SECTION_KEYS]
    if (section && !key.ctrl) { props.onSection(section); return true }
    if (props.section === 'agents') return coordinationRef.current?.handleKey(key) ?? false
    return actions.handleKey(key)
  } }))
  const sectionTitle = (text: string) => <text fg={theme.cyan} marginTop={1}>{text}</text>
  const checks = (items: WorkCheck[]) => renderWorkChecks({ items, selectedCheck, setSelectedCheck, button, props })
  const pinMessage = () => props.setBrief(previous => pinTaskEvidence(previous, criterion?.id, props.currentSession, props.selectedMessage, props.selectedMessageFiles))
  if (!props.ready) return <text fg={theme.dim}>Loading workspace context…</text>
  if (edit.editing) return <WorkEditorView edit={edit} theme={theme} focused={focused} />
  return <box flexGrow={1} minHeight={0} flexDirection="column">
    <box flexShrink={0} flexDirection="row" flexWrap="wrap">
      {button('brief', 'Brief', () => { props.onSection('brief'); actions.setCursor(0) }, props.section === 'brief')}
      {button('catchup', `Catch up${props.delta.count ? ` +${props.delta.count}` : ''}`, () => { props.onSection('catchup'); actions.setCursor(1) }, props.section === 'catchup')}
      {button('evidence', 'Evidence', () => { props.onSection('evidence'); actions.setCursor(2) }, props.section === 'evidence')}
      {button('agents', 'Agents', () => { props.onSection('agents'); actions.setCursor(3) }, props.section === 'agents')}
    </box>
    <scrollbox id="engineering-work-body" ref={scroll} flexGrow={1} minHeight={0} scrollY>
      {props.section === 'brief' ? <WorkBriefSection props={props} button={button} sectionTitle={sectionTitle} checks={checks} criterion={criterion} openEditor={edit.openEditor} runEditor={edit.runEditor} pinMessage={pinMessage} setCriterionId={setCriterionId} />
        : props.section === 'catchup' ? <WorkCatchupSection props={props} button={button} sectionTitle={sectionTitle} checks={checks} expanded={expanded} setExpanded={setExpanded} />
        : props.section === 'agents' ? <EngineeringCoordination root={props.root} theme={theme} focused={focused} scrollRef={scroll} preferred={props.coordination} onFocus={props.onFocus} onOpenCoordinator={props.onOpenCoordinator} onOpenAgent={props.onOpenCoordinatorAgent} handleRef={coordinationRef} feed={props.coordinationFeed} />
        : <WorkEvidenceSection runEditor={edit.runEditor} props={props} button={button} sectionTitle={sectionTitle} checks={checks} expanded={expanded} setExpanded={setExpanded} />}
    </scrollbox>
  </box>
}
