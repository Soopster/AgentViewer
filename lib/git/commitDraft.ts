import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const directory = join(process.cwd(), '.agent-viewer-data', 'git-drafts')
function fileFor(cwd: string) { return join(directory, createHash('sha256').update(resolve(cwd)).digest('hex') + '.txt') }
export function readCommitDraft(cwd: string) { try { return readFileSync(fileFor(cwd), 'utf8') } catch { return '' } }
export function writeCommitDraft(cwd: string, message: string) {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const file = fileFor(cwd), temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, message, { mode: 0o600 }); renameSync(temporary, file)
  } catch { /* Draft persistence must not prevent editing a message. */ }
}
