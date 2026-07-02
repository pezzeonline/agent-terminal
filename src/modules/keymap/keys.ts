/**
 * Canonical key names for `react-hotkeys-hook` v5+ binding strings.
 *
 * Why we don't use `ts-key-enum` (which the library docs reference): that
 * package enumerates `KeyboardEvent.key` values (`=`, `[`, `Enter`). The
 * library matches against `KeyboardEvent.code` normalized via this internal
 * function:
 *
 *     code.toLowerCase().replace(/key|digit|numpad/, '')
 *
 * So `KeyG` → `g`, `Digit0` → `0`, `Numpad1` → `1` — but `BracketLeft`,
 * `Equal`, `Minus` etc. stay as their lowercased event.code names because
 * the regex doesn't strip anything from them. Feeding the library a literal
 * `'='` or `'['` matches nothing and the hotkey silently no-ops.
 *
 * Naming convention here: **constant name = W3C `KeyboardEvent.code`**;
 * **value = library-normalized binding string**. So a future reader
 * reaches for `Keys.BracketRight` from looking at the W3C spec, gets back
 * the right string for react-hotkeys-hook, and never has to know about
 * the `K()` regex.
 *
 * If react-hotkeys-hook ever changes its normalization, this file is the
 * single point of update.
 */
export const Keys = {
  // Letters — `KeyT` → strip `key` → `t`
  A: 'a',
  B: 'b',
  C: 'c',
  D: 'd',
  E: 'e',
  F: 'f',
  G: 'g',
  H: 'h',
  I: 'i',
  J: 'j',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  O: 'o',
  P: 'p',
  Q: 'q',
  R: 'r',
  S: 's',
  T: 't',
  U: 'u',
  V: 'v',
  W: 'w',
  X: 'x',
  Y: 'y',
  Z: 'z',

  // Digits — `Digit0` → strip `digit` → `0`
  Digit0: '0',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',

  // Punctuation — event.code lowercased; the library's regex doesn't
  // touch these so they pass through verbatim.
  Equal: 'equal',
  Minus: 'minus',
  BracketLeft: 'bracketleft',
  BracketRight: 'bracketright',
  Backslash: 'backslash',
  Slash: 'slash',
  Comma: 'comma',
  Period: 'period',
  Semicolon: 'semicolon',
  Quote: 'quote',
  Backquote: 'backquote',

  // Whitespace / control
  Tab: 'tab',
  Enter: 'enter',
  Escape: 'escape',
  Space: 'space',
  Backspace: 'backspace',
  Delete: 'delete',

  // Arrows
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',

  // Function keys
  F1: 'f1',
  F2: 'f2',
  F3: 'f3',
  F4: 'f4',
  F5: 'f5',
  F6: 'f6',
  F7: 'f7',
  F8: 'f8',
  F9: 'f9',
  F10: 'f10',
  F11: 'f11',
  F12: 'f12',
} as const

export type KeyName = (typeof Keys)[keyof typeof Keys]

/**
 * Modifier names accepted by react-hotkeys-hook binding strings. Same
 * single-source-of-truth rationale as `Keys` — callsites compose
 * `${Mod.Meta}+${Keys.T}` instead of literal `"meta+t"` so the modifier
 * names are typed at every binding.
 */
export const Mod = {
  Meta: 'meta',
  Ctrl: 'ctrl',
  Alt: 'alt',
  Shift: 'shift',
} as const

export type ModName = (typeof Mod)[keyof typeof Mod]

/**
 * Produced-character tokens, for bindings that need `useKey: true` (match
 * `KeyboardEvent.key`) instead of the `Keys` above (which match
 * `KeyboardEvent.code`, i.e. physical position).
 *
 * Code-based matching assumes a US/ANSI layout for punctuation — `Cmd+=`
 * only lives at `code: "Equal"` there. On many non-US layouts (e.g.
 * Italian) '+' and '-' sit on entirely different physical keys, so a
 * code-based binding silently never fires. Font-size zoom is a "the + key"
 * concept, not a physical-position one, so it should match by character —
 * same as how browsers bind their own Cmd+/Cmd- zoom.
 *
 * Requires react-hotkeys-hook >=5.3.3 (see package.json) — 5.3.2 and
 * earlier match `useKey` combos *before* checking modifiers, so a lone
 * '+' keypress with no Cmd held would also fire.
 */
export const ProducedChars = {
  Equal: '=',
  Plus: '+',
  Minus: '-',
} as const
