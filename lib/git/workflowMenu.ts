import type { WorkflowDraft, WorkspaceSnapshot } from './workspaceTypes'
export type WorkflowField = { key: string; label: string; kind: 'text' | 'choice' | 'toggle' | 'paths'; initial: string; options?: { value: string; label: string }[] }
export type WorkflowChoice = { id: string; label: string; description: string; fields: WorkflowField[]; build(values: Record<string, string>): WorkflowDraft }
export type WorkflowContext = { kind: 'branch' | 'remote-branch' | 'commit' | 'stash'; ref: string; selector?: string } | null
const text = (key: string, label: string, initial = ''): WorkflowField => ({ key, label, initial, kind: 'text' })
const toggle = (key: string, label: string, initial = false): WorkflowField => ({ key, label, initial: String(initial), kind: 'toggle' })
const choice = (key: string, label: string, options: string[], initial = options[0] ?? ''): WorkflowField => ({ key, label, kind: 'choice', initial, options: options.map(value => ({ value, label: value })) })
export function workflowChoices(state: WorkspaceSnapshot, context: WorkflowContext, path: string | null): WorkflowChoice[] {
  const choices: WorkflowChoice[] = []
  const selectedRemote = context?.kind === 'remote-branch' ? state.remoteBranches.find(branch => branch.name === context.ref) : undefined
  const branch = context?.kind === 'remote-branch' ? undefined : state.branchRefs.find(branch => branch.name === (context?.kind === 'branch' ? context.ref : state.branch))
  const upstream = state.remoteBranches.find(branch => branch.name === state.upstream)
  const remote = upstream?.remote ?? (state.remotes.includes('origin') ? 'origin' : state.remotes[0] ?? '')
  const remoteBranch = upstream?.branch ?? (state.branch === '(detached HEAD)' ? 'main' : state.branch)
  const remoteField = choice('remote', 'Remote', state.remotes, remote)
  if (state.operation && ['merge', 'rebase', 'cherry-pick', 'revert'].includes(state.operation)) {
    const operation = state.operation
    choices.push({ id: 'operation-continue', label: `Continue ${operation}`, description: 'Continue with the staged resolutions. Every conflict must be resolved first.', fields: [], build: () => ({ kind: 'operation', operation, action: 'continue' }) })
    choices.push({ id: 'operation-abort', label: `Abort ${operation}`, description: 'Return to the pre-operation state. Resolution edits made during this operation may be lost.', fields: [], build: () => ({ kind: 'operation', operation, action: 'abort' }) })
    if (operation !== 'merge') choices.push({ id: 'operation-skip', label: `Skip current ${operation} step`, description: 'Omit the current commit and continue the operation.', fields: [], build: () => ({ kind: 'operation', operation, action: 'skip' }) })
  }
  if (state.head) choices.push({ id: 'branch-create', label: 'Create branch', description: 'Create a local branch from the selected starting point. Git preserves compatible local changes when switching.', fields: [text('name', 'Branch name', selectedRemote?.branch ?? ''), choice('start', 'Start from', [...new Set([state.head, ...(context?.kind === 'commit' ? [context.ref] : [])]) , ...state.branches, ...state.remoteBranches.map(branch => `refs/remotes/${branch.name}`)], selectedRemote ? `refs/remotes/${selectedRemote.name}` : context?.kind === 'commit' ? context.ref : state.head), toggle('switchTo', 'Switch to new branch', true)], build: values => ({ kind: 'branch-create', name: values.name!, start: values.start!, switchTo: values.switchTo === 'true' }) })
  if (branch) {
    if (branch.name !== state.branch) choices.push({ id: 'branch-switch', label: `Switch to ${branch.name}`, description: `Compatible local changes are carried to the branch; Git refuses a switch that would overwrite them.${branch.worktreePath ? ` Checked out at ${branch.worktreePath}.` : ''}`, fields: [], build: () => ({ kind: 'branch-switch', name: branch.name, sha: branch.sha }) })
    choices.push({ id: 'branch-rename', label: `Rename ${branch.name}`, description: 'Rename this local branch and its tracking configuration.', fields: [text('newName', 'New branch name', branch.name)], build: values => ({ kind: 'branch-rename', name: branch.name, sha: branch.sha, newName: values.newName! }) })
    if (branch.name !== state.branch) {
      choices.push({ id: 'branch-merge', label: `Merge ${branch.name}`, description: `Merge into ${state.branch}. Commit or stash local changes first. Conflicts remain available to resolve.`, fields: [], build: () => ({ kind: 'branch-merge', name: branch.name, sha: branch.sha }) })
      choices.push({ id: 'branch-delete', label: `Delete ${branch.name}`, description: 'Delete this local branch. Git refuses deletion of unmerged or checked-out branches.', fields: [], build: () => ({ kind: 'branch-delete', name: branch.name, sha: branch.sha }) })
    }
    if (state.remoteBranches.length) choices.push({ id: 'branch-track', label: `Set upstream for ${branch.name}`, description: 'Choose the remote tracking branch used for ahead/behind status and sync.', fields: [choice('upstream', 'Upstream', state.remoteBranches.map(branch => branch.name), branch.upstream ?? state.remoteBranches[0]!.name)], build: values => ({ kind: 'branch-track', name: branch.name, upstream: values.upstream! }) })
  }
  choices.push({ id: 'stash-create', label: 'Create stash', description: 'Save local changes. Keep-index mode leaves staged changes in place; the stash also records the index. Selected mode stashes only the checked files.', fields: [text('message', 'Stash message'), choice('mode', 'Changes to stash', ['all', 'staged', 'keep-index', 'selected']), toggle('includeUntracked', 'Include untracked files'), { key: 'paths', label: 'Selected files (selected mode)', kind: 'paths', initial: JSON.stringify(path ? [path] : []), options: state.files.map(file => ({ value: file.path, label: file.path })) }], build: values => ({ kind: 'stash-create', mode: values.mode as 'all', message: values.message!, includeUntracked: values.includeUntracked === 'true', paths: workflowPaths(values.paths || '[]') }) })
  const stash = context?.kind === 'stash' ? state.stashes.find(stash => stash.sha === context.ref && (!context.selector || stash.selector === context.selector)) : undefined
  if (stash) for (const kind of ['stash-apply', 'stash-pop', 'stash-drop'] as const) {
    choices.push({ id: kind, label: `${kind === 'stash-apply' ? 'Apply' : kind === 'stash-pop' ? 'Pop' : 'Drop'} ${stash.selector}`, description: kind === 'stash-drop' ? `Permanently remove ${stash.label} from the stash list.` : `${stash.label}. Apply into a clean worktree.${kind === 'stash-pop' ? ' Remove the stash only after a successful application; conflicts keep it.' : ' Keep the stash after applying.'}`, fields: kind === 'stash-drop' ? [] : [toggle('restoreIndex', 'Restore staged state')], build: values => ({ kind, sha: stash.sha, selector: stash.selector, restoreIndex: values.restoreIndex === 'true' }) })
  }
  if (state.remotes.length) {
    choices.push({ id: 'fetch', label: 'Fetch remote', description: 'Update remote tracking references and prune references removed from the remote. Working files are unchanged.', fields: [remoteField], build: values => ({ kind: 'fetch', remote: values.remote! }) })
    choices.push({ id: 'pull', label: 'Pull changes', description: `Integrate the selected remote branch into ${state.branch}. A clean worktree is required. Choose fast-forward, merge, or rebase explicitly.`, fields: [remoteField, text('branch', 'Remote branch', remoteBranch), choice('strategy', 'Pull strategy', ['ff-only', 'merge', 'rebase'])], build: values => ({ kind: 'pull', remote: values.remote!, branch: values.branch!, strategy: values.strategy as 'ff-only' }) })
    choices.push({ id: 'push', label: 'Push changes', description: `Publish HEAD (${state.head?.slice(0, 8) ?? 'no commit'}) from ${state.branch}. Replacing history requires a lease matching the fetched remote tip.`, fields: [remoteField, text('branch', 'Remote branch', remoteBranch), toggle('setUpstream', 'Set upstream', !state.upstream), toggle('replace', 'Replace remote history with force-with-lease')], build: values => {
      const tip = state.remoteBranches.find(branch => branch.remote === values.remote && branch.branch === values.branch)
      if (values.replace === 'true' && !tip) throw new Error('Fetch this remote branch before requesting a force lease.')
      return { kind: 'push', remote: values.remote!, branch: values.branch!, setUpstream: values.setUpstream === 'true', lease: values.replace === 'true' ? tip!.sha : null }
    } })
    choices.push({ id: 'remote-remove', label: 'Remove remote', description: 'Remove the local remote configuration and its tracking references. The remote server is unchanged.', fields: [remoteField], build: values => ({ kind: 'remote-remove', name: values.remote! }) })
  }
  choices.push({ id: 'remote-add', label: 'Add remote', description: 'Configure a remote URL or local repository path. Fetch it to load its branches.', fields: [text('name', 'Remote name', 'origin'), text('url', 'Remote URL or path')], build: values => ({ kind: 'remote-add', name: values.name!, url: values.url! }) })
  return choices
}
export function initialWorkflowValues(choice: WorkflowChoice): Record<string, string> { return Object.fromEntries(choice.fields.map(field => [field.key, field.initial])) }
export function workflowSummary(choice: WorkflowChoice, values: Record<string, string>): string {
  const action = choice.build(values)
  return [choice.description, ...choice.fields.map(field => `${field.label}: ${field.kind === 'paths' ? workflowPaths(values[field.key] || '[]').join(', ') || '(none)' : values[field.key]}`), ...('lease' in action && action.lease ? [`Expected remote tip: ${action.lease}`] : [])].join('\n')
}

export function workflowPaths(value: string): string[] {
  try { const paths: unknown = JSON.parse(value); return Array.isArray(paths) && paths.every(path => typeof path === 'string') ? paths : [] } catch { return [] }
}
