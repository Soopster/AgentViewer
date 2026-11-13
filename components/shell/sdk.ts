// What a Web plugin view may import from the host besides components/ui and the
// heavier toolkits (sdkDiff, sdkCode). Light: no renderer or highlighter here.
export { isDocked, shouldIgnoreDockedKey, type SurfaceVariant } from '../surfaceVariant'
/** The Web's selection key for a session: rows, tabs and dashboards compare by it. */
export { sessionSelectionKey } from '../session-catalog/selectionKey'
