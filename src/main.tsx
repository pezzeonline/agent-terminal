import React from 'react'
import ReactDOM from 'react-dom/client'
import { IPC } from '@/modules/ipc/commands'
import { startCwdPersist } from '@/modules/mods/cwd-persist'
import { startModListener } from '@/modules/mods/mod-listener'
import { startAgentStateNotifier } from '@/modules/notifications/agentStateNotifier'
import { initNavigation } from '@/modules/stores/$navigation'
import { $projects } from '@/modules/stores/$projects'
import { WorkspaceLayout } from '@/screens/workspace/WorkspaceLayout'
import type { Project } from '@/screens/workspace/workspace.types'
import '@xterm/xterm/css/xterm.css'
import './index.css'

async function bootstrap() {
  // Start MOD event listener before render so no events are missed.
  await startModListener()

  // Debounced CWD write-back: persists tab.lastCwd on every directory change.
  startCwdPersist()

  try {
    const saved = (await IPC.listProjects()) as Project[]
    if (saved.length > 0) {
      $projects.set(saved)
    }
  } catch {
    // No saved projects — start with empty state.
  }

  initNavigation()

  // Start agent-state notification service. Idempotent. Subscribes to
  // $tabMeta and posts OS notifications on awaiting/completed transitions.
  // Lazy permission request — does not prompt at startup.
  startAgentStateNotifier()

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <WorkspaceLayout />
    </React.StrictMode>,
  )
}

bootstrap()
