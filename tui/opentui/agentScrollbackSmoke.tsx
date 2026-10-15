import { createTestRenderer } from '@opentui/core/testing'
import { appendAssistantReplyToScrollback } from './agentScrollback'

const setup = await createTestRenderer({
  width: 48,
  height: 12,
  screenMode: 'split-footer',
  footerHeight: 12,
  externalOutputMode: 'capture-stdout',
})

try {
  appendAssistantReplyToScrollback(setup.renderer, '[Assistant reply]\nA completed response that wraps across the terminal width.')
  const output = setup.externalOutput.takeText()
  if (!output.includes('[Assistant reply]') || !output.includes('A completed response')) {
    throw new Error(`Assistant output was not committed to terminal scrollback: ${JSON.stringify(output)}`)
  }
  if (setup.renderer.screenMode !== 'split-footer') {
    throw new Error('Assistant scrollback changed the renderer out of split-footer mode')
  }
} finally {
  await setup.dispose()
}

console.log('agent scrollback smoke passed')
