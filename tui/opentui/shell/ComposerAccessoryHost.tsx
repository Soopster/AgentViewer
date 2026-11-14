/** @jsxImportSource @opentui/react */
import type { SessionIdentity } from '../../../lib/sessionIdentity'
import { useDisabledPlugins } from '../../../lib/plugins/useDisabledPlugins'
import { ComposerAccessoryBoundary } from '../../../lib/plugins/ComposerAccessoryBoundary'
import type { ComposerAccessoryServices } from '../../../lib/plugins/composer'
import type { ComposerAccessoryController } from '../../../lib/plugins/composerHost'
import { tuiComposerPlugins, type TuiComposerAccessoryProps } from './composerPlugins'

function Failure({ error, retry }: { error: Error; retry: () => void }) { return <text onMouseDown={retry}>Composer plugin stopped: {error.message} · click to retry</text> }
export function ComposerAccessoryHost({ session, draft, disabled, visible, controller, isCurrent, services, theme, width, viewportWidth, height, marginLeft }: {
  session: (SessionIdentity & { cwd?: string }) | null; draft: string; disabled: boolean; visible: boolean; controller: ComposerAccessoryController; isCurrent: () => boolean; services: ComposerAccessoryServices
} & Pick<TuiComposerAccessoryProps, 'theme' | 'width' | 'viewportWidth' | 'height' | 'marginLeft'>) {
  const off = useDisabledPlugins()
  if (!session) return null
  return <>{tuiComposerPlugins.specs.filter(spec => !off.has(spec.pluginId)).map(spec => <ComposerAccessoryBoundary<TuiComposerAccessoryProps> key={spec.id}
    spec={spec} registry={tuiComposerPlugins} controller={controller} isCurrent={isCurrent} Failure={Failure}
    props={{ session, cwd: session.cwd, draft, disabled, visible, services, theme, width, viewportWidth, height, marginLeft, modalZIndex: 70 }} />)}</>
}
