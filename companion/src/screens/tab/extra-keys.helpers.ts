export const SEQ = {
  esc: '\x1b',
  tab: '\t',
  slash: '/',
  dash: '-',
  home: '\x1b[H',
  end: '\x1b[F',
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  arrowUp: '\x1b[A',
  arrowDown: '\x1b[B',
  arrowLeft: '\x1b[D',
  arrowRight: '\x1b[C',
} as const

export function applyCtrl(input: string): string {
  if (input.length !== 1) return input
  const code = input.charCodeAt(0)
  return String.fromCharCode(code & 0x1f)
}

export function applyAlt(input: string): string {
  return `\x1b${input}`
}
