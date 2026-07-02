import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { openSettings } from '@/modules/stores/$settingsOpen'

/**
 * Wires the renderer side of the Settings flow: listens for the
 * "Settings…" app-menu item's `menu:open-settings` event and opens the
 * Settings dialog in response.
 */
export function useSettingsWiring(): void {
  useEffect(() => {
    const unlistenPromise = listen('menu:open-settings', () => {
      openSettings()
    })
    return () => {
      unlistenPromise.then((fn) => fn()).catch(() => {})
    }
  }, [])
}
