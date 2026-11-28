// The two reviewers. Both are single-turn and see only the text handed to them:
// Claude through the viewer's tool-less one-shot query, Codex through
// `codex exec` run ephemeral and read-only in an empty directory, so the only
// code it can see is the diff in its prompt. The diff is another agent's text;
// nothing in it can make either call act.
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SECOND_OPINION_SCHEMA, type SecondOpinionReviewer } from './review'

export type ReviewerCall = (input: { prompt: string; model: string; signal: AbortSignal }) => Promise<unknown>

export const SECOND_OPINION_DEFAULT_MODELS: Record<SecondOpinionReviewer, string> = {
  claude: process.env.AGENT_VIEWER_SECOND_OPINION_CLAUDE_MODEL?.trim() || 'claude-opus-5-5',
  codex: process.env.AGENT_VIEWER_SECOND_OPINION_CODEX_MODEL?.trim() || '',
}

/** The Codex executable; a test points this at a fake. */
export const codexExecutable = () => process.env.AGENT_VIEWER_SECOND_OPINION_CODEX?.trim() || 'codex'

/** Raised when a reviewer's CLI is not installed, so the service can fall back to the other. */
export class ReviewerUnavailableError extends Error {}

const askClaude: ReviewerCall = async ({ prompt, model, signal }) => {
  const { runStructuredQuery, parseJsonObject } = await import('../oneShotLlm')
  const result = await runStructuredQuery({ prompt, schema: SECOND_OPINION_SCHEMA, model, signal })
  return result.structuredOutput ?? parseJsonObject(result.text)
}

/** argv for one review; exported so a smoke can pin exactly what is run. */
export function codexReviewArgs(schemaFile: string, outputFile: string, model: string): string[] {
  return [
    'exec',
    '--ephemeral',
    '--sandbox', 'read-only',
    '-c', 'approval_policy="never"',
    '--skip-git-repo-check',
    '--output-schema', schemaFile,
    '-o', outputFile,
    ...(model ? ['-m', model] : []),
    // The prompt arrives on stdin.
    '-',
  ]
}

const askCodex: ReviewerCall = async ({ prompt, model, signal }) => {
  // An empty directory: with nothing to read, the diff in the prompt is all it sees.
  const scratch = await mkdtemp(path.join(tmpdir(), 'agent-viewer-second-opinion-'))
  const workdir = path.join(scratch, 'work')
  const schemaFile = path.join(scratch, 'schema.json')
  const outputFile = path.join(scratch, 'reply.json')
  try {
    await import('node:fs/promises').then(fs => fs.mkdir(workdir))
    await writeFile(schemaFile, JSON.stringify(SECOND_OPINION_SCHEMA), 'utf8')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(codexExecutable(), codexReviewArgs(schemaFile, outputFile, model), {
        cwd: workdir, stdio: ['pipe', 'ignore', 'pipe'], shell: false,
      })
      let stderr = ''
      const abort = () => child.kill('SIGTERM')
      signal.addEventListener('abort', abort, { once: true })
      child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4000) })
      child.on('error', error => {
        signal.removeEventListener('abort', abort)
        reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? new ReviewerUnavailableError('Codex CLI is not installed') : error)
      })
      child.on('close', code => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) reject(new Error('The review was cancelled.'))
        else if (code === 0) resolve()
        else reject(new Error(`codex exec exited ${code}: ${stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400)}`))
      })
      child.stdin.end(prompt)
    })
    const reply = await readFile(outputFile, 'utf8')
    const { parseJsonObject } = await import('../oneShotLlm')
    return parseJsonObject(reply)
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => {})
  }
}

export const SECOND_OPINION_REVIEWER_CALLS: Record<SecondOpinionReviewer, ReviewerCall> = { claude: askClaude, codex: askCodex }
