'use client'
import type { SessionIdentity } from '../../lib/sessionIdentity'
import { useDisabledPlugins } from '../../lib/plugins/useDisabledPlugins'
import { ComposerAccessoryBoundary } from '../../lib/plugins/ComposerAccessoryBoundary'
import type { ComposerAccessoryServices } from '../../lib/plugins/composer'
import type { ComposerAccessoryController } from '../../lib/plugins/composerHost'
import { webComposerPlugins } from './composerPlugins'

function Failure({ error, retry }: { error: Error; retry: () => void }) { return <div role="alert">Composer plugin stopped: {error.message} <button type="button" onClick={retry}>Retry</button></div> }
export function ComposerAccessoryHost({ session, draft, disabled, controller, isCurrent, services }: {
  session: (SessionIdentity & { cwd?: string }) | null; draft: string; disabled: boolean; controller: ComposerAccessoryController; isCurrent: () => boolean; services: ComposerAccessoryServices
}) {
  const off = useDisabledPlugins()
  if (!session) return null
  return <div data-plugin-composer-slot style={{ maxHeight: 160, overflowY: 'auto' }}>
    {webComposerPlugins.specs.filter(spec => !off.has(spec.pluginId)).map(spec => <ComposerAccessoryBoundary key={spec.id}
      spec={spec} registry={webComposerPlugins} controller={controller} isCurrent={isCurrent} Failure={Failure}
      props={{ session, cwd: session.cwd, draft, disabled, visible: true, services }} />)}
  </div>
}
