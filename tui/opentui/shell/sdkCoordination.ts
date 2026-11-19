// The host's coordination state, for the coordination views (control center,
// teammates). The interactive coordinator store is host and domain code — it
// keeps a conversation's team observed and its notifications firing whether or
// not a view is open — so a view reads and acts on it here rather than owning
// it. Opening the store for a conversation stays the host's (it resolves the
// conversation); a view may close it, which is what its own Esc means.
// Separate from sdk.ts so a view that shows no team never names it.
export {
  closeInteractiveCoordinator,
  cycleInteractiveCoordinatorNotifications,
  discardInteractiveCoordinatorAction,
  getInteractiveCoordinatorState,
  readInteractiveCoordinatorTeardown,
  retryInteractiveCoordinatorAction,
  reviewInteractiveCoordinatorResult,
  reviewInteractiveCoordinatorResults,
  runInteractiveCoordinatorAction,
  subscribeInteractiveCoordinator,
  type InteractiveCoordinatorState,
  type InteractiveCoordinatorTeardown,
} from '../interactiveCoordinatorStore'
// A view may present another plugin's surface (the control center opens an
// agent's checkout in Git) through the host, never by importing that plugin.
export { PluginSurfaceHost } from './PluginSurfaceHost'
