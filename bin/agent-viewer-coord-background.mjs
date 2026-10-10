// This wrapper gives startup failures an IPC result even when no identity or
// worker log could be created. It does not copy capability tokens to the parent.
{
  try {
    await import('./agent-viewer-coord-worker.mjs')
  } catch (error) {
    if (process.connected) {
      await new Promise((resolve) => process.send({
        type: 'coordinator-worker-startup-error', error: error instanceof Error ? error.message : String(error),
      }, resolve))
      if (process.connected) process.disconnect()
    }
    process.exit(1)
  }
}
