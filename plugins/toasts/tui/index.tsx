/** @jsxImportSource @opentui/react */
import { PLUGIN_API_VERSION, type PluginWidgetModule } from '../../../lib/plugins/types'
import { ToastOverlay, useToasts, type TuiPluginWidget, type TuiPluginWidgetProps } from '../../../tui/opentui/shell/sdk'

function ToastWidget({ theme, width, height, zIndex }: TuiPluginWidgetProps) {
  const toasts = useToasts()
  return <ToastOverlay toasts={toasts} theme={theme} width={width} height={height} zIndex={zIndex} />
}
export const widgets: PluginWidgetModule<TuiPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'toasts', widgets: { toasts: ToastWidget } }
