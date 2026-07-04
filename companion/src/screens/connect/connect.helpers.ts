export function normaliseWssUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return trimmed
  }
  return `ws://${trimmed}`
}

export function looksLikeUuid(token: string): boolean {
  return /^[0-9a-f-]{32,40}$/i.test(token.trim())
}
