import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { listReviews, readReview, mutateReview } from '../lib/review/store'
import { reviewApplyShape, reviewReadProjection } from './agent-viewer-review-tools.mjs'
import type { ReviewOperation } from '../lib/review/types'

/** Provide the same local review operations to agents when only the terminal app is running. */
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    cwd: { type: 'string' }, source: { type: 'string' }, 'include-content': { type: 'boolean' },
    file: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } })
  const cwd = values.cwd ?? process.cwd()
  if (values.help || !positionals[0]) console.log(`agent-viewer review read --cwd <repo> [--source working|branch|turn:<sha>|pr:<number>] [--include-content]
agent-viewer review apply --file <request.json>

Read without --source to list reviews and live views. Apply accepts the review_apply MCP JSON shape:
{ "cwd": "...", "source": "working", "request_id": "stable-retry-id", "operation": { ... } }
Operations: note (revision, filePath, range, text), reply (noteId, text), decision (revision, hunkId, status, rationale), navigate (revision, viewId, target).
Read current IDs and revision before applying. A navigation is requested until a later read reports appliedAt.
Notes and replies are authored as agent; reply to human notes instead of editing them.`)
  else if (positionals[0] === 'read') console.log(JSON.stringify(values.source
    ? reviewReadProjection(await readReview(cwd, values.source), values['include-content'])
    : { reviews: await listReviews(cwd) }))
  else if (positionals[0] === 'apply') {
    if (!values.file) throw new Error('apply requires --file with a JSON request')
    const input = z.object(reviewApplyShape).parse(JSON.parse(await readFile(values.file, 'utf8')))
    const state = await mutateReview({ cwd: input.cwd ?? cwd, source: input.source, requestId: input.request_id,
      operation: { ...input.operation, ...(['note', 'reply'].includes(input.operation.type) ? { author: 'agent' } : {}) } as ReviewOperation })
    console.log(JSON.stringify(reviewReadProjection(state)))
  } else throw new Error('Expected read or apply; use --help')
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
