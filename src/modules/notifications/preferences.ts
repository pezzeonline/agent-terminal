/**
 * Notification preferences — single global toggle for v1.
 *
 * Stored in localStorage so it survives reloads but is per-installation
 * (not synced across machines, not part of the saved-projects file).
 *
 * Defaults to enabled. Users disable explicitly via the (future) settings
 * panel; for v1 the toggle is settable programmatically and via the
 * exported helpers below.
 */

const ENABLED_KEY = 'agent-terminal:notifications:enabled'

export function notificationsEnabled(): boolean {
  // Default is true — user-visible behaviour out of the box matches the
  // primary value proposition (background agents pinging the user).
  return localStorage.getItem(ENABLED_KEY) !== 'false'
}

export function setNotificationsEnabled(value: boolean): void {
  localStorage.setItem(ENABLED_KEY, value ? 'true' : 'false')
}
