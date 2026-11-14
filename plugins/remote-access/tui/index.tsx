/** @jsxImportSource @opentui/react */
// TUI entry for Remote access: turn pairing on or off, show a scannable code
// for a phone, and list and revoke paired devices — against the running daemon
// (pairing is with the server a phone can reach). Keys: e on/off, p new code,
// r read-only code, j/k select a device, x revoke it, X revoke all, c copy URL.
import { useCallback, useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { remotePairingUrl, type RemoteAccessAction, type RemoteAccessView } from '../../../lib/plugins/remoteAccess'
import { fitText, MODAL_CONTENT_Z_INDEX, popoverFrameCells, popoverRootProps, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'

function RemoteAccess({ services, theme, accent, width, height, placement, registerKeys, close }: TuiPluginViewProps) {
  const service = services['remote-access']
  const [state, setState] = useState<RemoteAccessView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState<string>('')
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!service) return undefined
    const controller = new AbortController()
    service.read(controller.signal).then(next => { if (!controller.signal.aborted) setState(next) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => controller.abort()
  }, [service])
  const url = state ? remotePairingUrl(state) : null
  useEffect(() => {
    if (!url) { setQr(''); return }
    let live = true
    // qrcode's utf8 renderer throws on an odd margin.
    void import('qrcode').then(({ default: qrcode }) => qrcode.toString(url, { type: 'utf8', margin: 2 }))
      .then(text => { if (live) setQr(text) }, () => { if (live) setQr('') })
    return () => { live = false }
  }, [url])
  const act = useCallback(async (request: RemoteAccessAction) => {
    if (!service) return
    setBusy(true); setError(null)
    try { setState(await service.act(request)) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }, [service])

  const devices = state?.sessions ?? []
  useEffect(() => {
    registerKeys((key) => {
      if (key.name === 'escape' || key.sequence === 'q') { close(); return true }
      if (busy) return true
      if (key.sequence === 'e') { void act({ action: state?.enabled ? 'disable' : 'enable' }); return true }
      if (key.sequence === 'p') { void act({ action: 'pair', scope: 'full' }); return true }
      if (key.sequence === 'r') { void act({ action: 'pair', scope: 'read-only' }); return true }
      if (key.name === 'down' || key.sequence === 'j') { setCursor(value => Math.min(value + 1, Math.max(devices.length - 1, 0))); return true }
      if (key.name === 'up' || key.sequence === 'k') { setCursor(value => Math.max(value - 1, 0)); return true }
      if (key.sequence === 'x' && devices[cursor]) { void act({ action: 'revoke', sessionId: devices[cursor]!.id }); return true }
      if (key.sequence === 'X' && devices.length) { void act({ action: 'revoke-all' }); return true }
      if (key.sequence === 'c' && url && services.clipboard) { void services.clipboard.write(url).then(() => services.notices?.show('info', 'Pairing URL copied')); return true }
      return placement === 'overlay'
    })
    return () => registerKeys(null)
  })

  const docked = placement !== 'overlay'
  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 96)
  const popH = docked ? height : Math.min(height - 2, 40)
  const innerW = popW - frame - 2
  const qrLines = qr ? qr.replace(/\n$/, '').split('\n') : []
  const expires = state?.pairing ? Math.max(0, Math.round((Date.parse(state.pairing.expiresAt) - Date.now()) / 60_000)) : 0
  return (
    <box id="remote-access" {...popoverRootProps(docked, { top: Math.max(Math.floor((height - popH) / 2), 0), left: Math.max(Math.floor((width - popW) / 2), 0), width: popW, height: popH }, MODAL_CONTENT_Z_INDEX)}
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface} flexDirection="column" title={docked ? undefined : ' Remote access '} titleColor={accent}>
      <box paddingX={1} backgroundColor={theme.surface2}>
        <text wrapMode="none">
          <span fg={state?.enabled ? theme.green : theme.dim}>{state ? (state.enabled ? '● on' : '○ off') : '…'}</span>
          <span fg={theme.dim}>{fitText(`  ${service?.daemonUrl ?? ''}${busy ? '  working…' : ''}`, innerW - 6)}</span>
        </text>
      </box>
      <scrollbox height={Math.max(popH - frame - 2, 3)} scrollY backgroundColor={theme.surface}>
        <box paddingX={1} flexDirection="column">
          {!service ? <text fg={theme.dim}>This host offers no remote-access service.</text> : null}
          {error ? <text fg={theme.red} wrapMode="word" width={innerW}>{error}</text> : null}
          {state && !state.enabled ? <text fg={theme.muted} wrapMode="word" width={innerW}>Remote access is off. Press e to turn it on and show a pairing code for a phone on your network.</text> : null}
          {state?.enabled && url ? [
            <text key="scope" fg={theme.muted}>{`Scan with a phone (${state.pairing!.scope}, single use, expires in ${expires}m):`}</text>,
            ...qrLines.map((line, index) => <text key={`qr${index}`} fg={theme.text} wrapMode="none">{line}</text>),
            <text key="url" fg={theme.cyan} wrapMode="word" width={innerW}>{url}</text>,
          ] : state?.enabled ? <text fg={theme.muted}>No live code. Press p for one (r for read-only).</text> : null}
          {state ? <text fg={theme.cyan}>{`┄ PAIRED DEVICES · ${devices.length}`}</text> : null}
          {devices.map((device, index) => (
            <box key={device.id} id={`remote-device:${device.id}`} backgroundColor={index === cursor ? theme.surface3 : theme.surface} onMouseDown={() => setCursor(index)}>
              <text fg={index === cursor ? theme.text : theme.muted} wrapMode="none" selectable={false}>{fitText(`${index === cursor ? '▎' : ' '}${device.label} · ${device.scope} · last seen ${device.lastSeenAt ?? 'never'}`, innerW)}</text>
            </box>
          ))}
        </box>
      </scrollbox>
      <box paddingX={1} backgroundColor={theme.surface2}>
        <text fg={theme.dim} wrapMode="none">{fitText('e on/off · p code · r read-only code · c copy · j/k · x revoke · X revoke all · esc', innerW)}</text>
      </box>
    </box>
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'remote-access',
  views: { 'remote-access': RemoteAccess },
}
