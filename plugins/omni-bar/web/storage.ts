import { createLayoutStore } from '../layout'

const KEY = 'agentViewer:omniBarLayout'

/** The Web keeps its own layout in the browser; reads and writes tolerate storage being unavailable. */
export const omniLayoutStore = createLayoutStore({
  read: () => { try { return JSON.parse(window.localStorage.getItem(KEY) ?? 'null') } catch { return null } },
  write: layout => { try { window.localStorage.setItem(KEY, JSON.stringify(layout)) } catch { /* private window */ } },
})
