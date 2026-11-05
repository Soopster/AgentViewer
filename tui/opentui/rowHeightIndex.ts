/** Mutable Fenwick index for variable-height terminal rows. Layout updates and
 * offset lookups are logarithmic; scroll events never scan the document. */
export class RowHeightIndex {
  private heights: number[]
  private tree: number[]
  constructor(heights: readonly number[]) {
    this.heights = heights.map(height => RowHeightIndex.valid(height))
    this.tree = Array(heights.length + 1).fill(0)
    for (let index = 0; index < this.heights.length; index++) {
      this.tree[index + 1] += this.heights[index]!
      const parent = index + 1 + ((index + 1) & -(index + 1))
      if (parent < this.tree.length) this.tree[parent] += this.tree[index + 1]!
    }
  }
  private static valid(height: number) { return Number.isFinite(height) ? Math.max(1, Math.ceil(height)) : 1 }
  get length() { return this.heights.length }
  get total() { return this.offset(this.length) }
  height(index: number) { return this.heights[index] ?? 0 }
  offset(end: number) {
    let sum = 0
    for (let i = Math.max(0, Math.min(Math.floor(end), this.length)); i > 0; i -= i & -i) sum += this.tree[i]!
    return sum
  }
  update(index: number, height: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) return 0
    const next = RowHeightIndex.valid(height)
    const delta = next - this.heights[index]!
    this.heights[index] = next
    for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i] += delta
    return delta
  }
  /** First row whose end lies beyond offset; length at/beyond the end. */
  at(offset: number) {
    if (offset < 0) return 0
    let index = 0
    let sum = 0
    let step = 1
    while (step * 2 < this.tree.length) step *= 2
    for (; step; step = Math.floor(step / 2)) {
      const next = index + step
      if (next < this.tree.length && sum + this.tree[next]! <= offset) {
        index = next
        sum += this.tree[next]!
      }
    }
    return index
  }
  window(top: number, height: number, overscan = Math.max(8, height)) {
    const start = Math.min(this.length, this.at(Math.max(0, top - overscan)))
    const end = Math.min(this.length, Math.max(start, this.at(Math.max(0, top + height + overscan)) + 1))
    return { start, end, before: this.offset(start), after: this.total - this.offset(end) }
  }
}
