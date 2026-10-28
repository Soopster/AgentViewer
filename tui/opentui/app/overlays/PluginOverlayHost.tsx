/** @jsxImportSource @opentui/react */
import type { SyntaxStyle } from '@opentui/core'
import type { TuiThemePalette } from '../../../theme'
import { PluginSurfaceHost } from '../../shell/PluginSurfaceHost'
import { type TuiProvidedPluginServices } from '../../shell/pluginTypes'
import { type PluginSurfaceId } from '../../../../lib/plugins/catalog'
import { type WindowSurfaceKind } from '../../windowSurfaceNames'
import { type ThreadedMessage } from '../../../../lib/threading'
import { type TuiDensity } from '../../../theme'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { type Session } from '../../../../lib/types'
import { sessionKey } from '../sessionList'
import { type WindowSurfaceId } from '../SplitTranscriptPane'

type PluginOverlayHostProps = {
  pluginOverlay: 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'terminal' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk' | null
  pluginSessionFor: (surfaceId: PluginSurfaceId, slot?: WindowSurfaceId) => Session | null
  pluginSelectedDetail: { key: string | null; detail: TuiSessionDetail | null; }
  pluginLiveTranscript: { key: string | null; messages: ThreadedMessage[]; }
  pluginOpenRequests: Partial<Record<'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'terminal' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk', { count: number; session: Session | null; }>>
  density: TuiDensity
  showToolCalls: boolean
  splitPaneShouldYield: () => boolean
  gitRepoCwd: string
  gitSessionId: string | null
  pluginServicesFor: (surfaceId: PluginSurfaceId) => TuiProvidedPluginServices
  handoffBriefSyntaxStyle: SyntaxStyle
  editorInitialPath: string | null
  editorInitialLine: number | null
  checkpointFocusPrompt: { sessionId: string; text: string; timestamp?: string; } | null
  runCommandForPlugin: (id: string) => boolean
  theme: TuiThemePalette
  composerAccentColor: string
  width: number
  height: number
  closePluginOverlay: () => void
  offerPopoverPlacement: (kind: WindowSurfaceKind) => void
  registerPluginOverlayKeys: (handler: (key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean | void) => void
}

export function PluginOverlayHost(props: PluginOverlayHostProps) {
  const {
    pluginOverlay, pluginSessionFor, pluginSelectedDetail, pluginLiveTranscript,
    pluginOpenRequests, density, showToolCalls, splitPaneShouldYield, gitRepoCwd, gitSessionId,
    pluginServicesFor, handoffBriefSyntaxStyle, editorInitialPath, editorInitialLine,
    checkpointFocusPrompt, runCommandForPlugin, theme, composerAccentColor, width, height,
    closePluginOverlay, offerPopoverPlacement, registerPluginOverlayKeys,
  } = props
  return (
    pluginOverlay ? (
        <PluginSurfaceHost
          surfaceId={pluginOverlay}
          placement="overlay"
          session={pluginSessionFor(pluginOverlay)}
          sessionKey={pluginSessionFor(pluginOverlay) ? sessionKey(pluginSessionFor(pluginOverlay)!) : null}
          selected={pluginSelectedDetail}
          live={pluginLiveTranscript}
          request={pluginOpenRequests[pluginOverlay]?.count}
          density={density}
          showToolCalls={showToolCalls}
          shouldYield={splitPaneShouldYield}
          cwd={gitRepoCwd}
          repositorySessionId={gitSessionId}
          provided={pluginServicesFor(pluginOverlay)}
          syntaxStyle={handoffBriefSyntaxStyle}
          path={editorInitialPath}
          line={editorInitialLine}
          turn={pluginOverlay === 'checkpoints' ? checkpointFocusPrompt : null}
          runCommand={runCommandForPlugin}
          theme={theme}
          accent={composerAccentColor}
          width={width}
          height={height}
          focused
          // The control center is a modal: the root's modal scrim dims behind it.
          scrim={pluginOverlay !== 'coordination'}
          onClose={closePluginOverlay}
          onDetach={() => offerPopoverPlacement(pluginOverlay)}
          onKeyHandlerReady={registerPluginOverlayKeys}
        />
      ) : null
  )
}
