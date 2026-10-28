// The Web host's diff toolkit, for plugin views that render or review diffs.
// Separate from the rest of components/shell so a view that draws no diff
// never pulls the Pierre renderers into its chunk.
export * from '../PierreDiffView'
export { ReviewBoard } from '../review/ReviewBoard'
export { DIFF_WORKER_POOL_OPTIONS } from '../pierreDiffWorker'
