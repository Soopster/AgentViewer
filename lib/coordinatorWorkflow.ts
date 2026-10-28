import type { InteractiveWorkflowPreview } from './agentCoordination'

/** Plain text supports {{args}}; JSON supports named {{args.key}} parameters. */
export function workflowArguments(text: string): unknown {
  const value = text.trim()
  if (!value) return undefined
  if (value.startsWith('{') || value.startsWith('[')) return JSON.parse(value)
  return value
}

export function workflowPreviewLines(preview: InteractiveWorkflowPreview): string[] {
  const recipe = preview.playbook
  return [
    `/${recipe.name} · ${preview.tasks.length} tasks · capacity ${preview.maxAgents} including this chat`,
    'Task IDs below are relative to this recipe; saved history shifts their numbers on the board.',
    `Reusable workers (${preview.providers.join(', ') || 'lead only'}). Your conversation stays lead.`,
    `Plan approval: ${recipe.requirePlanApproval ? 'required' : 'off'} · result review: ${recipe.requireReview ? 'required' : 'off'} · autonomy: ${recipe.autonomy ?? 'medium'}`,
    `Verification gate: ${recipe.gateCommand ?? 'none'}`,
    `Acceptance: ${recipe.acceptanceContract ? JSON.stringify(recipe.acceptanceContract) : 'run objective'}`,
    `Budget: ${recipe.budget ? JSON.stringify(recipe.budget) : 'no recipe limit'}`,
    ...preview.tasks.flatMap(task => [
      `${task.id} · ${task.phase} · ${task.title}`,
      `  ${task.targetRole} / ${task.seat} · ${task.requestedProvider ?? 'chat provider'}${task.requestedModel ? ` / ${task.requestedModel}` : ''}${task.requestedEffort ? ` / ${task.requestedEffort}` : ''}`,
      `  Write paths: ${task.paths.join(', ') || 'none specified'}`,
      `  Depends on: ${task.blockedBy.join(', ') || 'nothing'}`,
      `  Verify: ${task.verifyCommands.join('; ') || 'no task commands'}`,
      task.prompt,
    ]),
  ]
}
