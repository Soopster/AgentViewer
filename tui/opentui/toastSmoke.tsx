/** @jsxImportSource @opentui/react */
import { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { ToastOverlay, useToasts } from './ToastOverlay'
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

  console.log('toastSmoke OK — rendered 3 stacked toasts')
} finally {
  act(() => {
    dismissAllToasts()
    setup.renderer.destroy()
  })
}
