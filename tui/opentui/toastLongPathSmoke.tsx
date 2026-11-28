/** @jsxImportSource @opentui/react */
// A long message (the folder click's full path) is shown whole: on one row when
// the terminal is wide enough, wrapped onto more rows when it is not.
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { ToastOverlay, useToasts } from './ToastOverlay'
import { toast, dismissAllToasts } from './toastStore'

const PATH = '/Users/lukeryan/Documents/src/some/deeply/nested/project/agentViewer-worktree'

function SmokeApp({ width, height }: { width: number; height: number }) {
  return <ToastOverlay toasts={useToasts()} theme={DARK_THEME} width={width} height={height} />
}

for (const width of [120, 40]) {
  const setup = await testRender(<SmokeApp width={width} height={20} />, { width, height: 20 })
  try {
    await act(async () => { dismissAllToasts(); toast.info(PATH, { durationMs: 0 }); await setup.flush() })
    await setup.flush()
    const joined = setup.captureCharFrame().split('\n').map(row => row.replace(/[│╭╮╰╯─]/g, '').trim()).join('')
    const stripped = PATH.replace(/\s/g, '')
    if (!joined.replace(/\s/g, '').includes(stripped)) throw new Error(`Width ${width} did not show the whole path:\n${setup.captureCharFrame()}`)
  } finally { await act(async () => setup.renderer.destroy()) }
}
console.log('toastLongPathSmoke OK')
process.exit(0)
