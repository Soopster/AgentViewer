import { createHash } from 'node:crypto'
import type { PendingPermission, PendingQuestionAnswers, PermissionResponse } from './permissions'

/** Bind confirmation to the full provider ask, including command/diff/questions. */
export function coordinatorPermissionToken(permission: PendingPermission): string {
  return createHash('sha256').update(JSON.stringify(permission)).digest('hex')
}

export type CoordinatorNativeAnswer = {
  permissionId?: string
  permissionToken?: string
  response?: PermissionResponse
  answers?: PendingQuestionAnswers
  permissionMode?: 'default' | 'acceptEdits'
}

export function validateCoordinatorNativeAnswer(permission: PendingPermission, answer: CoordinatorNativeAnswer): void {
  if (answer.response === 'reject') {
    if (answer.answers || answer.permissionMode) throw new Error('Declining a request cannot also submit answers or change mode')
    return
  }
  if (permission.questions?.length) {
    if (answer.response || answer.permissionMode || !answer.answers) throw new Error('Answer the provider questions before submitting')
    const known = new Set(permission.questions.map(question => question.id ?? question.question))
    if (Object.keys(answer.answers).some(key => !known.has(key))) throw new Error('The provider questions changed; inspect them again')
    for (const question of permission.questions) {
      const values = answer.answers[question.id ?? question.question] ?? []
      if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value.trim() || value.length > 8000)) throw new Error('Provide valid question answers')
      if (!values.length && question.required !== false) throw new Error('Answer every required provider question')
      if (!question.multiSelect && values.length > 1) throw new Error('Choose one answer for this question')
      if (!question.allowFreeform && values.some(value => !question.options.some(option => value === (option.value ?? option.label)))) throw new Error('Choose an offered provider answer')
    }
    return
  }
  if (answer.answers || !answer.response) throw new Error('Choose allow or reject')
  if (answer.response === 'always' && (permission.canApproveAlways === false || permission.toolName === 'ExitPlanMode')) throw new Error('This provider request cannot grant persistent approval')
  if (answer.permissionMode && permission.toolName !== 'ExitPlanMode') throw new Error('Only plan approval can change the continuation mode')
}
