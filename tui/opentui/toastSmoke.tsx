/** @jsxImportSource @opentui/react */

import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { ToastOverlay, useToasts } from './ToastOverlay'
import { beginProviderLoading, getLoadingProviders } from '../../lib/providerLoading'
import { toast, dismissAllToasts } from './toastStore'

function SmokeApp() {
  const toasts = useToasts()
  return <ToastOverlay toasts={toasts} theme={DARK_THEME} width={60} height={20} />
}

function assertFrameIncludes(frame: string, text: string): void {
  if (!frame.includes(text)) {
    throw new Error(`Expected toast frame to include "${text}"\n${frame}`)
  }
}

const setup = await testRender(<SmokeApp />, { width: 60, height: 20 })

try {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  // durationMs: 0 disables auto-dismiss so the test owns the toast lifecycle.
  await act(async () => {
    dismissAllToasts()
    toast.success('Copied to clipboard', { durationMs: 0 })
    toast.error('Send failed: network down', { durationMs: 0 })
    toast.info('New session created', { durationMs: 0 })
  })
  await setup.flush()

  const frame = setup.captureCharFrame()
  assertFrameIncludes(frame, 'Copied to clipboard')
  assertFrameIncludes(frame, 'Send failed')
  assertFrameIncludes(frame, 'New session created')

  let finishFirst!: () => void
  let finishSecond!: () => void
  await act(async () => {
    dismissAllToasts()
    finishFirst = beginProviderLoading('claude')
    finishSecond = beginProviderLoading('claude')
  })
  await setup.flush()
  assertFrameIncludes(setup.captureCharFrame(), 'Loading Claude…')
  const firstFrame = setup.captureCharFrame()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)) })
  await setup.flush()
  if (setup.captureCharFrame() === firstFrame) throw new Error('Loading spinner did not animate')
  await act(async () => { finishFirst(); finishFirst() })
  await setup.flush()
  assertFrameIncludes(setup.captureCharFrame(), 'Loading Claude…')
  await act(async () => { finishSecond() })
  await setup.flush()
  if (getLoadingProviders().length || setup.captureCharFrame().includes('Loading Claude')) {
    throw new Error('Loading toast remained after initialization')
  }
  console.log('toastSmoke OK — stacked toasts, animated startup, concurrent completion')
} finally {
  act(() => {
    dismissAllToasts()
    setup.renderer.destroy()
  })
}
