// The editors a file can be handed to. No Node imports: the web client reads the labels.

export type IdeId =
  | 'builtin'
  | 'vscode'
  | 'cursor'
  | 'windsurf'
  | 'zed'
  | 'idea'
  | 'webstorm'
  | 'pycharm'
  | 'goland'
  | 'sublime'
  | 'editor'

/** How an editor takes a line: VS Code's `-g file:line:col`, JetBrains' `--line`, or `file:line:col`. */
export type IdeLineStyle = 'goto-flag' | 'line-flag' | 'suffix'

export type IdeEntry = {
  id: Exclude<IdeId, 'builtin' | 'editor'>
  label: string
  /** CLI names to look for on PATH, in order. */
  commands: readonly string[]
  /** macOS app bundles whose CLI can be used when the command is not on PATH. */
  macApps: readonly string[]
  lineStyle: IdeLineStyle
}

export const IDE_CATALOG: readonly IdeEntry[] = [
  { id: 'vscode', label: 'VS Code', commands: ['code'], macApps: ['Visual Studio Code.app/Contents/Resources/app/bin/code'], lineStyle: 'goto-flag' },
  { id: 'cursor', label: 'Cursor', commands: ['cursor'], macApps: ['Cursor.app/Contents/Resources/app/bin/cursor'], lineStyle: 'goto-flag' },
  { id: 'windsurf', label: 'Windsurf', commands: ['windsurf'], macApps: ['Windsurf.app/Contents/Resources/app/bin/windsurf'], lineStyle: 'goto-flag' },
  { id: 'zed', label: 'Zed', commands: ['zed'], macApps: ['Zed.app/Contents/MacOS/cli'], lineStyle: 'suffix' },
  { id: 'idea', label: 'IntelliJ IDEA', commands: ['idea'], macApps: ['IntelliJ IDEA.app/Contents/MacOS/idea', 'IntelliJ IDEA CE.app/Contents/MacOS/idea'], lineStyle: 'line-flag' },
  { id: 'webstorm', label: 'WebStorm', commands: ['webstorm'], macApps: ['WebStorm.app/Contents/MacOS/webstorm'], lineStyle: 'line-flag' },
  { id: 'pycharm', label: 'PyCharm', commands: ['pycharm', 'charm'], macApps: ['PyCharm.app/Contents/MacOS/pycharm', 'PyCharm CE.app/Contents/MacOS/pycharm'], lineStyle: 'line-flag' },
  { id: 'goland', label: 'GoLand', commands: ['goland'], macApps: ['GoLand.app/Contents/MacOS/goland'], lineStyle: 'line-flag' },
  { id: 'sublime', label: 'Sublime Text', commands: ['subl'], macApps: ['Sublime Text.app/Contents/SharedSupport/bin/subl'], lineStyle: 'suffix' },
]

export const IDE_IDS: readonly IdeId[] = ['builtin', ...IDE_CATALOG.map((entry) => entry.id), 'editor']

export function isIdeId(value: unknown): value is IdeId {
  return typeof value === 'string' && (IDE_IDS as readonly string[]).includes(value)
}

export function ideLabel(id: IdeId): string {
  if (id === 'builtin') return 'Built-in editor'
  if (id === 'editor') return '$VISUAL / $EDITOR'
  return IDE_CATALOG.find((entry) => entry.id === id)?.label ?? id
}
