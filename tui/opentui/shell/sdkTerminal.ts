// The host's process and shell services, for plugin views that show them (the
// Terminal plugin). The stores are host code: a process or shell they hold
// keeps running when its view closes, hides, or its plugin is turned off; a
// view only subscribes and asks. Separate from sdk.ts so a view that runs no
// process never loads the PTY bridge and terminal emulator behind them.
export {
  addProcess,
  clearProcessOutput,
  getProcesses,
  removeProcess,
  restartProcess,
  startProcess,
  stopProcess,
  subscribeProcesses,
  type ManagedProcess,
} from '../processStore'
export { closeShell, getShells, resizeShell, shellTerminal, startShell, subscribeShells, writeShell, type ShellSession } from '../shellStore'
export { useWindowSnapshot } from '../windowActivity'
