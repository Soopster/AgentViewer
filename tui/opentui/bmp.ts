// Strip non-BMP (astral-plane) codepoints and variation selectors. Terminal
// renderers truncate/choke on them, and they are a documented Windows render
// hazard (see CLAUDE.md BMP-safe-glyph rule). Shared by the native OSC writers
// in App.tsx (notifications, terminal title, clipboard) and the in-TUI toast
// store, so the sanitizing rule lives in exactly one place.
export function toBmpSafe(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp > 0xffff) continue // astral plane: emoji, etc.
    if (cp === 0xfe0e || cp === 0xfe0f) continue // variation selectors
    out += ch
  }
  return out
}
