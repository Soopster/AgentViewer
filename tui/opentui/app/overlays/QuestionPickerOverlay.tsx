/** @jsxImportSource @opentui/react */
import type { PendingQuestion } from '../../../../lib/permissions'
import type { TuiThemePalette } from '../../../theme'
import { openExternalUrl } from '../../terminalBrowser'
import { formatProviderLabel } from '../../../format'
import { fitText } from '../../textLayout'
import { permissionMcpServerLabel, permissionOptionsFor, type PendingPermission, type PermissionOption } from '../../../../lib/permissions'
import { join } from 'node:path'

export function QuestionPickerOverlay({ pendingPermissions, width, questionPickerPlan, questionFocusIndex, theme, questionSelections, questionOptionIndex, questionFreeformAnswers, questionFreeformEditing, permissionActionLoading, permissionOptionIndex, resolvePermissionOptionIndex }: {
  pendingPermissions: PendingPermission[]
  width: number
  questionPickerPlan: { questions: PendingQuestion[]; focusIndex: number; collapsed: boolean; optionStart: number; optionCount: number; previewLines: string[]; rows: number; } | null
  questionFocusIndex: number
  theme: TuiThemePalette
  questionSelections: Record<number, string[]>
  questionOptionIndex: number
  questionFreeformAnswers: Record<number, string>
  questionFreeformEditing: boolean
  permissionActionLoading: string | null
  permissionOptionIndex: number
  resolvePermissionOptionIndex: (permission: PendingPermission, options: PermissionOption[]) => number
}) {
  return (
    pendingPermissions.length > 0 && (pendingPermissions[0]!.questions?.length ?? 0) > 0 ? (() => {
        const permission = pendingPermissions[0]!
        const questions = permission.questions ?? []
        const innerWidth = Math.max(width - 8, 20)
        // Same plan the height reservation used, so the card is drawn at the
        // size the layout actually gave it.
        const { collapsed, optionStart, optionCount, previewLines } = questionPickerPlan
          ?? { collapsed: false, optionStart: 0, optionCount: Number.MAX_SAFE_INTEGER, previewLines: [] as string[] }
        const focusIndex = questionPickerPlan?.focusIndex ?? Math.min(questionFocusIndex, questions.length - 1)
        const focusedQuestion = questions[focusIndex]
        const focusedTotalOptions = (focusedQuestion?.options.length ?? 0) + (focusedQuestion?.allowFreeform ? 1 : 0)
        return (
          <box id="permission-prompt" backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
            <box borderStyle="single" borderColor={theme.violet ?? theme.amber} backgroundColor={theme.surface} flexDirection="column" paddingX={1}>
              <text fg={theme.violet ?? theme.amber} wrapMode="none">
                {fitText(questions.length === 1
                  ? `● ${formatProviderLabel(permission.provider ?? 'claude')} asks`
                  : `● ${formatProviderLabel(permission.provider ?? 'claude')} asks · ${questions.length} questions`, innerWidth)}
              </text>
              {questions.map((q, qi) => {
                const focused = qi === focusIndex
                const selected = questionSelections[qi] ?? []
                // When the picker cannot fit, only the focused question shows
                // its options — the others keep a row so ←/→ still reaches
                // them, with their answer summarised inline.
                const showOptions = !collapsed || focused
                // The freeform row is one more selectable option, so the
                // cursor index must be clamped against the TOTAL. Clamping
                // each branch against q.options.length separately drew a
                // cursor on the last option AND on "Other" whenever "Other"
                // was selected.
                const totalOptions = q.options.length + (q.allowFreeform ? 1 : 0)
                const cursorIndex = Math.min(questionOptionIndex, Math.max(totalOptions - 1, 0))
                const answered = selected.length > 0
                  ? ` — ${selected.join(', ')}`
                  : questionFreeformAnswers[qi] ? ` — ${questionFreeformAnswers[qi]}` : ''
                return (
                  <box key={`q:${qi}`} flexDirection="column" marginTop={qi === 0 || collapsed ? 0 : 1}>
                    <text fg={focused ? theme.text : theme.dim} wrapMode="none">
                      {fitText(`${questions.length > 1 ? `${focused ? '▶ ' : '  '}` : ''}${q.header ? `[${q.header}] ` : ''}${q.question}${q.multiSelect ? ' (multi)' : ''}${showOptions ? '' : answered}`, innerWidth)}
                    </text>
                    {q.externalUrl ? (
                      <text fg={theme.cyan} wrapMode="none" onMouseDown={() => { void openExternalUrl(q.externalUrl!) }}>
                        {fitText(`  o open form in browser: ${q.externalUrl}`, innerWidth)}
                      </text>
                    ) : null}
                    {showOptions ? q.options.map((opt, oi) => {
                      if (collapsed && (oi < optionStart || oi >= optionStart + optionCount)) return null
                      const isSelected = selected.includes(opt.value ?? opt.label)
                      const isCursor = focused && oi === cursorIndex
                      const marker = isSelected ? (q.multiSelect ? '☑' : '●') : (q.multiSelect ? '☐' : '○')
                      const color = isCursor ? (theme.violet ?? theme.cyan) : isSelected ? theme.green : theme.dim
                      return (
                        <text key={`q:${qi}:o:${oi}`} fg={color} wrapMode="none">
                          {fitText(`  ${isCursor ? '▶' : ' '} ${marker} [${oi + 1}] ${opt.label}`, innerWidth)}
                        </text>
                      )
                    }) : null}
                    {q.allowFreeform && showOptions
                      && (!collapsed || (q.options.length >= optionStart && q.options.length < optionStart + optionCount))
                      ? (() => {
                      const oi = q.options.length
                      const value = questionFreeformAnswers[qi] ?? ''
                      const displayValue = q.secret && value ? '•'.repeat(Math.min(value.length, 24)) : value
                      const isCursor = focused && oi === cursorIndex
                      const isEditing = focused && isCursor && questionFreeformEditing
                      return (
                        <text key={`q:${qi}:other`} fg={isEditing ? theme.green : isCursor ? (theme.violet ?? theme.cyan) : value ? theme.green : theme.dim} wrapMode="none">
                          {fitText(`  ${isCursor ? '▶' : ' '} ${value ? '●' : '○'} [${oi + 1}] Other${displayValue ? `: ${displayValue}` : ''}${isEditing ? ' █' : ''}`, innerWidth)}
                        </text>
                      )
                    })() : null}
                    {/* The cursor option's preview. Drawn from the plan's own
                        array, never re-derived here: the plan reserved exactly
                        these rows, and a render that computed its own would be
                        free to disagree and overflow the card. */}
                    {focused && showOptions && previewLines.length > 0 ? (
                      <box flexDirection="column">
                        <text fg={theme.dim} wrapMode="none">
                          {fitText(`    ┄ ${q.options[cursorIndex]?.label ?? 'preview'}`, innerWidth)}
                        </text>
                        {previewLines.map((line, li) => (
                          <text key={`q:${qi}:p:${li}`} fg={theme.muted} wrapMode="none">
                            {fitText(`    ${line}`, innerWidth)}
                          </text>
                        ))}
                      </box>
                    ) : null}
                  </box>
                )
              })}
              <text fg={theme.dim} wrapMode="none">
                {permissionActionLoading
                  ? 'submitting…'
                  : questionFreeformEditing
                  ? fitText('type custom answer · enter finish · esc cancel editing', innerWidth)
                  : fitText(`${collapsed ? `${Math.min(questionOptionIndex, Math.max(focusedTotalOptions - 1, 0)) + 1}/${focusedTotalOptions} · ` : ''}↑/↓ option${questions.length > 1 ? ' · ←/→ question' : ''} · space/number select · enter submit · esc skip`, innerWidth)}
              </text>
            </box>
          </box>
        )
      })() : pendingPermissions.length > 0 && pendingPermissions[0]!.toolName === 'ExitPlanMode' ? (() => {
        const permission = pendingPermissions[0]!
        const innerWidth = Math.max(width - 8, 20)
        const planLines = permission.plan ? permission.plan.split('\n').slice(0, 16) : []
        const planOptions = [
          { decision: 'reject' as const, label: 'keep planning' },
          { decision: 'default' as const, label: 'approve · ask per tool' },
          { decision: 'acceptEdits' as const, label: 'approve · auto-accept edits' },
        ]
        const idx = Math.min(permissionOptionIndex, planOptions.length - 1)
        return (
          <box id="permission-prompt" backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
            <box borderStyle="single" borderColor={theme.green} backgroundColor={theme.surface} flexDirection="column" paddingX={1}>
              <text fg={theme.green} wrapMode="none">{fitText('● Claude finished planning', innerWidth)}</text>
              {planLines.map((planLine, index) => (
                <text key={`plan:${index}`} fg={theme.text} wrapMode="none">{fitText(planLine || ' ', innerWidth)}</text>
              ))}
              {permission.plan && permission.plan.split('\n').length > planLines.length ? (
                <text fg={theme.dim} wrapMode="none">{fitText('  … (plan truncated)', innerWidth)}</text>
              ) : null}
              {permission.allowedPrompts && permission.allowedPrompts.length > 0 ? (
                <text fg={theme.dim} wrapMode="none">{fitText(`allows: ${permission.allowedPrompts.join(' · ')}`, innerWidth)}</text>
              ) : null}
              <box flexDirection="row" gap={2} marginTop={1} height={1}>
                {planOptions.map((option, index) => {
                  const selected = index === idx
                  const color = option.decision === 'reject' ? theme.amber : theme.green
                  return (
                    <text key={option.decision} fg={selected ? color : theme.dim} wrapMode="none">
                      {`${selected ? '▶' : ' '} [${index + 1}] ${option.label}`}
                    </text>
                  )
                })}
              </box>
              <text fg={theme.dim} wrapMode="none">
                {fitText(permissionActionLoading ? 'responding…' : '←/→ select · enter confirm · 1/2/3 quick · esc keep planning', innerWidth)}
              </text>
            </box>
          </box>
        )
      })() : pendingPermissions.length > 0 ? (() => {
        const permission = pendingPermissions[0]!
        const options = permissionOptionsFor(permission)
        const selectedIndex = resolvePermissionOptionIndex(permission, options)
        const innerWidth = Math.max(width - 8, 20)
        const diffLines = permission.diff ? permission.diff.split('\n').slice(0, 12) : []
        return (
          <box id="permission-prompt" backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
            <box borderStyle="single" borderColor={theme.amber} backgroundColor={theme.surface} flexDirection="column" paddingX={1}>
              <text fg={theme.amber} wrapMode="none">{fitText(`● ${permission.title}`, innerWidth)}</text>
              {permissionMcpServerLabel(permission) ? (
                <text fg={permission.mcpServer?.source === 'sdk' ? theme.muted : theme.cyan} wrapMode="none">
                  {fitText(permissionMcpServerLabel(permission)!, innerWidth)}
                </text>
              ) : null}
              {permission.reason ? (
                <text fg={theme.dim} wrapMode="word">{permission.reason}</text>
              ) : null}
              {permission.command ? (
                permission.command.split('\n').slice(0, 12).map((line, index) => (
                  <text key={`perm-cmd:${index}`} fg={theme.text} wrapMode="none">
                    {fitText(index === 0 ? `$ ${line}` : line, innerWidth)}
                  </text>
                ))
              ) : null}
              {permission.url ? (
                <text fg={theme.cyan} wrapMode="none">{fitText(`URL: ${permission.url}`, innerWidth)}</text>
              ) : null}
              {permission.paths && permission.paths.length > 0 ? (
                <text fg={theme.dim} wrapMode="none">{fitText(permission.paths.join(', '), innerWidth)}</text>
              ) : null}
              {diffLines.map((line, index) => (
                <text
                  key={`perm-diff:${index}`}
                  fg={line.startsWith('+') ? theme.green : line.startsWith('-') ? theme.red : theme.dim}
                  wrapMode="none"
                >
                  {fitText(line || ' ', innerWidth)}
                </text>
              ))}
              <box flexDirection="row" gap={2} marginTop={1} height={1}>
                {options.map((option, index) => {
                  const selected = index === selectedIndex
                  const color = option.response === 'reject' ? theme.red : theme.green
                  return (
                    <text key={option.response} fg={selected ? color : theme.dim} wrapMode="none">
                      {`${selected ? '▶' : ' '} [${index + 1}] ${option.label}`}
                    </text>
                  )
                })}
              </box>
              <text fg={theme.dim} wrapMode="none">
                {fitText(permissionActionLoading ? 'responding…' : '←/→ select · enter confirm · 1/2/3 quick', innerWidth)}
              </text>
            </box>
          </box>
        )
      })() : null
  )
}
