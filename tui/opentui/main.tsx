// TUI entry. React's production build is installed before anything imports
// React (see reactProduction.ts), so the app itself loads dynamically.
import './reactProduction'
import { scrubInheritedAgentIdentity } from '../../lib/inheritedIdentityEnv.mjs'

// `npm run tui` bypasses bin/agent-viewer.mjs, so this entry scrubs too.
scrubInheritedAgentIdentity()

await import('./start')
