import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { TuiDensity, TuiThemeMode, TuiTranscriptView } from '../tui/theme'

const TUI_STATE_FILE = path.join(process.cwd(), '.agent-viewer-data', 'tui.json')
const VALID_TUI_THEMES: readonly TuiThemeMode[] = [
  'light',
  'paper',
  'solarized-light',
  'github-light',
  'gruvbox-light',
  'catppuccin-latte',
  'rose-pine-dawn',
  'ayu-light',
  'one-light',
  'everforest-light',
  'tokyo-night-day',
  'quiet-light',
  'horizon-light',
  'flexoki-light',
  'nord-light',
  'vitesse-light',
  'iceberg-light',
  'material-lighter',
  'min-light',
  'alabaster',
  'light-owl',
  'papercolor-light',
  'tomorrow',
  'white',
  'stripe',
  'claude-cream',
  'supabase',
  'posthog',
  'replicate',
  'notion',
  'figma',
  'miro',
  'apple',
  'nike',
  'pinterest',
  'playstation',
  'nvidia',
  'mongodb',
  'slack',
  'cohere',
  'mistral',
  'cursor',
  'airbnb',
  'intercom',
  'imessage',
  'dark',
  'solarized-dark',
  'solar-flare',
  'nord',
  'gruvbox-dark',
  'dracula',
  'fancy-dracula',
  'tokyo-night',
  'catppuccin-mocha',
  'one-dark',
  'monokai',
  'kanagawa',
  'everforest-dark',
  'obsidian',
  'github-dark',
  'ayu-dark',
  'rose-pine',
  'synthwave',
  'palenight',
  'night-owl',
  'flexoki-dark',
  'cobalt',
  'vitesse-dark',
  'iceberg',
  'zenburn',
  'material-darker',
  'claude-code',
  'oceanic-next',
  'papercolor-dark',
  'snazzy',
  'slack-dark',
  'tomorrow-night',
  'ethereal',
  'hackerman',
  'lumon',
  'matte-black',
  'miasma',
  'osaka-jade',
  'retro-82',
  'ristretto',
  'vantablack',
  'linear',
  'sentry',
  'raycast',
  'framer',
  'ferrari',
  'resend',
  'cyber',
  'cyber-wave',
  'willow-dream',
]

type TuiState = {
  theme?: unknown
  railVisible?: unknown
  sidebarWidth?: unknown
  focusMode?: unknown
  density?: unknown
  diffLayout?: unknown
  transcriptView?: unknown
  transcriptWidth?: unknown
  tabsEnabled?: unknown
  splitPanes?: unknown
  showToolCalls?: unknown
  velocityScroll?: unknown
  sidebarSort?: unknown
  sessionReaderState?: unknown
}

// Mirrors SPLIT_PANE_MAX in the OpenTUI reader — the persisted value is clamped
// here so a hand-edited tui.json can't ask for panes the layout won't mount.
export const MAX_TUI_SPLIT_PANES = 2

export type TuiSidebarSort = 'project' | 'time'
export type TuiDiffLayout = 'stack' | 'split'
export type TuiTranscriptWidth = 'centered' | 'full'

export type TuiSessionReaderState = {
  followTail: boolean
  cursorKey: string | null
  topKey: string | null
  expandedKeys: string[]
  collapsedKeys: string[]
}

function normalizeSessionReaderState(value: unknown): TuiSessionReaderState | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const normalizeKey = (entry: unknown): string | null => (
    typeof entry === 'string' && entry.trim().length > 0 ? entry : null
  )
  const normalizeKeyList = (entry: unknown): string[] => (
    Array.isArray(entry)
      ? entry.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
  )

  return {
    followTail: record.followTail === true,
    cursorKey: normalizeKey(record.cursorKey),
    topKey: normalizeKey(record.topKey),
    expandedKeys: normalizeKeyList(record.expandedKeys),
    collapsedKeys: normalizeKeyList(record.collapsedKeys),
  }
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
  if (parsed.theme === 'cyber' || parsed.theme === 'lazygit') return 'cyber'
  return VALID_TUI_THEMES.includes(parsed.theme as TuiThemeMode)
    ? parsed.theme as TuiThemeMode
    : 'light'
}

export async function setConfiguredTuiTheme(theme: TuiThemeMode): Promise<void> {
  await writeTuiState({ theme })
}

export function setConfiguredTuiThemeSync(theme: TuiThemeMode): void {
  let current: TuiState = {}
  try {
    const contents = readFileSync(TUI_STATE_FILE, 'utf8')
    current = JSON.parse(contents) as TuiState
  } catch {
    current = {}
  }
  mkdirSync(path.dirname(TUI_STATE_FILE), { recursive: true })
  writeFileSync(TUI_STATE_FILE, JSON.stringify({ ...current, theme }, null, 2), 'utf8')
}

export async function getConfiguredTuiRailVisible(): Promise<boolean> {
  const parsed = await readTuiState()
  return parsed.railVisible !== false
}

export async function setConfiguredTuiRailVisible(railVisible: boolean): Promise<void> {
  await writeTuiState({ railVisible })
}

export async function getConfiguredTuiSidebarWidth(): Promise<number> {
  const parsed = await readTuiState()
  return typeof parsed.sidebarWidth === 'number' && Number.isFinite(parsed.sidebarWidth)
    ? Math.max(28, Math.round(parsed.sidebarWidth))
    : 32
}

export async function setConfiguredTuiSidebarWidth(sidebarWidth: number): Promise<void> {
  await writeTuiState({ sidebarWidth: Math.max(28, Math.round(sidebarWidth)) })
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

export async function getConfiguredTuiDiffLayout(): Promise<TuiDiffLayout> {
  const parsed = await readTuiState()
  return parsed.diffLayout === 'split' ? 'split' : 'stack'
}

export async function setConfiguredTuiDiffLayout(diffLayout: TuiDiffLayout): Promise<void> {
  await writeTuiState({ diffLayout })
}

export async function getConfiguredTuiTranscriptView(): Promise<TuiTranscriptView> {
  const parsed = await readTuiState()
  return parsed.transcriptView === 'full' ? 'full' : parsed.transcriptView === 'continue' ? 'continue' : parsed.transcriptView === 'stream' ? 'stream' : parsed.transcriptView === 'agents' ? 'agents' : 'conversation'
}

export async function setConfiguredTuiTranscriptView(transcriptView: TuiTranscriptView): Promise<void> {
  await writeTuiState({ transcriptView })
}

export async function getConfiguredTuiTranscriptWidth(): Promise<TuiTranscriptWidth> {
  const parsed = await readTuiState()
  return parsed.transcriptWidth === 'full' ? 'full' : 'centered'
}

export async function setConfiguredTuiTranscriptWidth(transcriptWidth: TuiTranscriptWidth): Promise<void> {
  await writeTuiState({ transcriptWidth })
}

export async function getConfiguredTuiTabsEnabled(): Promise<boolean> {
  const parsed = await readTuiState()
  return parsed.tabsEnabled !== false
}

export async function setConfiguredTuiTabsEnabled(tabsEnabled: boolean): Promise<void> {
  await writeTuiState({ tabsEnabled })
}

export async function getConfiguredTuiSplitPanes(): Promise<number> {
  const parsed = await readTuiState()
  const value = typeof parsed.splitPanes === 'number' ? Math.floor(parsed.splitPanes) : 0
  return Math.min(Math.max(value, 0), MAX_TUI_SPLIT_PANES)
}

export async function setConfiguredTuiSplitPanes(splitPanes: number): Promise<void> {
  await writeTuiState({ splitPanes: Math.min(Math.max(Math.floor(splitPanes), 0), MAX_TUI_SPLIT_PANES) })
}

export async function getConfiguredTuiShowToolCalls(): Promise<boolean> {
  const parsed = await readTuiState()
  return parsed.showToolCalls !== false
}

export async function setConfiguredTuiShowToolCalls(showToolCalls: boolean): Promise<void> {
  await writeTuiState({ showToolCalls })
}

export async function getConfiguredTuiVelocityScroll(): Promise<boolean> {
  const parsed = await readTuiState()
  return parsed.velocityScroll === true
}

export async function setConfiguredTuiVelocityScroll(velocityScroll: boolean): Promise<void> {
  await writeTuiState({ velocityScroll })
}

export async function getConfiguredTuiSidebarSort(): Promise<TuiSidebarSort> {
  const parsed = await readTuiState()
  return parsed.sidebarSort === 'time' ? 'time' : 'project'
}

export async function setConfiguredTuiSidebarSort(sidebarSort: TuiSidebarSort): Promise<void> {
  await writeTuiState({ sidebarSort })
}

export async function getConfiguredTuiSessionReaderState(sessionKey: string): Promise<TuiSessionReaderState | null> {
  const parsed = await readTuiState()
  if (!parsed.sessionReaderState || typeof parsed.sessionReaderState !== 'object') return null
  const record = parsed.sessionReaderState as Record<string, unknown>
  return normalizeSessionReaderState(record[sessionKey])
}

export async function setConfiguredTuiSessionReaderState(
  sessionKey: string,
  sessionReaderState: TuiSessionReaderState,
): Promise<void> {
  const parsed = await readTuiState()
  const current = parsed.sessionReaderState && typeof parsed.sessionReaderState === 'object'
    ? parsed.sessionReaderState as Record<string, unknown>
    : {}

  await writeTuiState({
    sessionReaderState: {
      ...current,
      [sessionKey]: sessionReaderState,
    },
  })
}
