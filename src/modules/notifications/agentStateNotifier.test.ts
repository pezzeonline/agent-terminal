import { mock } from 'bun:test'

// ─── Mocks (must come before any module imports) ─────────────────────────────

// Capture every show_agent_notification invocation. The test asserts on these.
const invocations: Array<{ command: string; args: unknown }> = []
const invokeMock = mock((command: string, args?: unknown) => {
  invocations.push({ command, args })
  return Promise.resolve()
})
mock.module('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

// Skip event subscription side-effects.
mock.module('@tauri-apps/api/event', () => ({
  listen: mock(() => Promise.resolve(() => {})),
}))

// Always-granted permission so notifications fire in the test.
mock.module('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: mock(() => Promise.resolve(true)),
  requestPermission: mock(() => Promise.resolve('granted')),
}))

// Stable enabled toggle.
mock.module('@/modules/notifications/preferences', () => ({
  notificationsEnabled: mock(() => true),
}))

// IPC mock for navigation.ts (it imports invoke too via tauri-apps/api/core
// already mocked above — but its commands wrapper imports a separate path).
mock.module('@/modules/ipc/commands', () => ({
  IPC: {
    saveProjects: mock(() => Promise.resolve()),
    closeTab: mock(() => Promise.resolve()),
    openTab: mock(() => Promise.resolve(true)),
    writePty: mock(() => Promise.resolve()),
    resizePty: mock(() => Promise.resolve()),
    listProjects: mock(() => Promise.resolve([])),
  },
}))

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { startAgentStateNotifier } from '@/modules/notifications/agentStateNotifier'
import { $tabMeta, updateTabMeta } from '@/modules/stores/$tabMeta'
import { $projects } from '@/modules/stores/$projects'
import { $activeProjectId, $activeTabId } from '@/modules/stores/$navigation'
import type { Project } from '@/screens/workspace/workspace.types'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TAB_ID = 'tab-test'
const PROJECT_ID = 'proj-test'
const PROJECT: Project = {
  id: PROJECT_ID,
  name: 'My Project',
  path: '~/work/my-project',
  pinned: false,
  tabs: [{ id: TAB_ID, label: 'agent', cmd: 'claude', pinned: false }],
}

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  invocations.length = 0
  $tabMeta.set({})
  $projects.set([PROJECT])
  $activeProjectId.set('')
  $activeTabId.set({})
  // Notifier is idempotent — calling once across tests is fine, but we
  // re-call to be explicit. Internal `started` flag prevents duplicate
  // listeners.
  startAgentStateNotifier()
})

afterEach(() => {
  $tabMeta.set({})
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('agentStateNotifier — basic transitions', () => {
  test('fires on transition into awaiting', async () => {
    updateTabMeta(TAB_ID, {
      type: 'agent',
      agentId: 'claude-code',
      agentDisplayName: 'Claude Code',
    })
    invocations.length = 0
    updateTabMeta(TAB_ID, { agentState: 'awaiting', agentMessage: 'Approve cmd?' })
    await flushMicrotasks()

    const fires = invocations.filter((i) => i.command === 'show_agent_notification')
    expect(fires.length).toBe(1)
    const payload = (fires[0]!.args as { payload: Record<string, unknown> })
      .payload
    expect(payload.kind).toBe('awaiting')
    expect(payload.title).toBe('Claude Code · My Project')
    expect(payload.body).toBe('Approve cmd?')
    expect(payload.tab_id).toBe(TAB_ID)
    expect(payload.project_id).toBe(PROJECT_ID)
  })

  test('fires on transition into completed', async () => {
    updateTabMeta(TAB_ID, {
      type: 'agent',
      agentId: 'claude-code',
      agentDisplayName: 'Claude Code',
    })
    invocations.length = 0
    updateTabMeta(TAB_ID, { agentState: 'completed', agentMessage: 'Done.' })
    await flushMicrotasks()

    const fires = invocations.filter((i) => i.command === 'show_agent_notification')
    expect(fires.length).toBe(1)
    const payload = (fires[0]!.args as { payload: Record<string, unknown> })
      .payload
    expect(payload.kind).toBe('completed')
    expect(payload.body).toBe('Done.')
  })

  test('does not fire on in-progress', async () => {
    updateTabMeta(TAB_ID, {
      type: 'agent',
      agentId: 'claude-code',
      agentDisplayName: 'Claude Code',
    })
    invocations.length = 0
    updateTabMeta(TAB_ID, { agentState: 'in-progress' })
    await flushMicrotasks()

    const fires = invocations.filter((i) => i.command === 'show_agent_notification')
    expect(fires.length).toBe(0)
  })

  test('does not refire when same state arrives again', async () => {
    updateTabMeta(TAB_ID, {
      type: 'agent',
      agentId: 'claude-code',
      agentDisplayName: 'Claude Code',
    })
    updateTabMeta(TAB_ID, { agentState: 'awaiting', agentMessage: 'q' })
    await flushMicrotasks()
    invocations.length = 0
    // Same state, different message — the transition is a no-op.
    updateTabMeta(TAB_ID, { agentState: 'awaiting', agentMessage: 'q' })
    await flushMicrotasks()

    const fires = invocations.filter((i) => i.command === 'show_agent_notification')
    expect(fires.length).toBe(0)
  })
})

describe('agentStateNotifier — agent-agnosticism', () => {
  test('fires correctly for an agent the notifier has never heard of', async () => {
    // The whole point: a future GeminiMod / AiderMod / made-up-agent must
    // produce notifications without any code change here. The display name
    // flows on the event.
    updateTabMeta(TAB_ID, {
      type: 'agent',
      agentId: 'made-up-agent',
      agentDisplayName: 'Totally Fictional Agent',
    })
    invocations.length = 0
    updateTabMeta(TAB_ID, {
      agentState: 'awaiting',
      agentMessage: 'Approve weird thing?',
    })
    await flushMicrotasks()

    const fires = invocations.filter((i) => i.command === 'show_agent_notification')
    expect(fires.length).toBe(1)
    const payload = (fires[0]!.args as { payload: Record<string, unknown> })
      .payload
    expect(payload.title).toBe('Totally Fictional Agent · My Project')
    expect(payload.body).toBe('Approve weird thing?')
  })

  test('falls back to "Agent" when display name missing (no opaque lookup table)', async () => {
    updateTabMeta(TAB_ID, {
      type: 'agent',
      agentId: 'something-broken',
      // agentDisplayName intentionally missing
    })
    invocations.length = 0
    updateTabMeta(TAB_ID, { agentState: 'completed', agentMessage: 'ok' })
    await flushMicrotasks()

    const fires = invocations.filter((i) => i.command === 'show_agent_notification')
    expect(fires.length).toBe(1)
    const payload = (fires[0]!.args as { payload: Record<string, unknown> })
      .payload
    expect(payload.title).toBe('Agent · My Project')
  })
})

describe('agentStateNotifier — suppression', () => {
  test('suppresses when the relevant tab is active in foreground', async () => {
    // Simulate window-focused state by monkey-patching document.hasFocus.
    // The notifier captures appForeground via window focus/blur listeners
    // on startup; for this test we set both prerequisites true.
    $activeProjectId.set(PROJECT_ID)
    $activeTabId.set({ [PROJECT_ID]: TAB_ID })
    // Foreground state defaults to true in test env.

    updateTabMeta(TAB_ID, {
      type: 'agent',
      agentId: 'claude-code',
      agentDisplayName: 'Claude Code',
    })
    invocations.length = 0
    updateTabMeta(TAB_ID, { agentState: 'awaiting', agentMessage: 'q' })
    await flushMicrotasks()

    const fires = invocations.filter((i) => i.command === 'show_agent_notification')
    expect(fires.length).toBe(0)
  })

  test('fires when a different tab is active', async () => {
    $activeProjectId.set(PROJECT_ID)
    $activeTabId.set({ [PROJECT_ID]: 'some-other-tab' })

    updateTabMeta(TAB_ID, {
      type: 'agent',
      agentId: 'claude-code',
      agentDisplayName: 'Claude Code',
    })
    invocations.length = 0
    updateTabMeta(TAB_ID, { agentState: 'awaiting', agentMessage: 'q' })
    await flushMicrotasks()

    const fires = invocations.filter((i) => i.command === 'show_agent_notification')
    expect(fires.length).toBe(1)
  })
})

describe('agentStateNotifier — body fallbacks', () => {
  test('uses fallback string when agentMessage missing', async () => {
    updateTabMeta(TAB_ID, {
      type: 'agent',
      agentId: 'claude-code',
      agentDisplayName: 'Claude Code',
    })
    invocations.length = 0
    updateTabMeta(TAB_ID, { agentState: 'completed' })
    await flushMicrotasks()

    const fires = invocations.filter((i) => i.command === 'show_agent_notification')
    expect(fires.length).toBe(1)
    const payload = (fires[0]!.args as { payload: Record<string, unknown> })
      .payload
    expect(payload.body).toBe('Turn complete')
  })

  test('uses fallback string for awaiting when message empty', async () => {
    updateTabMeta(TAB_ID, {
      type: 'agent',
      agentId: 'claude-code',
      agentDisplayName: 'Claude Code',
    })
    invocations.length = 0
    updateTabMeta(TAB_ID, { agentState: 'awaiting', agentMessage: '   ' })
    await flushMicrotasks()

    const fires = invocations.filter((i) => i.command === 'show_agent_notification')
    expect(fires.length).toBe(1)
    const payload = (fires[0]!.args as { payload: Record<string, unknown> })
      .payload
    expect(payload.body).toBe('Needs your attention')
  })
})
