// The native "Open in my IDE" service: the choice lives in tui.json, so a TUI and a
// web tab on this machine agree on it.
import { getConfiguredIde, setConfiguredIde } from '../tuiState'
import { isIdeId, type IdeId } from '../ideCatalog'
import type { IdeState, PluginIdeService } from '../plugins/openInIde'
import { detectIdes, editorCommand, ideCommand, launchDetached } from './launch'

function editorState(): IdeState['editor'] {
  const command = process.env.VISUAL?.trim() || process.env.EDITOR?.trim()
  if (!command) return null
  try { return { command, terminal: editorCommand('/x', null).terminal } } catch { return null }
}

async function read(): Promise<IdeState> {
  return { detected: detectIdes().map(({ id, label }) => ({ id, label })), preference: await getConfiguredIde(), editor: editorState() }
}

export const nativeIde: PluginIdeService = {
  read: () => read(),
  async setPreference(id: IdeId) {
    if (!isIdeId(id)) throw new Error(`Unknown editor: ${String(id)}`)
    await setConfiguredIde(id)
    return read()
  },
  async open(input) {
    const ide = input.ide ?? await getConfiguredIde()
    if (!ide || ide === 'builtin') throw new Error('No editor chosen — palette: "Open files in…"')
    const command = ideCommand(ide, input)
    // A terminal editor needs this terminal, which a detached child cannot have.
    if (command.terminal) throw new Error(`${command.label} runs in a terminal — choose a GUI editor, or use the built-in editor (⌃G edits the prompt in $EDITOR)`)
    await launchDetached(command)
    return { label: command.label }
  },
}
