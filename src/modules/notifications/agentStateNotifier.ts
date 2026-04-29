/**
 * Agent state notification service.
 *
 * Watches `$tabMeta` for transitions into notification-worthy states
 * (`awaiting`, `completed`, `error`) and posts native OS notifications via
 * the Rust `show_agent_notification` command.
 *
 * ## Agent-agnostic by design
 *
 * This module **deliberately knows nothing about specific agents**. It does
 * not import from `mods/claude_code` or `mods/codex`, never branches on
 * `agentId`, and has no `KNOWN_AGENT_IDS` constant. The display name shown
 * to the user comes straight from `meta.agentDisplayName`, which the
 * per-agent mod populated when it emitted `tab_type_changed`.
 *
 * Adding a new agent (Gemini, Aider, etc.) must work without touching this
 * file. The architecture lint test in
 * `src/modules/notifications/__tests__/architecture.test.ts` enforces this
 * by grepping for forbidden agent IDs in the module.
 *
 * ## Suppression rules (applied before firing)
 *
 * 1. Master toggle off → suppress everything.
 * 2. State isn't `awaiting` / `completed` / `error` → suppress (in-progress,
 *    idle, etc. don't generate notifications).
 * 3. The relevant tab is currently in focus inside agent-terminal AND the
 *    app window itself is focused → suppress (the user can already see the
 *    in-app badge change; an OS banner would be redundant).
 *
 * Other journey-specific behaviours documented inline.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  isPermissionGranted,
  requestPermission,
} from '@tauri-apps/plugin-notification'

import { $projects } from '@/modules/stores/$projects'
import {
  $activeProjectId,
  $activeTabId,
  navigateToTab,
} from '@/modules/stores/$navigation'
import { $tabMeta, type AgentTurnState, type TabMeta } from '@/modules/stores/$tabMeta'
import { notificationsEnabled } from './preferences'

// ─── Foreground tracking ─────────────────────────────────────────────────────

let appForeground = true
function isAppForeground(): boolean {
  return appForeground
}

async function startForegroundTracking(): Promise<void> {
  // The Tauri window-focus events fire on the webview side too; subscribe
  // here so we don't have to depend on listening from Rust.
  if (typeof document !== 'undefined') {
    appForeground = document.hasFocus()
    window.addEventListener('focus', () => {
      appForeground = true
    })
    window.addEventListener('blur', () => {
      appForeground = false
    })
  }
}

// ─── Transition detection ────────────────────────────────────────────────────

/** Last-notified state per tab — used to detect transitions, not to dedupe. */
const lastNotifiedState: Record<string, AgentTurnState | undefined> = {}

/** States that warrant a notification when a tab transitions INTO them. */
const NOTIFY_ON_ENTER: ReadonlySet<AgentTurnState> = new Set([
  'awaiting',
  'completed',
])
// Note: 'error' is technically in the AgentNotification.kind enum but not
// in AgentTurnState yet (no event source emits it today). When error
// detection lands (v2), add 'error' here.

function shouldFireFor(
  newState: AgentTurnState | undefined,
  prevState: AgentTurnState | undefined,
): boolean {
  if (!newState) return false
  if (newState === prevState) return false
  return NOTIFY_ON_ENTER.has(newState)
}

// ─── Suppression rules ───────────────────────────────────────────────────────

function shouldSuppress(projectId: string, tabId: string): boolean {
  if (!notificationsEnabled()) return true
  // Suppress when the user is already looking at this exact tab.
  const projectIsActive = $activeProjectId.get() === projectId
  const tabIsActive = $activeTabId.get()[projectId] === tabId
  if (isAppForeground() && projectIsActive && tabIsActive) return true
  return false
}

// ─── Permission handling (lazy) ──────────────────────────────────────────────

let permissionResolved = false
let permissionGranted = false

async function ensurePermission(): Promise<boolean> {
  if (permissionResolved) return permissionGranted
  let granted = await isPermissionGranted()
  if (!granted) {
    granted = (await requestPermission()) === 'granted'
  }
  permissionResolved = true
  permissionGranted = granted
  return granted
}

// ─── Project lookup ──────────────────────────────────────────────────────────

type ProjectLite = { id: string; name?: string; path?: string }

function findProjectForTab(tabId: string): ProjectLite | undefined {
  for (const project of $projects.get()) {
    if (project.tabs.some((t) => t.id === tabId)) {
      return project as ProjectLite
    }
  }
  return undefined
}

function projectDisplayName(project: ProjectLite): string {
  if (project.name && project.name.trim()) return project.name
  if (project.path) {
    const parts = project.path.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? project.path
  }
  return project.id
}

// ─── Body fallback per state ─────────────────────────────────────────────────

function bodyFor(state: AgentTurnState, meta: TabMeta): string {
  if (meta.agentMessage && meta.agentMessage.trim()) return meta.agentMessage
  switch (state) {
    case 'awaiting':
      return 'Needs your attention'
    case 'completed':
      return 'Turn complete'
    default:
      return ''
  }
}

// ─── Fire path ───────────────────────────────────────────────────────────────

async function fireNotification(
  projectId: string,
  tabId: string,
  state: AgentTurnState,
  meta: TabMeta,
): Promise<void> {
  const project = findProjectForTab(tabId)
  if (!project) return

  const granted = await ensurePermission()
  if (!granted) return

  // The display name is opaque data to us — populated by whichever
  // per-agent mod produced this tab. We never translate or look it up.
  const agentDisplayName = meta.agentDisplayName ?? 'Agent'
  const projectName = projectDisplayName(project)
  const title = `${agentDisplayName} · ${projectName}`
  const body = bodyFor(state, meta)

  await invoke('show_agent_notification', {
    payload: {
      tab_id: tabId,
      project_id: projectId,
      title,
      body,
      kind: state, // 'awaiting' | 'completed' (matches Rust NotificationKind)
    },
  }).catch((err) => {
    console.warn('[notifications] show_agent_notification failed:', err)
  })
}

// ─── Click handling ──────────────────────────────────────────────────────────

async function startClickHandling(): Promise<void> {
  await listen<{ project_id: string; tab_id: string }>(
    'notification:click',
    (event) => {
      const { project_id, tab_id } = event.payload
      if (!project_id || !tab_id) return
      navigateToTab(project_id, tab_id)
    },
  )
}

// ─── Entry point ─────────────────────────────────────────────────────────────

let started = false

/**
 * Wires the notification service. Idempotent — calling twice is a no-op.
 * Call once at app startup.
 */
export function startAgentStateNotifier(): void {
  if (started) return
  started = true

  // Foreground + click handling can both start eagerly.
  void startForegroundTracking()
  void startClickHandling()

  // Subscribe to TabMeta changes; check each tab for a notification-worthy
  // transition. We do not debounce: $tabMeta changes are infrequent enough
  // (only on hook events from the agent) and `shouldFireFor` already
  // guards against re-firing for the same state.
  $tabMeta.listen((all) => {
    for (const [tabId, meta] of Object.entries(all)) {
      if (meta.type !== 'agent') continue
      const newState = meta.agentState
      const prevState = lastNotifiedState[tabId]
      if (!shouldFireFor(newState, prevState)) {
        // Update lastNotifiedState even if we didn't fire so future
        // transitions are correctly detected.
        if (newState !== prevState) lastNotifiedState[tabId] = newState
        continue
      }

      const project = findProjectForTab(tabId)
      if (!project) continue

      lastNotifiedState[tabId] = newState

      if (shouldSuppress(project.id, tabId)) continue

      void fireNotification(project.id, tabId, newState as AgentTurnState, meta)
    }
  })
}
