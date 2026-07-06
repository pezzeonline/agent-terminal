const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 30_000

export function computeBackoffDelay(attempt: number): number {
  const raw = BACKOFF_MIN_MS * 2 ** attempt
  return Math.min(raw, BACKOFF_MAX_MS)
}
