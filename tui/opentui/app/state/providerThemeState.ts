/** @jsxImportSource @opentui/react */
import { useRef, useState } from 'react'
import { useWorkspaceState, useAppState } from '../../workspaceContext'
import { type TuiDensity, type TuiThemeMode, type TuiTranscriptView } from '../../../theme'
import { type TuiProviderInstanceChoice, type TuiDiffLayout } from '../../../../lib/tui/service'
import { type ProviderSelection } from '../../../../lib/types'
import { type TranscriptDiffNoteDraft, type TranscriptDiffNote } from '../transcriptDiffSelection'

export function useProviderThemeState() {
  const [provider, setProvider] = useWorkspaceState<ProviderSelection>('provider', 'claude')
  // One instance of `provider` (a second account, one ACP agent), or null for
  // all of them. The ref is what a refresh reads, so a poll already scheduled
  // lists what is selected now rather than what was selected when it was queued.
  const [providerInstanceId, setProviderInstanceId] = useWorkspaceState<string | null>('providerInstanceId', null)
  const providerInstanceIdRef = useRef<string | null>(null)
  const [providerInstances, setProviderInstances] = useState<TuiProviderInstanceChoice[]>([])
  const [themeMode, setThemeMode] = useAppState<TuiThemeMode>('themeMode', 'light')
  const [themeFollowsTerminal, setThemeFollowsTerminal] = useAppState('themeFollowsTerminal', false)
  const [showBorders, setShowBorders] = useAppState('showBorders', true)
  // Bumped when the terminal's reported colours change, which is what the
  // terminal-palette theme is made of.
  const [terminalPaletteEpoch, setTerminalPaletteEpoch] = useState(0)
  const themeFollowsTerminalRef = useRef(false)
  // The theme last chosen from each side; following the terminal switches between them.
  const themeSlotsRef = useRef<{ light: TuiThemeMode; dark: TuiThemeMode }>({ light: 'light', dark: 'dark' })
  const [density, setDensity] = useAppState<TuiDensity>('density', 'balanced')
  const [diffLayout, setDiffLayout] = useAppState<TuiDiffLayout>('diffLayout', 'stack')
  const [transcriptDiffNotes, setTranscriptDiffNotes] = useWorkspaceState<Map<string, TranscriptDiffNote>>('transcriptDiffNotes', () => new Map())
  const [transcriptDiffDraft, setTranscriptDiffDraft] = useState<TranscriptDiffNoteDraft | null>(null)
  const [pendingTranscriptDiffPrompt, setPendingTranscriptDiffPrompt] = useState<{ target: string; prompt: string } | null>(null)
  const [hoveredTranscriptDiffAnchor, setHoveredTranscriptDiffAnchor] = useState<string | null>(null)
  const [transcriptDiffPlainCardKeys, setTranscriptDiffPlainCardKeys] = useState<Set<string>>(() => new Set())
  const [transcriptDiffHiddenLineNumberCardKeys, setTranscriptDiffHiddenLineNumberCardKeys] = useState<Set<string>>(() => new Set())
  const [transcriptDiffHiddenHunkHeaderCardKeys, setTranscriptDiffHiddenHunkHeaderCardKeys] = useState<Set<string>>(() => new Set())
  const [transcriptDiffRowCursorByCardKey, setTranscriptDiffRowCursorByCardKey] = useState<Record<string, number>>({})
  const [transcriptDiffSelectionAnchorByCardKey, setTranscriptDiffSelectionAnchorByCardKey] = useState<Record<string, number>>({})
  const [agentToolCursorByGroupKey, setAgentToolCursorByGroupKey] = useState<Record<string, string>>({})
  const [transcriptView, setTranscriptView] = useAppState<TuiTranscriptView>('transcriptView', 'conversation')

  return {
    provider, setProvider, providerInstanceId, setProviderInstanceId, providerInstanceIdRef,
    providerInstances, setProviderInstances, themeMode, setThemeMode, themeFollowsTerminal,
    setThemeFollowsTerminal, showBorders, setShowBorders, terminalPaletteEpoch, setTerminalPaletteEpoch,
    themeFollowsTerminalRef, themeSlotsRef, density, setDensity, diffLayout, setDiffLayout,
    transcriptDiffNotes, setTranscriptDiffNotes, transcriptDiffDraft, setTranscriptDiffDraft,
    pendingTranscriptDiffPrompt, setPendingTranscriptDiffPrompt, hoveredTranscriptDiffAnchor,
    setHoveredTranscriptDiffAnchor, transcriptDiffPlainCardKeys, setTranscriptDiffPlainCardKeys,
    transcriptDiffHiddenLineNumberCardKeys, setTranscriptDiffHiddenLineNumberCardKeys,
    transcriptDiffHiddenHunkHeaderCardKeys, setTranscriptDiffHiddenHunkHeaderCardKeys,
    transcriptDiffRowCursorByCardKey, setTranscriptDiffRowCursorByCardKey,
    transcriptDiffSelectionAnchorByCardKey, setTranscriptDiffSelectionAnchorByCardKey,
    agentToolCursorByGroupKey, setAgentToolCursorByGroupKey, transcriptView, setTranscriptView,
  }
}
