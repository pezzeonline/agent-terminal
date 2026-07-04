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

export type ValidatedInputs =
  | { kind: 'ok'; url: string; token: string }
  | { kind: 'error'; message: string }

export function validateInputs(url: string, token: string): ValidatedInputs {
  const normalisedUrl = normaliseWssUrl(url)
  const trimmedToken = token.trim()
  if (!normalisedUrl) return { kind: 'error', message: 'WSS URL is required' }
  if (!trimmedToken) return { kind: 'error', message: 'Token is required' }
  return { kind: 'ok', url: normalisedUrl, token: trimmedToken }
}

export function connectErrorMessage(
  status: string,
  error: string | null,
  validationError: string | null,
): string | null {
  if (validationError) return validationError
  if (status === 'auth_failed' && error) return `Auth failed, ${error}`
  if (status === 'unreachable') {
    return error
      ? `Server not reachable, ${error}`
      : 'Server not reachable. Check the URL and your Wi-Fi.'
  }
  return null
}
