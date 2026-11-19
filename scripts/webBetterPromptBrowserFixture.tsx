import React, { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { subscribePluginCommands } from '../lib/plugins/commandBus'
import { runSendMessage } from '../components/message-view/actions/sendMessage'
import { ComposerAccessoryHost } from '../components/shell/ComposerAccessoryHost'
import { useComposerAccessories } from '../lib/plugins/useComposerAccessories'
import { mergeComposerRewrite } from '../lib/plugins/composer'
import { applyPluginSettings, withPluginEnabled, readPluginSettings } from '../lib/plugins/enablement'

function Fixture() {
  const [draft, setDraft] = useState('Fix the crash')
  const [instance, setInstance] = useState('work')
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const current = useRef(draft); current.current = draft
  const accessory = useComposerAccessories('web', instance)
  useEffect(() => subscribePluginCommands((id, input) => id === 'better' && accessory.controller.open('better-prompt', input)), [accessory.controller])
  const session = useMemo(() => ({ provider: 'codex' as const, providerInstanceId: instance, sessionId: 'same', cwd: '/fixture/repo' }), [instance])
  const services = useMemo(() => ({ composer: {
    sendDraft() { throw new Error('Better must never send the draft') },
    stageDraft(text: string, original: string) { setDraft(mergeComposerRewrite(current.current, original, text)) },
  } }), [])
  return <main>
    <button onClick={() => { setInstance(value => value === 'work' ? 'personal' : 'work'); setDraft('Personal draft') }}>Switch account</button>
    <button onClick={() => { applyPluginSettings(withPluginEnabled(readPluginSettings(), 'better', !enabled)); setEnabled(!enabled) }}>{enabled ? 'Disable better' : 'Enable better'}</button>
    <button onClick={() => accessory.controller.open('better-prompt')}>Palette better</button>
    <textarea aria-label="Composer" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
      if (event.key === 'Escape') { if (accessory.controller.handleKey({ name: 'escape', sequence: '\u001b', ctrl: false, shift: false })) { event.preventDefault(); return } }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void runSendMessage({ session, setSendError: setError, textareaRef: { current: null }, inputTextRef: current } as Parameters<typeof runSendMessage>[0]) }
    }} />
    <output>{error}</output>
    <ComposerAccessoryHost key={instance} session={session} draft={draft} disabled={false} controller={accessory.controller} isCurrent={accessory.isCurrent} services={services} />
  </main>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
