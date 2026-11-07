/** @jsxImportSource @opentui/react */
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { EngineeringAction as Action } from './EngineeringAction'
import type { TuiThemePalette } from '../../theme'
import type { useEngineeringWorkbenchEditor } from './workbenchState'
import type { EngineeringWorkProps, WorkCheck } from './EngineeringWork'
import { formatWorkTimestamp, editTaskBrief, taskBriefMarkdown, type AcceptanceCriterion, type BriefField } from './workbenchModel'

export const FIELD_LABELS: Record<BriefField, string> = { title: 'Title', objective: 'Objective', criteria: 'Acceptance criteria', constraints: 'Constraints', questions: 'Open questions', decisions: 'Decisions' }
export type WorkButton = (id: string, label: string, run: () => void, selected?: boolean) => ReactNode
type Shared = { props: EngineeringWorkProps; button: WorkButton; sectionTitle: (text: string) => ReactNode; checks: (checks: WorkCheck[]) => ReactNode }

export function WorkBriefSection({ props, button, sectionTitle, checks, criterion, openEditor, runEditor, pinMessage, setCriterionId }: Shared & {
  criterion?: AcceptanceCriterion; openEditor: (field: BriefField) => void; runEditor: (id?: string, paths?: string[]) => void; pinMessage: () => void; setCriterionId: (id: string) => void
}) {
  const { brief, theme } = props
  return <>
        <text fg={theme.text}>{brief.title || 'Untitled task'}</text>
        {button('edit-title', 'Edit title', () => openEditor('title'))}
        {sectionTitle('Objective')}
        <text fg={brief.objective ? theme.text : theme.dim}>{brief.objective || 'What does done look like?'}</text>
        {button('edit-objective', 'Edit objective', () => openEditor('objective'))}
        {!brief.objective && props.goalObjective ? button('use-goal', 'Use current session goal', () => props.setBrief(previous => editTaskBrief(previous, 'objective', props.goalObjective!))) : null}
        {sectionTitle('Acceptance criteria')}
        {brief.criteria.map(item => button(`criterion:${item.id}`, `${item.id === criterion?.id ? '›' : ' '} [${item.review === 'accepted' ? 'x' : item.review === 'needs-work' ? '!' : ' '}] ${item.text}`, () => setCriterionId(item.id)))}
        {button('edit-criteria', brief.criteria.length ? 'Edit criteria' : 'Add criteria', () => openEditor('criteria'))}
        {criterion ? <>
          <text fg={theme.text} wrapMode="word">{criterion.text}</text>
          <text fg={theme.dim}>{`Review: ${criterion.review} · manual decision`}</text>
          <box flexDirection="row" flexWrap="wrap" flexShrink={0}>
            {(['accepted', 'needs-work', 'pending'] as const).map((review, index) => button(`review:${review}`, ['Accept', 'Needs work', 'Reset'][index]!, () => props.setBrief(previous => ({ ...previous, criteria: previous.criteria.map(item => item.id === criterion.id ? { ...item, review } : item), updatedAt: Date.now() }))))}
          </box>
          {button('criterion-check', 'Run a check for this criterion', () => runEditor(criterion.id))}
          {checks(props.checks.filter(item => item.check.criterionId === criterion.id))}
          {props.selectedMessage && props.currentSession ? <>
            <text fg={theme.dim}>{`Selected message: ${props.selectedMessage.compactSummary.slice(0, 160)}`}</text>
            {button('pin-message', 'Pin selected message as evidence', pinMessage)}
          </> : <text fg={theme.dim}>Select a transcript message to pin evidence.</text>}
          {brief.evidence.filter(item => item.criterionId === criterion.id).map(item => <box key={item.id} flexDirection="column" flexShrink={0}>
            {button(`pin:${item.id}`, `${item.session.title}: ${item.preview}`, () => props.onJump(item.session, item.cardKey))}
            <text fg={theme.text} wrapMode="word">{item.preview}</text>
            <text fg={theme.dim}>Transcript evidence · working state unknown</text>
            {item.files.map(path => button(`pin-file:${item.id}:${path}`, `Open file: ${path}`, () => props.onOpenFile(path)))}
            {button(`unpin:${item.id}`, 'Unpin evidence', () => props.setBrief(previous => ({ ...previous, evidence: previous.evidence.filter(pin => pin.id !== item.id), updatedAt: Date.now() })))}
          </box>)}
        </> : null}
        {(['constraints', 'questions', 'decisions'] as const).map(field => <box key={field} flexDirection="column" flexShrink={0}>
          {sectionTitle(FIELD_LABELS[field])}<text fg={brief[field] ? theme.text : theme.dim}>{brief[field] || 'None recorded.'}</text>
          {button(`edit-${field}`, `Edit ${FIELD_LABELS[field].toLowerCase()}`, () => openEditor(field))}
        </box>)}
        {sectionTitle('Linked sessions')}
        {props.currentSession ? button('link-session', 'Link current session', () => props.setBrief(previous => previous.sessions.some(session => session.key === props.currentSession!.key) ? previous : { ...previous, sessions: [...previous.sessions, props.currentSession!], updatedAt: Date.now() })) : null}
        {brief.sessions.map(session => <box key={session.key} flexDirection="column" flexShrink={0}>
          {button(`session:${session.key}`, `${session.provider ?? 'agent'} · ${session.title}`, () => props.onOpenSession(session.key))}
          {button(`unlink:${session.key}`, 'Unlink session', () => props.setBrief(previous => ({ ...previous, sessions: previous.sessions.filter(item => item.key !== session.key), updatedAt: Date.now() })))}
        </box>)}
        {button('copy', 'Copy brief', () => props.onCopy(taskBriefMarkdown(brief)))}
        {button('compose', 'Add brief to composer', () => props.onAppend(taskBriefMarkdown(brief)))}
  </>
}

export function WorkCatchupSection({ props, button, sectionTitle, checks, expanded, setExpanded }: Shared & { expanded: boolean; setExpanded: Dispatch<SetStateAction<boolean>> }) {
  const { theme } = props
  return <>
        <text fg={theme.cyan}>What changed while you were away?</text>
        <text fg={theme.dim}>{props.checkpoint ? `Since ${props.checkpoint.reviewed ? 'last reviewed' : 'first visit'} · ${formatWorkTimestamp(props.checkpoint.capturedAt)}` : 'Waiting for the first repository snapshot.'}</text>
        {props.delta.branchChanged ? <text fg={theme.amber}>{`Branch: ${props.checkpoint?.branch} → ${props.current?.branch}`}</text> : null}
        {!props.delta.count ? <text fg={theme.dim}>No new observations since this checkpoint.</text> : null}
        {props.delta.files.length ? sectionTitle('Changed files') : null}
        {props.delta.files.slice(0, expanded ? undefined : 8).map(item => item.change === 'no longer changed'
          ? <text key={item.path} fg={theme.dim}>{`${item.change}: ${item.path}`}</text>
          : button(`changed:${item.path}`, `${item.change}: ${item.path}`, () => props.onOpenFile(item.path)))}
        {props.delta.sessions.length ? sectionTitle('Session activity · loaded catalog') : null}
        {props.delta.sessions.slice(0, expanded ? undefined : 8).map(item => button(`observed:${item.key}`, `${item.change}: ${item.title}`, () => props.onOpenSession(item.key)))}
        {props.delta.checks.length ? sectionTitle('Validation updates') : null}
        {checks(props.checks.filter(item => props.delta.checks.includes(item.check.id)))}
        {sectionTitle(`Unresolved attention · ${props.attention.length}`)}
        {props.attention.map(item => button(`attention:${item.key}`, `${props.delta.attention.includes(item.key) ? 'New · ' : ''}${item.sessionTitle}: ${item.title}`, () => props.onAttention(item)))}
        {props.delta.files.length > 8 || props.delta.sessions.length > 8 ? button('expand', expanded ? 'Show less' : 'Show all observations', () => setExpanded(value => !value)) : null}
        {props.current ? button('reviewed', 'Mark observations reviewed', props.onAcknowledge) : null}
        <text fg={theme.dim}>Opening this view does not clear observations or acknowledge attention.</text>
  </>
}

export function WorkEvidenceSection({ props, button, sectionTitle, checks, expanded, setExpanded, runEditor }: Shared & { runEditor: (id?: string, paths?: string[]) => void; expanded: boolean; setExpanded: Dispatch<SetStateAction<boolean>> }) {
  const { theme } = props
  return <>
        {props.selectedMessageFiles.length ? sectionTitle('Files linked to the selected message') : null}
        {props.selectedMessageFiles.map(path => button(`message-file:${path}`, `Open file: ${path}`, () => props.onOpenFile(path)))}
        <text fg={theme.cyan}>{props.selectedFile || 'Choose a file to inspect its evidence'}</text>
        {props.selectedFile ? <>
          {button('open-diff', 'Open diff / source', () => props.onOpenFile(props.selectedFile!))}
          {button('file-check', 'Run a check linked to this file', () => runEditor(undefined, [props.selectedFile!]))}
          {sectionTitle('Recorded edits · loaded transcript')}
          {!(props.sources.get(props.selectedFile)?.length) ? <text fg={theme.dim}>No recorded edit links in this loaded transcript. Current hunk ownership is unknown.</text> : null}
          {(props.sources.get(props.selectedFile) ?? []).slice(expanded ? 0 : -5).map((item, index) => <box key={`${item.edit.key}:${index}`} flexDirection="column" flexShrink={0}>
            {item.request && props.currentSession ? button(`request:${index}`, `Request: ${item.request.compactSummary}`, () => props.onJump(props.currentSession!, item.request!.key)) : null}
            {props.currentSession ? button(`edit:${index}`, `Edit: ${item.edit.label}`, () => props.onJump(props.currentSession!, item.edit.key)) : null}
            {item.response && props.currentSession ? button(`response:${index}`, `Response: ${item.response.compactSummary}`, () => props.onJump(props.currentSession!, item.response!.key)) : null}
          </box>)}
          {(props.sources.get(props.selectedFile)?.length ?? 0) > 5 ? button('all-evidence', expanded ? 'Show recent evidence' : 'Show all recorded edits', () => setExpanded(value => !value)) : null}
          <text fg={theme.dim}>Turn adjacency is context, not proof of intent or ownership.</text>
          {sectionTitle('Recorded checks')}
          <text fg={theme.dim}>Linked and repository-wide checks; file coverage is not inferred.</text>
          {checks(props.checks.filter(item => !item.check.filePaths?.length || item.check.filePaths.includes(props.selectedFile!)))}
        </> : null}
        {sectionTitle('Files mentioned by recorded edits')}
        {[...props.sources.keys()].map(path => button(`file:${path}`, path, () => props.onChooseFile(path)))}
  </>
}

export function WorkEditorView({ edit, theme, focused }: { edit: ReturnType<typeof useEngineeringWorkbenchEditor>; theme: TuiThemePalette; focused: boolean }) {
  const editing = edit.editing!
  return <box flexGrow={1} minHeight={0} flexDirection="column">
    <text fg={theme.cyan}>{editing.field === 'command' ? 'Run a check' : `Edit ${FIELD_LABELS[editing.field]}`}</text>
    <text fg={theme.dim}>{editing.field === 'criteria' ? 'One criterion per line. Ctrl+S saves; Escape cancels.' : editing.field === 'command' ? 'Runs in this repository. Ctrl+S runs; Escape cancels.' : 'Ctrl+S saves; Escape cancels. Enter adds a line.'}</text>
    <textarea id="engineering-input:work-editor" ref={edit.editor} flexGrow={1} minHeight={3} focused={focused} initialValue={editing.value} wrapMode="word"
      onContentChange={() => { const value = edit.editor.current?.plainText ?? ''; edit.setEditing(previous => previous ? { ...previous, value } : previous) }} />
    <box flexShrink={0} flexDirection="row">
      <Action id="engineering-work:save" theme={theme} label={editing.field === 'command' ? 'Run check' : 'Save'} onPress={edit.save} />
      <Action id="engineering-work:cancel" theme={theme} label="Cancel" onPress={() => edit.setEditing(null)} />
    </box>
  </box>
}

export function renderWorkChecks({ items, selectedCheck, setSelectedCheck, button, props }: { items: WorkCheck[]; selectedCheck: string | null; setSelectedCheck: (id: string) => void; button: WorkButton; props: EngineeringWorkProps }) {
  return <>
    {!items.length ? <text fg={props.theme.dim}>No linked application-recorded checks.</text> : null}
    {items.map(({ check, verification }) => <box key={check.id} flexDirection="column" flexShrink={0}>
      {button(`check:${check.id}`, `${verification.state === 'stale' ? `STALE · was ${verification.result?.outcome ?? 'unknown'}` : verification.state} · ${check.command}`, () => setSelectedCheck(check.id))}
      {selectedCheck === check.id ? <>
        <text fg={props.theme.dim}>{`Working state ${check.fingerprint.slice(0, 12)} · ${verification.result ? formatWorkTimestamp(verification.result.completedAt) : 'No recorded completion'}`}</text>
        <text fg={props.theme.text}>{verification.result?.output.join('\n') || 'Output unavailable.'}</text>
        {button(`rerun:${check.id}`, 'Run again', () => props.onRunCheck(check.command, check.criterionId, check.filePaths))}
      </> : null}
    </box>)}
  </>
}
