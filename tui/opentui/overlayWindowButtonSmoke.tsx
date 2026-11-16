/** @jsxImportSource @opentui/react */
// Every plugin popover gets the `⧉ window` button: a view that draws its own keeps exactly one, any other has the
// host's put on its top border, and a click offers the window placement.
import assert from 'node:assert/strict'
import { PluginSurfaceHost } from './shell/PluginSurfaceHost'
import { getPluginSurface, listPluginSurfaces } from '../../lib/plugins/catalog'
import { AUTO_DETACH_BUTTON_ID, DETACH_BUTTON_ID } from './shell/overlayDetach'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'

let detached = 0
const services = (id: string) => ({
  'chief-of-staff': { 'chief-of-staff': { read: async () => ({ repoRoot: '/p', rulesFile: '', session: null, rules: [], ruleList: [], problems: [], board: null, report: null }), start: async () => ({ sessionId: 's', provider: 'claude', created: true }), saveRules: async () => ({}) } },
} as Record<string, object>)[id] ?? {}

async function open(surfaceId: string) {
  const setup = await testRender(
    <box position="absolute" top={1} left={2} width={138} height={43} flexDirection="column">
      <box height={1} flexShrink={0}><text>header row above the host</text></box>
      <PluginSurfaceHost surfaceId={surfaceId as never} placement="overlay" cwd="/p" repositorySessionId={null} theme={DARK_THEME} width={140} height={44} focused
        provided={services(surfaceId) as never} onClose={() => {}} onDetach={() => { detached++ }} onKeyHandlerReady={() => {}} />
    </box>, { width: 140, height: 44 })
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); await setup.flush() }); await setup.flush() }
  for (let i = 0; i < 12; i++) await settle()
  return { setup, settle }
}

// A view with no button of its own: the host adds one, on the view's top border.
{
  const surface = getPluginSurface('chief-of-staff' as never)
  assert(surface.placements.includes('window'), 'precondition: it can be a window')
  const { setup, settle } = await open('chief-of-staff')
  const button = setup.renderer.root.findDescendantById(AUTO_DETACH_BUTTON_ID)
  assert(button, `the host drew the window button:\n${setup.captureCharFrame()}`)
  assert(setup.captureCharFrame().includes('⧉ window'), 'the button is painted')
  assert(!setup.renderer.root.findDescendantById(DETACH_BUTTON_ID), 'and it is the host\'s, not a second one')
  const title = setup.captureCharFrame().split('\n').findIndex(line => line.includes('CHIEF OF STAFF'))
  assert.equal(button.y, title - 1, 'it sits on the top border, the row above the title')
  await act(async () => { await setup.mockMouse.click(button.x + 1, button.y) }); await settle()
  assert.equal(detached, 1, 'clicking offers the window placement')
  setup.renderer.destroy?.()
}

// A view that already draws one is left with exactly that one; a full-screen view has no free border.
{
  const { readOverlayDetachAnchor } = await import('./shell/overlayDetach')
  const frame = { x: 10, y: 3, width: 80, height: 20 }
  const wrapper = (found: unknown, root = frame) => ({ x: 0, y: 0, width: 140, height: 44, getChildren: () => [root], findDescendantById: (id: string) => id === DETACH_BUTTON_ID ? found : null })
  assert.deepEqual(readOverlayDetachAnchor(wrapper(null), 140), { left: 10, top: 3, width: 80 }, 'a bare view is anchored to its frame')
  assert.equal(readOverlayDetachAnchor(wrapper({}), 140), null, 'a view with its own button gets no second')
  assert.equal(readOverlayDetachAnchor(wrapper(null, { ...frame, x: 0, width: 140 }), 140), null, 'a full-screen view is left to its own chrome')
  assert.equal(readOverlayDetachAnchor({ getChildren: () => [] }, 140), null, 'nothing drawn yet, nothing to anchor to')
  assert.deepEqual(readOverlayDetachAnchor({ ...wrapper(null), x: 2, y: 1 }, 140), { left: 8, top: 2, width: 80 }, 'a wrapper that is not at the screen origin does not shift the button off the border')
}

// No window placement, no button: a surface that cannot be a window is not offered one.
const noWindow = listPluginSurfaces('tui').filter(surface => !surface.placements.includes('window'))
for (const surface of noWindow) assert(!(surface.placements as readonly string[]).includes('window'))
console.log('overlayWindowButtonSmoke ok')
process.exit(0)
