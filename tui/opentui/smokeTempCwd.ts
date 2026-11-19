// Imported first by a smoke that also imports modules reading `.agent-viewer-data`
// at load: a static import is evaluated before any statement in the smoke, so a
// chdir written there runs too late and the smoke reads (and could write) the
// developer's own TUI state.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-smoke-')))
