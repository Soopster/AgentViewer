// Session model + context-usage reads.
//
// This used to own a Worker of its own. That bought isolation from a read that
// can block for over a second (the Agent SDK's getContextUsage), but a Bun
// Worker is a whole JS VM: it re-imported the entire provider graph — every
// SDK the read path can reach — to return two scalars, ~95MB of RSS for a
// model badge and a context gauge.
//
// The work now runs in the transcript worker, which already holds that graph.
// The isolation survives the move because the read is I/O-bound: it awaits a
// provider round-trip and yields the worker's event loop immediately, so it
// interleaves with a detail read instead of queueing behind one. (That is what
// separates it from a `warm` prefetch, which is CPU-bound and *does* have to
// stay off the critical path.)
//
// The module stays as the name callers import, so a future change of mind about
// where this runs is one file.
export {
  readTuiSessionMetadataAsync,
  type TuiSessionMetadataResult,
} from './threadingWorkerClient'
