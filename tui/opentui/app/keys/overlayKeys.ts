/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { KeyEvent } from '@opentui/core'
import type { SurfacePanelState } from '../../surfacePanelState'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { PaletteCommand } from '../types'
import React from 'react'
import { type TuiPluginCapture } from '../../shell/pluginTypes'
import { getPluginSurface, isPluginSurfaceId } from '../../../../lib/plugins/catalog'
import { type WindowSurfaceKind } from '../../windowSurfaceNames'
import { isPopoverWindowKind, POPOVER_WINDOWS } from '../../popoverWindows'
import { activeSurface } from '../../surfacePanelState'
import { type TuiThemeMode } from '../../../theme'
import { type MessageBookmark } from '../../../../lib/messageBookmarks'
import { type Session } from '../../../../lib/types'
import { type PendingPermission } from '../../../../lib/permissions'
import { type ChordMap } from '../../chordHelp'
import { type ModelPickerOption, type TuiCopilotContextTier, type ModelPickerFocus } from '../types'
import { SURFACE_PANEL_MIN_ROWS, SURFACE_PANEL_MIN_WIDTH, SURFACE_PANEL_ROW_STEP, SURFACE_PANEL_RESIZE_STEP, SURFACE_PANEL_MAX_WIDTH } from '../layoutConstants'
import { clamp } from '../util'
import { type ThemeMenuGroup, THEMES, THEME_GROUPS, filterThemeModes, themeGroupModes } from '../themes'
import { sessionKey } from '../sessionList'
import { type TranscriptDiffNoteDraft, type TranscriptDiffNote } from '../transcriptDiffSelection'

/** Returns true when one of these branches handled the key. */
export function handleOverlayAndMenuKeys({ focusedWindowSurface, windowSurfaceCaptureRef, windowSurfaceKeysRef, pendingPermissions, focusedWindowSurfaceKind, splitChordPending, key, handled, focusReaderFromSplit, surfacePanel, surfacePanelVisible, surfacePanelFocused, surfacePluginKeyCaptureRef, surfacePluginKeyRef, sequence, setSurfacePanelExpanded, surfacePanelAtBottom, setSurfacePanelRows, surfacePanelMaxRows, setSurfacePanelWidth, surfacePanelMaxWidth, toggleSurfacePanelPlacement, isShifted, setSurfacePanelOpen, setSurfacePanelFocused, surfacePanelKeyHandlerRef, pluginManagerOpen, pluginManagerKeyHandlerRef, newSessionModalOpen, newSessionKeyHandlerRef, handoffBriefOpen, handoffBriefKeyHandlerRef, promptLibraryOpen, promptLibraryKeyHandlerRef, chordHelp, setChordHelp, bookmarksOverlayOpen, isCtrl, setBookmarksOverlayOpen, bookmarksOverlay, setBookmarksOverlayIndex, bookmarksOverlayIndex, openBookmarkRecord, attentionOpen, attentionKeyHandlerRef, renameSessionKey, setRenameSessionKey, setRenameDraft, commitRename, providerMenuOpen, closeProviderMenu, requestExit, modelPickerOpen, isModelEffortShortcut, setModelPickerOpen, modelPickerFocus, setModelPickerFocus, setModelPickerIndex, filteredModelPickerOptions, modelPickerTarget, modelPickerOptions, modelPickerIndex, setTuiCopilotContextTierByKey, themeMenuOpen, themeMenuGroup, setThemeMenuGroup, themeMenuQuery, themeMenuOriginRef, setThemeMenuIndex, setThemeMode, themeMenuIndex, chooseTheme, closeThemeMenu, toggleThemeFollowsTerminal, transcriptViewMenuOpen, closeTranscriptViewMenu, toggleLightweightWindows, commandPaletteOpen, closeCommandPalette, setCommandPaletteIndex, filteredCommands, commandPaletteIndex, executeCommandPalette, setCommandPaletteQuery, transcriptDiffDraft, setTranscriptDiffDraft, setTranscriptDiffNotes, openModelPicker }: {
  focusedWindowSurface: string | null
  windowSurfaceCaptureRef: React.RefObject<Map<string, boolean | 'none' | 'input' | 'terminal'>>
  windowSurfaceKeysRef: React.RefObject<Map<string, (key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => unknown>>
  pendingPermissions: PendingPermission[]
  focusedWindowSurfaceKind: WindowSurfaceKind | null
  splitChordPending: boolean
  key: KeyEvent
  handled: (action: () => void) => void
  focusReaderFromSplit: () => void
  surfacePanel: SurfacePanelState
  surfacePanelVisible: boolean
  surfacePanelFocused: boolean
  surfacePluginKeyCaptureRef: React.RefObject<TuiPluginCapture>
  surfacePluginKeyRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean | void) | null>
  sequence: string
  setSurfacePanelExpanded: React.Dispatch<React.SetStateAction<boolean>>
  surfacePanelAtBottom: boolean
  setSurfacePanelRows: React.Dispatch<React.SetStateAction<number>>
  surfacePanelMaxRows: number
  setSurfacePanelWidth: React.Dispatch<React.SetStateAction<number>>
  surfacePanelMaxWidth: number
  toggleSurfacePanelPlacement: () => void
  isShifted: (char: string) => boolean
  setSurfacePanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  surfacePanelKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => void) | null>
  pluginManagerOpen: boolean
  pluginManagerKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => void) | null>
  newSessionModalOpen: boolean
  newSessionKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => void) | null>
  handoffBriefOpen: boolean
  handoffBriefKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => void) | null>
  promptLibraryOpen: boolean
  promptLibraryKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string; }) => void) | null>
  chordHelp: { map: ChordMap; dismissOnKey: boolean; } | null
  setChordHelp: React.Dispatch<React.SetStateAction<{ map: ChordMap; dismissOnKey: boolean; } | null>>
  bookmarksOverlayOpen: boolean
  isCtrl: (char: string) => boolean
  setBookmarksOverlayOpen: React.Dispatch<React.SetStateAction<boolean>>
  bookmarksOverlay: MessageBookmark[]
  setBookmarksOverlayIndex: React.Dispatch<React.SetStateAction<number>>
  bookmarksOverlayIndex: number
  openBookmarkRecord: (record: MessageBookmark) => void
  attentionOpen: boolean
  attentionKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => void) | null>
  renameSessionKey: string | null
  setRenameSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setRenameDraft: React.Dispatch<React.SetStateAction<string>>
  commitRename: () => Promise<void>
  providerMenuOpen: boolean
  closeProviderMenu: () => void
  requestExit: () => void
  modelPickerOpen: boolean
  isModelEffortShortcut: boolean
  setModelPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  modelPickerFocus: ModelPickerFocus
  setModelPickerFocus: React.Dispatch<React.SetStateAction<ModelPickerFocus>>
  setModelPickerIndex: React.Dispatch<React.SetStateAction<number>>
  filteredModelPickerOptions: ModelPickerOption[]
  modelPickerTarget: Session | null
  modelPickerOptions: ModelPickerOption[]
  modelPickerIndex: number
  setTuiCopilotContextTierByKey: React.Dispatch<React.SetStateAction<Record<string, TuiCopilotContextTier>>>
  themeMenuOpen: boolean
  themeMenuGroup: ThemeMenuGroup
  setThemeMenuGroup: React.Dispatch<React.SetStateAction<ThemeMenuGroup>>
  themeMenuQuery: string
  themeMenuOriginRef: React.RefObject<TuiThemeMode | null>
  setThemeMenuIndex: React.Dispatch<React.SetStateAction<number>>
  setThemeMode: React.Dispatch<React.SetStateAction<TuiThemeMode>>
  themeMenuIndex: number
  chooseTheme: (nextTheme: TuiThemeMode) => void
  closeThemeMenu: () => void
  toggleThemeFollowsTerminal: () => void
  transcriptViewMenuOpen: boolean
  closeTranscriptViewMenu: () => void
  toggleLightweightWindows: () => void
  commandPaletteOpen: boolean
  closeCommandPalette: () => void
  setCommandPaletteIndex: React.Dispatch<React.SetStateAction<number>>
  filteredCommands: PaletteCommand[]
  commandPaletteIndex: number
  executeCommandPalette: (id: string) => void
  setCommandPaletteQuery: React.Dispatch<React.SetStateAction<string>>
  transcriptDiffDraft: TranscriptDiffNoteDraft | null
  setTranscriptDiffDraft: React.Dispatch<React.SetStateAction<TranscriptDiffNoteDraft | null>>
  setTranscriptDiffNotes: React.Dispatch<React.SetStateAction<Map<string, TranscriptDiffNote>>>
  openModelPicker: () => Promise<void>
}): boolean {
    // Review text inputs and active search/filter escape handling belong to the diff.
    // Keep panel close/cycle/add chords available even while an input is active.
    // A terminal window with the keyboard gets every key, as in the side panel;
    // typing a command lets keys reach its input. Ahead of the ⌃B prefix, which
    // a shell (and tmux inside it) needs too.
    const windowCapture = focusedWindowSurface ? windowSurfaceCaptureRef.current.get(focusedWindowSurface) : undefined
    const windowKeys = focusedWindowSurface ? windowSurfaceKeysRef.current.get(focusedWindowSurface) : undefined
    // A capturing popover window (the editor) takes every key but the ⌃B prefix,
    // ahead of the global shortcuts, as a shell in terminal mode does. A key it
    // declines (false) goes on to its focused input.
    if (pendingPermissions.length === 0 && focusedWindowSurfaceKind && isPopoverWindowKind(focusedWindowSurfaceKind) && POPOVER_WINDOWS[focusedWindowSurfaceKind].keys === 'capture'
      && !splitChordPending && !(key.ctrl && key.name === 'b')) {
      const consumed = windowKeys?.(key)
      if (consumed !== false) handled(() => {})
      return true
    }
    if (pendingPermissions.length === 0 && focusedWindowSurfaceKind && isPluginSurfaceId(focusedWindowSurfaceKind) && (windowCapture === 'terminal' || windowCapture === 'input')) {
      if (windowCapture === 'terminal' || key.name === 'escape') {
        handled(() => { windowKeys?.(key) })
      }
      return true
    }
    if (pendingPermissions.length === 0 && focusedWindowSurfaceKind === 'diff' && windowCapture === true) {
      if (windowKeys?.(key) !== false) handled(() => {})
      return true
    }
    // A browser window's address field takes typing; Escape and the ⌃B prefix
    // still reach the window controls.
    if (pendingPermissions.length === 0 && focusedWindowSurfaceKind && isPluginSurfaceId(focusedWindowSurfaceKind) && getPluginSurface(focusedWindowSurfaceKind).keys === 'field' && !splitChordPending && !(key.ctrl && key.name === 'b')) {
      if (key.name === 'escape') handled(focusReaderFromSplit)
      return true
    }

    const panelSurfaceKind = activeSurface(surfacePanel)?.kind
    if (pendingPermissions.length === 0 && surfacePanelVisible && surfacePanelFocused && panelSurfaceKind && isPluginSurfaceId(panelSurfaceKind)
      && surfacePluginKeyCaptureRef.current === true && !(key.ctrl && ['w', 'n', 'p', 't'].includes(key.name))) {
      if (surfacePluginKeyRef.current?.(key) !== false) handled(() => {})
      return true
    }

    if (pendingPermissions.length === 0 && surfacePanelVisible && surfacePanelFocused) {
      const surface = activeSurface(surfacePanel)
      // Browser and shell surfaces own a focused <input>; swallowing their keys
      // here would make them untypeable, so only the panel's own chords are
      // intercepted and everything else falls through to the renderer.
      const pluginSurface = surface && isPluginSurfaceId(surface.kind) ? getPluginSurface(surface.kind) : null
      const pluginCapture = pluginSurface ? surfacePluginKeyCaptureRef.current : false
      if (pluginCapture === 'terminal') {
        handled(() => { surfacePluginKeyRef.current?.(key) })
        return true
      }
      const inputOwned = pluginSurface?.keys === 'field' || pluginCapture === 'input'
      // Escape cancels a command being typed rather than leaving the panel.
      if (pluginCapture === 'input' && key.name === 'escape') {
        handled(() => { surfacePluginKeyRef.current?.(key) })
        return true
      }
      // Tab is deliberately absent: the docked surfaces use it for their own
      // pane switching, so it must reach them rather than cycling panel tabs.
      const panelChord = key.name === 'escape'
        || (key.ctrl && (key.name === 'w' || key.name === 'n' || key.name === 'p' || key.name === 't'))
      if ((key.ctrl && key.name === 'e') || (!inputOwned && sequence === '=')) {
        handled(() => setSurfacePanelExpanded((current) => !current))
        return true
      }
      if (!inputOwned && ['<', '>', '+', '-', '_'].includes(sequence)) {
        const shrink = sequence === '<' || sequence === '-' || sequence === '_'
        handled(() => {
          if (surfacePanelAtBottom) {
            setSurfacePanelRows((current) => clamp(
              current + (shrink ? -SURFACE_PANEL_ROW_STEP : SURFACE_PANEL_ROW_STEP),
              SURFACE_PANEL_MIN_ROWS,
              surfacePanelMaxRows,
            ))
            return
          }
          setSurfacePanelWidth((current) => clamp(
            current + (shrink ? -SURFACE_PANEL_RESIZE_STEP : SURFACE_PANEL_RESIZE_STEP),
            SURFACE_PANEL_MIN_WIDTH,
            Math.min(SURFACE_PANEL_MAX_WIDTH, surfacePanelMaxWidth),
          ))
        })
        return true
      }
      if (!inputOwned && sequence === '|') {
        handled(() => toggleSurfacePanelPlacement())
        return true
      }
      // ⇧O closes a focused panel (its surfaces' inputs keep this chord, as
      // they always have; only the composer and modals now own a capital O).
      if (isShifted('O')) {
        handled(() => {
          setSurfacePanelOpen(false)
          setSurfacePanelFocused(false)
        })
        return true
      }
      if (inputOwned && !panelChord) return true
      handled(() => { surfacePanelKeyHandlerRef.current?.(key) })
      return true
    }

    if (pluginManagerOpen) {
      handled(() => { pluginManagerKeyHandlerRef.current?.(key) })
      return true
    }

    if (newSessionModalOpen) {
      handled(() => { newSessionKeyHandlerRef.current?.(key) })
      return true
    }

    if (handoffBriefOpen) {
      handled(() => { handoffBriefKeyHandlerRef.current?.(key) })
      return true
    }

    if (promptLibraryOpen) {
      handled(() => { promptLibraryKeyHandlerRef.current?.(key) })
      return true
    }

    // Reference card, not a picker: any key dismisses it rather than leaving
    // the user hunting for the one that does. Only when it was opened on
    // purpose — a self-revealed panel sits above a pending chord, and eating
    // that chord's next key would make hesitating change what the key does.
    if (chordHelp?.dismissOnKey) {
      handled(() => setChordHelp(null))
      return true
    }

    if (bookmarksOverlayOpen) {
      handled(() => {
        if (key.name === 'escape' || key.name === 'q' || isShifted('B') || isCtrl('c')) {
          setBookmarksOverlayOpen(false)
          return
        }
        if (bookmarksOverlay.length === 0) return
        if (key.name === 'j' || key.name === 'down') {
          setBookmarksOverlayIndex((i) => Math.min(i + 1, bookmarksOverlay.length - 1))
          return
        }
        if (key.name === 'k' || key.name === 'up') {
          setBookmarksOverlayIndex((i) => Math.max(i - 1, 0))
          return
        }
        if (key.name === 'return') {
          const record = bookmarksOverlay[bookmarksOverlayIndex]
          if (record) openBookmarkRecord(record)
        }
      })
      return true
    }

    if (attentionOpen) {
      handled(() => { attentionKeyHandlerRef.current?.(key) })
      return true
    }

    if (renameSessionKey) {
      if (key.name === 'escape') {
        handled(() => { setRenameSessionKey(null); setRenameDraft('') })
      } else if (key.name === 'return') {
        handled(commitRename)
      }
      return true
    }

    if (providerMenuOpen) {
      if (key.name === 'escape' || key.name === 'p') {
        handled(() => {
          closeProviderMenu()
        })
        return true
      }
      if (key.name === 'q' || isCtrl('c')) {
        handled(requestExit)
      }
      return true
    }

    if (modelPickerOpen) {
      if (key.name === 'escape' || isModelEffortShortcut) {
        handled(() => setModelPickerOpen(false))
        return true
      }
      if (
        key.name === 'tab'
        || (modelPickerFocus !== 'model' && (key.name === 'left' || key.name === 'right'))
      ) {
        handled(() => setModelPickerFocus((current) => {
          const order: ModelPickerFocus[] = ['model', 'effort', 'permissions']
          const direction = key.shift || key.name === 'left' ? -1 : 1
          return order[(order.indexOf(current) + direction + order.length) % order.length]!
        }))
        return true
      }
      if (modelPickerFocus === 'model' && (key.name === 'up' || key.name === 'down')) {
        handled(() => {
          setModelPickerIndex((current) => {
            const lastIndex = filteredModelPickerOptions.length - 1
            if (lastIndex < 0) return 0
            return key.name === 'up'
              ? Math.max(current - 1, 0)
              : Math.min(current + 1, lastIndex)
          })
        })
        return true
      }
      if (
        isCtrl('l')
        && modelPickerTarget?.provider === 'copilot'
        && (modelPickerOptions[modelPickerIndex]?.supportsLongContext ?? false)
      ) {
        handled(() => {
          const target = modelPickerTarget
          if (!target) return
          setTuiCopilotContextTierByKey((prev) => ({
            ...prev,
            [sessionKey(target)]: (prev[sessionKey(target)] ?? 'default') === 'long_context'
              ? 'default'
              : 'long_context',
          }))
        })
        return true
      }
      if ((modelPickerFocus !== 'model' && key.name === 'q') || isCtrl('c')) {
        handled(requestExit)
      }
      return true
    }

    if (themeMenuOpen) {
      if (key.name === 'left' || key.name === 'right') {
        handled(() => {
          const currentGroupIndex = THEME_GROUPS.findIndex((g) => g.key === themeMenuGroup)
          const nextGroupIndex = key.name === 'left'
            ? Math.max(currentGroupIndex - 1, 0)
            : Math.min(currentGroupIndex + 1, THEME_GROUPS.length - 1)
          const newGroup = THEME_GROUPS[nextGroupIndex].key
          setThemeMenuGroup(newGroup)
          const groupThemes = filterThemeModes(themeGroupModes(newGroup), themeMenuQuery)
          const origin = themeMenuOriginRef.current
          const target = (origin && groupThemes.includes(origin)) ? origin : groupThemes[0]
          if (target) {
            setThemeMenuIndex(THEMES.indexOf(target))
            setThemeMode(target)
          }
        })
        return true
      }
      if (key.name === 'up' || key.name === 'down') {
        handled(() => {
          const groupThemes = filterThemeModes(
            themeGroupModes(themeMenuGroup),
            themeMenuQuery,
          )
          if (groupThemes.length === 0) return
          const currentTheme = THEMES[themeMenuIndex]
          const currentLocalIndex = currentTheme ? groupThemes.indexOf(currentTheme) : -1
          const nextLocalIndex = key.name === 'up'
            ? Math.max((currentLocalIndex < 0 ? 0 : currentLocalIndex) - 1, 0)
            : Math.min((currentLocalIndex < 0 ? -1 : currentLocalIndex) + 1, groupThemes.length - 1)
          const target = groupThemes[nextLocalIndex]
          if (target) {
            setThemeMenuIndex(THEMES.indexOf(target))
            setThemeMode(target)
          }
        })
        return true
      }
      if (key.name === 'return') {
        handled(() => {
          const groupThemes = filterThemeModes(
            themeGroupModes(themeMenuGroup),
            themeMenuQuery,
          )
          const currentTheme = THEMES[themeMenuIndex]
          const target = currentTheme && groupThemes.includes(currentTheme) ? currentTheme : groupThemes[0]
          if (target) chooseTheme(target)
        })
        return true
      }
      if (key.name === 'escape') {
        handled(closeThemeMenu)
        return true
      }
      if (key.name === 'tab') {
        handled(toggleThemeFollowsTerminal)
        return true
      }
      if (isCtrl('c')) {
        handled(requestExit)
      }
      return true
    }

    if (transcriptViewMenuOpen) {
      if (key.name === 'escape' || (sequence === 'v' && !key.ctrl && !key.meta)) {
        handled(closeTranscriptViewMenu)
        return true
      }
      if (key.name === 'tab') {
        handled(toggleLightweightWindows)
        return true
      }
      if (key.name === 'q' || isCtrl('c')) {
        handled(requestExit)
      }
      return true
    }

    if (commandPaletteOpen) {
      if (key.name === 'escape' || sequence === '?') {
        handled(closeCommandPalette)
        return true
      }
      if (key.name === 'j' || key.name === 'down') {
        handled(() => setCommandPaletteIndex((i) => Math.min(i + 1, Math.max(0, filteredCommands.length - 1))))
        return true
      }
      if (key.name === 'k' || key.name === 'up') {
        handled(() => setCommandPaletteIndex((i) => Math.max(i - 1, 0)))
        return true
      }
      if (key.name === 'return') {
        handled(() => {
          const cmd = filteredCommands[commandPaletteIndex]
          if (cmd) executeCommandPalette(cmd.id)
        })
        return true
      }
      if (key.name === 'backspace' || key.name === 'delete') {
        handled(() => {
          setCommandPaletteQuery((q) => q.slice(0, -1))
          setCommandPaletteIndex(0)
        })
        return true
      }
      if (!key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ') {
        handled(() => {
          setCommandPaletteQuery((q) => q + sequence)
          setCommandPaletteIndex(0)
        })
        return true
      }
      return true
    }

    if (transcriptDiffDraft !== null) {
      if (key.name === 'escape') {
        handled(() => setTranscriptDiffDraft(null))
        return true
      }
      if ((key.ctrl && key.name === 's') || key.name === 'return') {
        handled(() => {
          const trimmed = transcriptDiffDraft.text.trim()
          setTranscriptDiffNotes((prev) => {
            const next = new Map(prev)
            if (transcriptDiffDraft.legacyAnchor) next.delete(transcriptDiffDraft.legacyAnchor)
            if (trimmed) next.set(transcriptDiffDraft.anchor, { range: transcriptDiffDraft.range, text: trimmed })
            else next.delete(transcriptDiffDraft.anchor)
            return next
          })
          setTranscriptDiffDraft(null)
        })
        return true
      }
      if (key.name === 'backspace' || key.name === 'delete') {
        handled(() => {
          setTranscriptDiffDraft((draft) => (draft ? { ...draft, text: draft.text.slice(0, -1) } : null))
        })
        return true
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
        handled(() => {
          setTranscriptDiffDraft((draft) => (draft ? { ...draft, text: draft.text + key.sequence } : null))
        })
        return true
      }
      return true
    }

    if (isModelEffortShortcut) {
      handled(() => { void openModelPicker() })
      return true
    }
  return false
}
