import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TuiDensity, TuiThemeMode } from '../tui/theme'

const TUI_STATE_FILE = path.join(process.cwd(), '.agent-viewer-data', 'tui.json')

type TuiState = {
  theme?: unknown
  railVisible?: unknown
  focusMode?: unknown
  density?: unknown
}

async function readTuiState(): Promise<TuiState> {
  try {
    const contents = await readFile(TUI_STATE_FILE, 'utf8')
    return JSON.parse(contents) as TuiState
  } catch {
    return {}
  }
}

async function writeTuiState(update: Partial<TuiState>): Promise<void> {
  const current = await readTuiState()
  await mkdir(path.dirname(TUI_STATE_FILE), { recursive: true })
  await writeFile(TUI_STATE_FILE, JSON.stringify({ ...current, ...update }, null, 2), 'utf8')
}

export async function getConfiguredTuiTheme(): Promise<TuiThemeMode> {
  const parsed = await readTuiState()
  if (parsed.theme === 'lazygit') return 'lazygit'
  return parsed.theme === 'dark' ? 'dark' : 'light'
}

export async function setConfiguredTuiTheme(theme: TuiThemeMode): Promise<void> {
  await writeTuiState({ theme })
}

export async function getConfiguredTuiRailVisible(): Promise<boolean> {
  const parsed = await readTuiState()
  return parsed.railVisible !== false
}

export async function setConfiguredTuiRailVisible(railVisible: boolean): Promise<void> {
  await writeTuiState({ railVisible })
}

export async function getConfiguredTuiFocusMode(): Promise<boolean> {
  const parsed = await readTuiState()
  return parsed.focusMode === true
}

export async function setConfiguredTuiFocusMode(focusMode: boolean): Promise<void> {
  await writeTuiState({ focusMode })
}

export async function getConfiguredTuiDensity(): Promise<TuiDensity> {
  const parsed = await readTuiState()
  if (parsed.density === 'comfortable' || parsed.density === 'dense') return parsed.density
  return 'balanced'
}

export async function setConfiguredTuiDensity(density: TuiDensity): Promise<void> {
  await writeTuiState({ density })
}
