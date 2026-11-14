import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComposerAccessoryProps } from '../../lib/plugins/composer'
import type { PluginCommandInput } from '../../lib/plugins/commands'
import type { SessionIdentity } from '../../lib/sessionIdentity'
import type { BetterResult } from '../../lib/promptResearch'
import type { BetterProgress } from '../../lib/plugins/betterProgress'
export type BetterRunner = (session: SessionIdentity & { cwd?: string }, draft: string, signal: AbortSignal, onProgress?: (progress: BetterProgress) => void) => Promise<BetterResult>

/** Jobs, animation and two live rows belong to the accessory, never the shell. */
export function useBetterPrompt(props: ComposerAccessoryProps, run: BetterRunner) {
  const [open, setOpen] = useState(false), [input, setInput] = useState(''), [original, setOriginal] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<BetterProgress | null>(null), [now, setNow] = useState(Date.now())
  const [notice, setNotice] = useState<string | null>(null)
  const job = useRef<AbortController | null>(null), handled = useRef(0)
  const latestDraft = useRef(props.draft); latestDraft.current = props.draft
  const show = useCallback(() => {
    if (job.current) return
    setOriginal(latestDraft.current); setInput(latestDraft.current.replace(/^\s*\/better(?=\s|$)\s*/i, ''))
    setError(null); setNotice(null); setOpen(true)
  }, [])
  const dismiss = useCallback(() => { setNotice(null); setError(null) }, [])
  const cancel = useCallback(() => {
    job.current?.abort(); job.current = null; setBusy(false); setOpen(false); setError(null)
    setNotice('Better cancelled; nothing was sent.')
  }, [])
  const start = useCallback(async (draft: string, source: string) => {
    if (job.current || props.signal.aborted) return
    const controller = new AbortController(); job.current = controller
    const signal = AbortSignal.any([controller.signal, props.signal])
    setBusy(true); setError(null); setNotice(null); setOpen(false); setNow(Date.now())
    setProgress({ stage: 0, tools: [], total: 0, failed: 0, startedAt: Date.now() })
    try {
      props.services.composer?.stageDraft?.('', source)
      latestDraft.current = ''
      const next = await run({ ...props.session, cwd: props.cwd }, draft, signal, value => {
        if (!signal.aborted && job.current === controller) { setProgress(value); setNow(Date.now()) }
      })
      if (signal.aborted || job.current !== controller) return
      if (!props.services.composer?.stageDraft) throw new Error('This host cannot stage rewritten prompts.')
      const changed = Boolean(latestDraft.current.trim())
      props.services.composer.stageDraft(next.prompt, '')
      setNotice(`The improved prompt is in your input box. Edit it, then press Enter to send.${changed ? ' Your newer text is preserved below it.' : ''}`)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      if (!signal.aborted && job.current === controller) { props.services.composer?.stageDraft?.(draft, ''); setError(error instanceof Error ? error.message : 'Could not improve the prompt') }
    } finally {
      if (job.current === controller) { job.current = null; if (!props.signal.aborted) setBusy(false) }
    }
  }, [props.signal, props.session, props.cwd, props.services.composer, run])
  useEffect(() => {
    if (props.openRequest <= handled.current) return
    handled.current = props.openRequest
    const request: PluginCommandInput | undefined = props.invocation
    if (request?.slash) void start(request.slash.arguments, request.slash.draft)
    else show()
  }, [props.openRequest, props.invocation, start, show])
  useEffect(() => () => { job.current?.abort() }, [props.signal])
  useEffect(() => {
    if (!busy || !props.visible) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [busy, props.visible])
  useEffect(() => {
    props.report({ rows: props.visible ? busy || notice?.startsWith('The improved prompt') ? 2 : notice || error ? 1 : 0 : 0, modal: props.visible && open, backgroundKeys: busy && props.visible, summary: busy ? 'Researching a better prompt' : notice })
  }, [props.report, props.visible, open, busy, notice, error])
  const generate = useCallback(() => start(input, original), [start, input, original])
  useEffect(() => {
    props.registerKeys(key => {
      if (key.name === 'escape' && (job.current || open)) { cancel(); return true }
      if (!open) return false
      if (key.ctrl && key.name === 'return') { void generate(); return true }
      return 'input'
    })
    return () => props.registerKeys(null)
  }, [props.registerKeys, busy, open, cancel, generate])
  return { open, show, cancel, dismiss, input, setInput, busy, error, progress, now, notice, generate }
}
