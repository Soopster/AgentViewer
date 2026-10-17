/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentProvider } from '../../lib/types'
import type { PlaybookSummary } from '../../lib/agentProtocol'
import type { InteractiveWorkflowPreview } from '../../lib/agentCoordination'
import { workflowArguments, workflowPreviewLines } from '../../lib/coordinatorWorkflow'
import { listTuiRunPlaybooks, previewTuiInteractiveWorkflow } from '../../lib/tui/service'
import { runInteractiveCoordinatorAction } from './interactiveCoordinatorStore'
import type { TuiThemePalette } from '../theme'
import { MODAL_CONTENT_Z_INDEX } from './layers'

type Key = { name: string; sequence: string; ctrl: boolean; shift: boolean }
export function CoordinatorWorkflow({ cwd, provider, theme, width, height, onClose, onKeyHandlerReady }: {
  cwd: string; provider: AgentProvider; theme: TuiThemePalette; width: number; height: number
  onClose: () => void; onKeyHandlerReady: (handler: (key: Key) => void) => void
}) {
  const [recipes, setRecipes] = useState<PlaybookSummary[]>([])
  const [index, setIndex] = useState(0)
  const [args, setArgs] = useState('')
  const [editing, setEditing] = useState(false)
  const [preview, setPreview] = useState<InteractiveWorkflowPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    let disposed = false
    void listTuiRunPlaybooks(cwd).then(data => { if (!disposed) setRecipes(data.playbooks) }).catch(error => { if (!disposed) setError(String(error)) })
    return () => { disposed = true }
  }, [cwd])
  const recipe = recipes[index]
  const rows = Math.max(3, height - 10)
  const inner = Math.max(12, width - 8)
  const lines = useMemo(() => (preview ? workflowPreviewLines(preview) : [
    recipe ? `/${recipe.name} · ${recipe.taskCount} tasks` : 'No saved workflows in this project.',
    recipe?.description ?? '', recipe?.argsHint ?? 'Arguments can be plain text or JSON.',
    `Arguments: ${args}${editing ? '▏' : ''}`,
    'Preview the roles, providers, paths, dependencies and gates before starting.',
    'Finish existing tasks first. This conversation stays lead.',
  ]).flatMap(line => line.split('\n').flatMap(part => part.match(new RegExp(`.{1,${inner}}`, 'gu')) ?? [''])), [preview, recipe, args, editing, inner])
  const top = Math.min(offset, Math.max(0, lines.length - rows))
  const handleKey = useCallback((key: Key) => {
    if (busy) return
    if (editing) {
      if (key.name === 'escape' || key.name === 'return') { setEditing(false); return }
      if (key.name === 'backspace') setArgs(value => Array.from(value).slice(0, -1).join(''))
      else if (key.name === 'paste' || (!key.ctrl && key.sequence && Array.from(key.sequence).length === 1)) setArgs(value => (value + key.sequence).slice(0, 8000))
      return
    }
    if (key.name === 'escape') { if (preview) { setPreview(null); setOffset(0) } else onClose(); return }
    if (preview) {
      if (key.name === 'j' || key.name === 'down') setOffset(value => value + 1)
      if (key.name === 'k' || key.name === 'up') setOffset(value => Math.max(0, value - 1))
      if (key.name === 'pagedown') setOffset(value => value + rows)
      if (key.name === 'pageup') setOffset(value => Math.max(0, value - rows))
      if (key.name === 's') {
        setBusy(true)
        void runInteractiveCoordinatorAction({ action: 'start-workflow', detail: `Start workflow ${preview.playbook.name}`, playbook: preview.playbook, workflowArgs: preview.args }).then(() => onClose()).finally(() => setBusy(false))
      }
      return
    }
    if (key.name === 'j' || key.name === 'down') setIndex(value => Math.min(recipes.length - 1, value + 1))
    if (key.name === 'k' || key.name === 'up') setIndex(value => Math.max(0, value - 1))
    if (key.name === 'a') setEditing(true)
    if (key.name === 'return' && recipe) {
      setBusy(true); setError('')
      void Promise.resolve().then(() => previewTuiInteractiveWorkflow(cwd, recipe.name, provider, workflowArguments(args)))
        .then(setPreview).catch(error => setError(String(error))).finally(() => setBusy(false))
    }
  }, [busy, editing, preview, recipe, recipes.length, rows, cwd, provider, args, onClose])
  useEffect(() => onKeyHandlerReady(handleKey), [handleKey, onKeyHandlerReady])
  return <box position="absolute" left={2} top={2} width={width - 4} height={height - 4} border borderStyle="single" borderColor={theme.border2} backgroundColor={theme.surface} zIndex={MODAL_CONTENT_Z_INDEX} flexDirection="column" title=" Team workflow ">
    <box flexDirection="column" height={rows} paddingX={1}>{lines.slice(top, top + rows).map((line, index) => <text key={top + index} fg={theme.text} wrapMode="none">{line}</text>)}</box>
    <text fg={theme.red} wrapMode="word">{error}</text>
    <text fg={theme.dim} wrapMode="word">{busy ? 'Working…' : editing ? 'Enter finish args · Esc finish args' : preview ? 's start team · j/k scroll · Esc back' : 'j/k recipe · a args · Enter preview · Esc back'}</text>
  </box>
}
