import { atom, computed } from 'nanostores'
import type { XTermHandle } from '@/components/XTermTerminal/XTermTerminal'
import { $activeProjectId, $activeTabId } from '@/modules/stores/$navigation'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'

/**
 * Registry of every mounted terminal pane's xterm handle, keyed by
 * `${projectId}:${tabId}`. Populated on TerminalPane mount, cleared on
 * unmount. NOT a record of which pane is "active" — that question is
 * answered by `$activeTabKey` below, which composes the navigation
 * stores. Keeping registration mount-scoped means the registry contains
 * every live PTY, which is the correct surface for addressing a specific
 * tab by id (e.g. notification-driven focus, cross-tab snippet send).
 */
export const $terminalHandles = atom<Map<string, XTermHandle>>(new Map())

/**
 * Authoritative `${projectId}:${tabId}` of the currently active terminal,
 * derived from navigation state. Cannot be written; cannot drift from
 * the navigation stores. Returns null when no project / tab is selected.
 */
export const $activeTabKey = computed(
  [$activeProjectId, $activeTabId],
  (projectId, activeTabsByProject) => {
    const tabId = activeTabsByProject[projectId]
    if (!projectId || !tabId) return null
    return makeTabKey(projectId, tabId)
  },
)

/** Add or replace a handle in the registry, keyed by tab. */
export function registerTerminalHandle(
  tabKey: string,
  handle: XTermHandle,
): void {
  const next = new Map($terminalHandles.get())
  next.set(tabKey, handle)
  $terminalHandles.set(next)
}

/**
 * Remove a handle from the registry. Race-safe: only deletes the slot if
 * the recorded handle still matches the one being unregistered. Without
 * the identity guard a remount could overwrite the slot before the old
 * pane's cleanup runs, and the cleanup would wipe the new pane's handle.
 */
export function unregisterTerminalHandle(
  tabKey: string,
  handle: XTermHandle,
): void {
  const current = $terminalHandles.get().get(tabKey)
  if (current !== handle) return
  const next = new Map($terminalHandles.get())
  next.delete(tabKey)
  $terminalHandles.set(next)
}

/**
 * Snapshot lookup of the active terminal's handle. Composes the derived
 * `$activeTabKey` with the registry. Use from event handlers (hotkeys,
 * drag-drop) that need the value at the moment the event fires.
 */
export function getActiveTerminalHandle(): XTermHandle | null {
  const key = $activeTabKey.get()
  if (!key) return null
  return $terminalHandles.get().get(key) ?? null
}
