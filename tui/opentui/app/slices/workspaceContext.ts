/** @jsxImportSource @opentui/react */
import { useRef, useState, useSyncExternalStore } from 'react'
import { toast } from '../../toastStore'
import { useWorkspaceContext, useWorkspaceState, workspaceStorageKey } from '../../workspaceContext'
import { readComposerDraft, readComposerDraftParts } from '../../../../lib/tuiComposerState'

export function useWorkspaceContextGroup() {
  const workspaceContext = useWorkspaceContext()!
  const workspaceId = workspaceContext.runtime.workspace.id
  const workspaceCwd = workspaceContext.space.cwd
  const spacesState = useSyncExternalStore(workspaceContext.controller.subscribe, workspaceContext.controller.getSnapshot, workspaceContext.controller.getSnapshot)
  const workspacesEnabled = spacesState.workspacesEnabled !== false
  const toggleWorkspaces = () => {
    const next = !workspacesEnabled
    workspaceContext.controller.setWorkspacesEnabled(next)
    if (!next) { setSpacesMenuOpen(false); setWorkspaceLaunched(true) }
    toast.info(`Workspaces ${next ? 'enabled' : 'disabled'}`)
  }
  const [workspaceLaunched, setWorkspaceLaunched] = useWorkspaceState('workspaceLaunched', false)
  const [workspaceHasSession, setWorkspaceHasSession] = useWorkspaceState('workspaceHasSession', false)
  const [spacesMenuOpen, setSpacesMenuOpen] = useState(false)
  const [spacesMenuSelection, setSpacesMenuSelection] = useState<string | undefined>()
  const [spacesCloseId, setSpacesCloseId] = useState<string | undefined>()
  const spacesKeyRef = useRef<((key: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => boolean) | null>(null)
  const openSpaces = (id?: string, close = false) => {
    if (!workspacesEnabled) { toast.info('Enable workspaces with Ctrl+B, Shift+W'); return }
    setSpacesMenuSelection(id)
    setSpacesCloseId(close ? id : undefined)
    setSpacesMenuOpen(true)
  }
  const [allProjects, setAllProjects] = useWorkspaceState('allProjects', false)
  const draftKey = (key: string) => workspaceStorageKey(workspaceId, key)
  const readWorkspaceDraft = (key: string) => {
    const value = workspaceContext.runtime.values.get(`draft:${key}`)
    return typeof value === 'string' ? value : readComposerDraft(draftKey(key)) || (workspaceContext.runtime.values.get('legacyInitialWorkspace') === true ? readComposerDraft(key) : '')
  }
  const writeWorkspaceDraft = (key: string, text: string) => {
    workspaceContext.runtime.persistent.add(`draft:${key}`)
    workspaceContext.runtime.set(`draft:${key}`, text)
  }
  const readWorkspaceDraftParts = (key: string): unknown[] => {
    const existing = workspaceContext.runtime.values.get(`draftparts:${key}`)
    if (Array.isArray(existing)) return existing
    const parts = readComposerDraftParts(draftKey(key))
    return parts.length || workspaceContext.runtime.values.get('legacyInitialWorkspace') !== true ? parts : readComposerDraftParts(key)
  }
  const writeWorkspaceDraftParts = (key: string, parts: unknown[]) => {
    workspaceContext.runtime.persistent.add(`draftparts:${key}`)
    workspaceContext.runtime.set(`draftparts:${key}`, parts)
  }

  return {
    workspaceContext, workspaceId, workspaceCwd, spacesState, workspacesEnabled, toggleWorkspaces,
    workspaceLaunched, setWorkspaceLaunched, workspaceHasSession, setWorkspaceHasSession,
    spacesMenuOpen, setSpacesMenuOpen, spacesMenuSelection, spacesCloseId, spacesKeyRef,
    openSpaces, allProjects, setAllProjects, readWorkspaceDraft, writeWorkspaceDraft,
    readWorkspaceDraftParts, writeWorkspaceDraftParts,
  }
}
