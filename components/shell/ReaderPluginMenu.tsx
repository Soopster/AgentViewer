'use client'
import type { ReaderPluginBinding } from '../../lib/plugins/useReaderPlugins'
import { listPluginCommands } from '../../lib/plugins/catalog'
import { dispatchPluginCommand } from '../../lib/plugins/commandBus'
import { useDisabledPlugins } from '../../lib/plugins/useDisabledPlugins'

const commands = listPluginCommands('web').filter(command => command.webViewMenuLabel && command.webReader)
export function ReaderPluginMenu({ binding, onRun }: { binding: ReaderPluginBinding; onRun: () => void }) {
  const disabled = useDisabledPlugins()
  return <>{commands.filter(command => !disabled.has(command.pluginId)).map(command => {
    const presentation = binding.controller.presentation(command.webReader!)
    return <button key={command.id} type="button" className="av-hover-control" onClick={() => { dispatchPluginCommand(command.id); onRun() }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: presentation?.visible ? 'var(--amber)' : 'var(--text-2)', fontSize: 12, textAlign: 'left' }}>
      {command.webViewMenuLabel}{presentation?.count ? ` · ${presentation.count}` : ''}
    </button>
  })}</>
}
