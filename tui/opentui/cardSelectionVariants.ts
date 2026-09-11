// Most cards are never selected. Keep the shared inputs alive once and create
// each selection element only when the reader actually needs that state.
const UNINITIALIZED = Symbol('uninitialized selection variant')

export class CardSelectionVariants<T> {
  private idleValue: T | typeof UNINITIALIZED = UNINITIALIZED
  private selectedValue: T | typeof UNINITIALIZED = UNINITIALIZED
  private focusedValue: T | typeof UNINITIALIZED = UNINITIALIZED

  constructor(
    readonly cardKey: string,
    private readonly render: (hasCursor: boolean, isSelected: boolean) => T,
  ) {}

  get idle(): T {
    if (this.idleValue === UNINITIALIZED) this.idleValue = this.render(false, false)
    return this.idleValue
  }

  get selected(): T {
    if (this.selectedValue === UNINITIALIZED) this.selectedValue = this.render(false, true)
    return this.selectedValue
  }

  get focused(): T {
    if (this.focusedValue === UNINITIALIZED) this.focusedValue = this.render(true, true)
    return this.focusedValue
  }
}
