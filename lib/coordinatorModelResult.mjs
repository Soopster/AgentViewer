// Presentation only. Supervisors and the durable ledger keep the original data.
export function coordinatorModelResult(action, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result
  if (action === 'wait') {
    const { snapshot: _snapshot, ...compact } = result
    return compact
  }
  if (action === 'create_task' && result.task && typeof result.task === 'object') {
    // The caller just supplied the prompt. A claimer still gets the full task
    // from claim_task, and read_task can retrieve it after a context restart.
    const { prompt: _prompt, claudeAgentPolicy: _policy, ...task } = result.task
    return { ...result, task, taskDetailTool: 'coord_read_task' }
  }
  return result
}
