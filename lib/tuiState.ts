import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TuiThemeMode } from '../tui/theme'

const TUI_STATE_FILE = path.join(process.cwd(), '.agent-viewer-data', 'tui.json')

type TuiState = {
  theme?: unknown
}

export async function getConfiguredTuiTheme(): Promise<TuiThemeMode> {
  try {
    const contents = await readFile(TUI_STATE_FILE, 'utf8')
    const parsed = JSON.parse(contents) as TuiState
    return parsed.theme === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export async function setConfiguredTuiTheme(theme: TuiThemeMode): Promise<void> {
  await mkdir(path.dirname(TUI_STATE_FILE), { recursive: true })
  await writeFile(TUI_STATE_FILE, JSON.stringify({ theme }, null, 2), 'utf8')
}
