export type IndexSide = 'unstaged' | 'staged'
export type WorkspaceFile = { path: string; previousPath?: string; x: string; y: string; conflict: boolean }
export type WorkspaceBranch = { name: string; sha: string; upstream: string | null; worktreePath: string | null }
export type WorkspaceRemoteBranch = { name: string; sha: string; remote: string; branch: string }
export type ConflictVersion = { content: string | null; sha: string; mode: string; binary: boolean }
export type ConflictPreview = {
  path: string; revision: string; base: ConflictVersion | null; ours: ConflictVersion | null; theirs: ConflictVersion | null
  working: string | null; editable: boolean
}
export type WorkflowAction = (
  | { kind: 'branch-create'; name: string; start: string; switchTo: boolean }
  | { kind: 'branch-switch'; name: string; sha: string }
  | { kind: 'branch-rename'; name: string; sha: string; newName: string }
  | { kind: 'branch-delete'; name: string; sha: string }
  | { kind: 'branch-track'; name: string; upstream: string }
  | { kind: 'branch-merge'; name: string; sha: string }
  | { kind: 'remote-add'; name: string; url: string }
  | { kind: 'remote-remove'; name: string }
  | { kind: 'fetch'; remote: string }
  | { kind: 'push'; remote: string; branch: string; setUpstream: boolean; lease: string | null }
  | { kind: 'pull'; remote: string; branch: string; strategy: 'ff-only' | 'merge' | 'rebase' }
  | { kind: 'stash-create'; message: string; mode: 'all' | 'staged' | 'keep-index' | 'selected'; paths: string[]; includeUntracked: boolean }
  | { kind: 'stash-apply' | 'stash-pop' | 'stash-drop'; sha: string; selector: string; restoreIndex: boolean }
  | { kind: 'resolve'; path: string; choice: 'ours' | 'theirs' | 'working' }
  | { kind: 'conflict-save'; path: string; content: string }
  | { kind: 'operation'; operation: string; action: 'continue' | 'abort' | 'skip' }
) & { revision: string }
export type WorkflowDraft = WorkflowAction extends infer Action ? Action extends WorkflowAction ? Omit<Action, 'revision'> : never : never
export type WorkspaceSnapshot = {
  workflowRevision: string; branchRefs: WorkspaceBranch[]; remoteBranches: WorkspaceRemoteBranch[]; remotes: string[]
  root: string; branch: string; head: string | null; revision: string; indexRevision: string
  files: WorkspaceFile[]; branches: string[]; commits: { sha: string; subject: string }[]
  stashes: { sha: string; label: string; selector: string }[]; operation: string | null
  upstream: string | null; ahead: number; behind: number; lastMessage: string
}
export type WorkspacePreview = { patch: string; revision: string; side: IndexSide; path: string | null }
export type WorkspaceAction = WorkflowAction
  | { kind: 'stage' | 'unstage'; paths: string[]; revision: string }
  | { kind: 'patch'; path: string; side: IndexSide; revision: string; patch: string; lines: number[] }
  | { kind: 'commit'; message: string; amend: boolean; indexRevision: string; head: string | null }
export type WorkspaceResult = { output: string; snapshot: WorkspaceSnapshot; error?: string }
export type WorkspaceTransport = {
  conflict(cwd: string, path: string): Promise<ConflictPreview>
  inspect(cwd: string, kind: 'commit' | 'branch' | 'remote-branch' | 'stash', ref: string): Promise<string>
  snapshot(cwd: string): Promise<WorkspaceSnapshot>
  preview(cwd: string, side: IndexSide, path: string | null): Promise<WorkspacePreview>
  act(cwd: string, requestId: string, action: WorkspaceAction): Promise<WorkspaceResult>
}
export function filesForSide(files: WorkspaceFile[], side: IndexSide): WorkspaceFile[] {
  return files.filter(file => side === 'staged' ? file.x !== ' ' && file.x !== '?' : file.y !== ' ' || file.x === '?')
}
export type PatchRow = { index: number; text: string; changed: boolean; hunk: number; oldLine?: number; newLine?: number }
export function patchRows(patch: string): PatchRow[] {
  let hunk = -1, oldLine = 0, newLine = 0
  return patch.replace(/\n$/, '').split('\n').map((text, index) => {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (header) { hunk++; oldLine = Number(header[1]); newLine = Number(header[2]) }
    const content = hunk >= 0 && !header
    const row: PatchRow = { index, text, changed: content && (text[0] === '+' || text[0] === '-'), hunk }
    if (content && (text[0] === ' ' || text[0] === '-')) row.oldLine = oldLine++
    if (content && (text[0] === ' ' || text[0] === '+')) row.newLine = newLine++
    return row
  })
}
