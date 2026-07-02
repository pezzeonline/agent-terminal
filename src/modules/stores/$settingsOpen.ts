import { atom } from 'nanostores'

/**
 * Drives the Settings dialog's open/closed state. Toggled by the
 * "Settings…" app-menu item (via `useSettingsWiring`) and by the dialog's
 * own close affordances (Escape, backdrop click, close button).
 */
export const $settingsOpen = atom<boolean>(false)

export function openSettings(): void {
  $settingsOpen.set(true)
}

export function closeSettings(): void {
  $settingsOpen.set(false)
}
