import { NextResponse, type NextRequest } from 'next/server'
import {
  changesSinceCheckpoint, commitAllChanges, createReviewPullRequest, deleteUntrackedFile, diffSinceCheckpoint,
  listTurnCheckpoints, listWorkingDiffHunks, rejectWorkingHunk,
} from '@/lib/checkpoints'
import { restoreCheckpointForSession } from '@/lib/checkpointRestore'

// Turn checkpoints for the Web's checkpoints plugin (lib/checkpoints.ts; the
// TUI calls the same functions in process). GET reads, POST changes the tree.
// A mutation names something the server can see right now — a listed
// checkpoint, a current hunk, a current untracked file — never an arbitrary
// patch or path, so the route cannot be used to apply or delete anything else.

const fail = (error: unknown, status = 500) => NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status })

async function knownCheckpoint(cwd: string, sha: unknown): Promise<string | null> {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/.test(sha)) return null
  return (await listTurnCheckpoints(cwd)).some(checkpoint => checkpoint.sha === sha) ? sha : null
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const cwd = params.get('cwd')
  const action = params.get('action') ?? 'list'
  if (!cwd) return fail('cwd is required', 400)
  try {
    if (action === 'list') return NextResponse.json({ checkpoints: await listTurnCheckpoints(cwd) })
    if (action === 'working') return NextResponse.json(await listWorkingDiffHunks(cwd))
    const sha = await knownCheckpoint(cwd, params.get('sha'))
    if (!sha) return fail('unknown checkpoint', 404)
    if (action === 'changes') return NextResponse.json({ changes: await changesSinceCheckpoint(cwd, sha) })
    if (action === 'diff') {
      const until = params.get('until') ? await knownCheckpoint(cwd, params.get('until')) : undefined
      if (until === null) return fail('unknown checkpoint', 404)
      return NextResponse.json({ diff: await diffSinceCheckpoint(cwd, sha, params.get('file') ?? undefined, until) })
    }
    return fail(`unknown action ${action}`, 400)
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const cwd = typeof body?.cwd === 'string' ? body.cwd : null
  if (!body || !cwd) return fail('cwd is required', 400)
  try {
    switch (body.action) {
      case 'restore': {
        const sha = await knownCheckpoint(cwd, body.sha)
        if (!sha) return fail('unknown checkpoint', 404)
        const paths = Array.isArray(body.paths) ? body.paths.filter((entry): entry is string => typeof entry === 'string') : undefined
        if (paths) {
          const changed = new Set((await changesSinceCheckpoint(cwd, sha)).map(change => change.path))
          if (paths.some(entry => !changed.has(entry))) return fail('a path is not among the checkpoint\'s changes', 400)
        }
        const context = body.context && typeof body.context === 'object' ? body.context as { sessionId?: string; provider?: string; providerInstanceId?: string } : undefined
        return NextResponse.json(await restoreCheckpointForSession(cwd, sha, paths, context))
      }
      case 'reject-hunk': {
        const { hunks } = await listWorkingDiffHunks(cwd)
        if (typeof body.patchText !== 'string' || !hunks.some(hunk => hunk.patchText === body.patchText)) return fail('that hunk is no longer in the working diff', 409)
        await rejectWorkingHunk(cwd, body.patchText)
        return NextResponse.json({ ok: true })
      }
      case 'delete-untracked': {
        const { untracked } = await listWorkingDiffHunks(cwd)
        if (typeof body.path !== 'string' || !untracked.includes(body.path)) return fail('that file is not an untracked file here', 409)
        await deleteUntrackedFile(cwd, body.path)
        return NextResponse.json({ ok: true })
      }
      case 'commit': {
        if (typeof body.message !== 'string' || !body.message.trim()) return fail('a commit message is required', 400)
        return NextResponse.json({ sha: await commitAllChanges(cwd, body.message.trim()) })
      }
      case 'pull-request': {
        if (typeof body.title !== 'string' || !body.title.trim()) return fail('a title is required', 400)
        return NextResponse.json({ url: await createReviewPullRequest(cwd, body.title.trim()) })
      }
      default:
        return fail('unknown action', 400)
    }
  } catch (error) {
    return fail(error)
  }
}
