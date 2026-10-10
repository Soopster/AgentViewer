/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { randomUUID } from 'node:crypto'
import type { PendingPermission, PendingQuestion, PendingQuestionAnswers, PermissionResponse } from '../../lib/permissions'
import { defaultPermissionOptionIndex, permissionMcpServerLabel, permissionOptionsFor } from '../../lib/permissions'
import { coordinatorPermissionToken, validateCoordinatorNativeAnswer, type CoordinatorNativeAnswer } from '../../lib/coordinatorNativePermission'
import type { TuiSessionCoordinationRequest } from '../../lib/tui/service'
import type { TuiThemePalette } from '../theme'
import { fitText } from './textLayout'
import { MODAL_CONTENT_Z_INDEX } from './layers'

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }
const EMPTY_QUESTIONS: NonNullable<PendingPermission['questions']> = []
type Props = {
  permission: PendingPermission; machineName: string; agentName: string; theme: TuiThemePalette; width: number; height: number
  disabledReason: string | null; onClose: () => void
  onSubmit: (request: TuiSessionCoordinationRequest) => Promise<void>
  onKeyHandlerReady: (handler: (key: Key) => void) => void
}

function wrapped(lines: string[], width: number): string[] {
  return lines.flatMap(line => line.split('\n').flatMap(part => {
    const result: string[] = []
    while (part.length > width) {
      const space = part.lastIndexOf(' ', width)
      const end = space > 0 ? space : width
      result.push(part.slice(0, end)); part = part.slice(end).trimStart()
    }
    return [...result, part || ' ']
  }))
}

type NativeOption = { response: PermissionResponse; label: string; permissionMode?: 'default' | 'acceptEdits' }
type NativeKeyContext = Pick<Props, 'permission' | 'disabledReason' | 'onClose' | 'onSubmit'> & {
  editing: boolean; confirmation: CoordinatorNativeAnswer | null; question: PendingQuestion | undefined
  text: string; answers: PendingQuestionAnswers; optionIndex: number; options: NativeOption[]
  questions: PendingQuestion[]; top: number; rows: number; lineCount: number
  setEditing: Dispatch<SetStateAction<boolean>>; setConfirmation: Dispatch<SetStateAction<CoordinatorNativeAnswer | null>>
  setText: Dispatch<SetStateAction<string>>; setAnswers: Dispatch<SetStateAction<PendingQuestionAnswers>>
  setOptionIndex: Dispatch<SetStateAction<number>>; setQuestionIndex: Dispatch<SetStateAction<number>>
  setOffset: Dispatch<SetStateAction<number>>; setError: Dispatch<SetStateAction<string>>
}

function handleNativeRequestKey(context: NativeKeyContext, key: Key): void {
  const { permission, disabledReason, onClose, onSubmit, editing, confirmation, question, text, answers, optionIndex,
    options, questions, top, rows, lineCount, setEditing, setConfirmation, setText, setAnswers, setOptionIndex,
    setQuestionIndex, setOffset, setError } = context
    if (key.name === 'escape') {
      if (editing) setEditing(false); else if (confirmation) setConfirmation(null); else onClose()
      return
    }
    if (!editing && key.name === 'pagedown') { setOffset(Math.min(top + rows, Math.max(0, lineCount - rows))); return }
    if (!editing && key.name === 'pageup') { setOffset(Math.max(0, top - rows)); return }
    if (disabledReason) return
    if (confirmation) {
      if (key.name === 'y') void onSubmit({ action: 'native-answer', detail: 'Operator answered the inspected provider request', permissionId: permission.id, permissionToken: coordinatorPermissionToken(permission), ...confirmation, requestId: randomUUID() })
      return
    }
    if (editing && question) {
      if (key.name === 'return') {
        const value = text.trim()
        if (value) setAnswers(previous => ({ ...previous, [question.id ?? question.question]: question.multiSelect ? [...(previous[question.id ?? question.question] ?? []), value] : [value] }))
        setEditing(false); return
      }
      if (key.name === 'backspace') setText(previous => Array.from(previous).slice(0, -1).join(''))
      else if (key.name === 'paste') setText(previous => (previous + key.sequence.replace(/\r\n?/g, '\n')).slice(0, 8000))
      else if (!key.ctrl && Array.from(key.sequence).length === 1 && key.sequence >= ' ') setText(previous => (previous + key.sequence).slice(0, 8000))
      return
    }
    if (question) {
      if (key.name === 'tab') { setQuestionIndex(index => (index + 1) % questions.length); setOptionIndex(0); setOffset(0) }
      if (key.name === 'up' || key.name === 'k') setOptionIndex(index => Math.max(0, index - 1))
      if (key.name === 'down' || key.name === 'j') setOptionIndex(index => Math.min(Math.max(0, question.options.length - 1), index + 1))
      if (key.name === 'space') {
        const option = question.options[optionIndex]
        if (option) {
          const value = option.value ?? option.label
          setAnswers(previous => {
            const selected = previous[question.id ?? question.question] ?? []
            return { ...previous, [question.id ?? question.question]: question.multiSelect ? selected.includes(value) ? selected.filter(entry => entry !== value) : [...selected, value] : [value] }
          })
        }
      }
      if (key.name === 'e' && question.allowFreeform) { setText(''); setEditing(true) }
    } else {
      if (key.name === 'left') setOptionIndex(index => Math.max(0, index - 1))
      if (key.name === 'right') setOptionIndex(index => Math.min(options.length - 1, index + 1))
      if (key.name === 'j' || key.name === 'down') setOffset(Math.min(top + 1, Math.max(0, lineCount - rows)))
      if (key.name === 'k' || key.name === 'up') setOffset(Math.max(0, top - 1))
    }
    if (key.name === 'return') {
      const option = options[optionIndex]!
      const answer: CoordinatorNativeAnswer = question ? { answers } : { response: option.response, ...(option.permissionMode ? { permissionMode: option.permissionMode } : {}) }
      try { validateCoordinatorNativeAnswer(permission, answer); setConfirmation(answer); setOffset(0); setError('') }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    }
}

function nativeRequestOptions(permission: PendingPermission): NativeOption[] {
  return permission.toolName === 'ExitPlanMode' ? [
    { response: 'reject' as const, label: 'Keep planning' },
    { response: 'once' as const, label: 'Approve · ask per tool', permissionMode: 'default' as const },
    { response: 'once' as const, label: 'Approve · auto-accept edits', permissionMode: 'acceptEdits' as const },
  ] : permissionOptionsFor(permission).map(option => ({ ...option, label: permission.elicitation?.mode === 'url' && option.response === 'once' ? 'Continue after opening URL' : option.label, permissionMode: undefined }))
}

function nativeRequestContext(permission: PendingPermission, question: PendingQuestion | undefined, questions: PendingQuestion[], confirmation: CoordinatorNativeAnswer | null, optionIndex: number, answers: PendingQuestionAnswers, inner: number): string[] {
  return wrapped([
    ...(confirmation?.answers ? questions.map(entry => {
      const values = confirmation.answers![entry.id ?? entry.question] ?? []
      return `${entry.header ?? entry.question}: ${entry.secret ? values.length ? '[hidden answer]' : '(skipped)' : values.join(', ') || '(skipped)'}`
    }) : []),
    permission.title, permissionMcpServerLabel(permission) ?? '',
    permission.reason ?? permission.detail ?? '', permission.command ? `$ ${permission.command}` : '',
    permission.paths?.join(', ') ?? '', permission.url ? `URL: ${permission.url}` : '',
    permission.diff ?? '', permission.plan ?? '', permission.allowedPrompts?.join('\n') ?? '',
    ...(question ? [question.question, ...question.options.map((option, index) => `${index === optionIndex ? '>' : ' '} ${(answers[question.id ?? question.question] ?? []).includes(option.value ?? option.label) ? '[x]' : '[ ]'} ${option.label}${option.description ? ` · ${option.description}` : ''}${option.preview ? `\n${option.preview}` : ''}`), question.allowFreeform ? 'e: custom answer' : '', `Selected: ${question.secret ? answers[question.id ?? question.question]?.length ? '[hidden answer]' : '(none)' : (answers[question.id ?? question.question] ?? []).join(', ') || '(none)'}`] : []),
  ].filter(Boolean), inner)
}

function nativeRequestControls({ question, questionIndex, questions, options, optionIndex, disabledReason, error, confirmation, editing, text }: Pick<NativeKeyContext, 'question' | 'questions' | 'options' | 'optionIndex' | 'disabledReason' | 'confirmation' | 'editing' | 'text'> & { questionIndex: number; error: string }) {
  const choices = question ? `${questionIndex + 1}/${questions.length} > ${question.options[optionIndex]?.label ?? 'Custom answer'}` : `${optionIndex + 1}/${options.length} > ${options[optionIndex]?.label}`
  const status = disabledReason || error || (confirmation ? `Confirm ${confirmation.answers ? 'answers' : options[optionIndex]?.label}? y sends · Esc back` : editing ? `Custom: ${question?.secret ? '•'.repeat(Math.min(24, text.length)) : text}▏` : 'Enter review decision · Esc back')
  return {
    choices, status, blocked: Boolean(disabledReason || error),
    navigation: question ? '↑/↓ option · Space select · Tab question' : '←/→ decision · j/k scroll · PgUp/PgDn',
    footer: confirmation ? 'y confirm · PgUp/PgDn · Esc back' : question ? 'e custom · PgUp/PgDn · Esc back' : 'Enter then y confirm · Esc back',
  }
}

/** Frozen ask: refresh may disable it, but cannot silently change its decision. */
export function RemoteNativeRequest({ permission, machineName, agentName, theme, width, height, disabledReason, onClose, onSubmit, onKeyHandlerReady }: Props) {
  const inner = Math.max(12, width - 6)
  const rows = Math.max(2, height - 12)
  const questions = permission.questions ?? EMPTY_QUESTIONS
  const options = useMemo(() => nativeRequestOptions(permission), [permission])
  const [optionIndex, setOptionIndex] = useState(() => questions.length ? 0 : defaultPermissionOptionIndex(permission, options))
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<PendingQuestionAnswers>({})
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [offset, setOffset] = useState(0)
  const [confirmation, setConfirmation] = useState<CoordinatorNativeAnswer | null>(null)
  const [error, setError] = useState('')
  const question = questions[questionIndex]
  const context = useMemo(() => nativeRequestContext(permission, question, questions, confirmation, optionIndex, answers, inner), [permission, question, questions, confirmation, optionIndex, answers, inner])
  const top = Math.min(offset, Math.max(0, context.length - rows))
  const handleKey = useCallback((key: Key) => handleNativeRequestKey({
    permission, disabledReason, onClose, onSubmit, editing, confirmation, question, text, answers, optionIndex,
    options, questions, top, rows, lineCount: context.length, setEditing, setConfirmation, setText, setAnswers,
    setOptionIndex, setQuestionIndex, setOffset, setError,
  }, key), [answers, confirmation, context.length, disabledReason, editing, onClose, onSubmit, optionIndex, options, permission, question, questions, rows, text, top])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])
  const controls = nativeRequestControls({ question, questionIndex, questions, options, optionIndex, disabledReason, error, confirmation, editing, text })
  return <box position="absolute" top={1} left={1} zIndex={MODAL_CONTENT_Z_INDEX} width={Math.max(20, width - 2)} height={Math.max(12, height - 2)} border borderColor={theme.amber} backgroundColor={theme.surface} paddingX={1} flexDirection="column">
    <text fg={theme.cyan} wrapMode="none">{fitText(`NATIVE REQUEST · ${machineName}`, inner)}</text>
    <text fg={theme.dim} wrapMode="none">{fitText(`${agentName} · ${permission.provider} · ${permission.id}`, inner)}</text>
    <box height={rows} flexDirection="column">{context.slice(top, top + rows).map((line, index) => <text key={top + index} fg={theme.text} wrapMode="none">{line}</text>)}</box>
    <text fg={theme.amber} wrapMode="none">{fitText(controls.choices, inner)}</text>
    <text fg={controls.blocked ? theme.red : theme.cyan} wrapMode="none">{fitText(controls.status, inner)}</text>
    <text fg={theme.dim} wrapMode="none">{fitText(controls.navigation, inner)}</text>
    <text fg={theme.dim} wrapMode="none">{fitText(controls.footer, inner)}</text>
  </box>
}
