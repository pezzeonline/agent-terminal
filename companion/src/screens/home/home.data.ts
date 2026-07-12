import { useStore } from '@nanostores/react'
import { $session } from '@/modules/stores/$session'
import { disconnect } from '@/modules/wss/client'

export function useHomeData() {
  const session = useStore($session)
  return {
    session,
    isPaired: session.status === 'connected',
    projectCount: session.projects.length,
    // Includes sleeping tabs (tabs defined in projects.json but not
    // currently spawned). Matches the desktop sidebar's "defined" count.
    tabCount: session.projects.reduce((n, p) => n + p.tabs.length, 0),
    disconnect,
  }
}
