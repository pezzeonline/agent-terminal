import { describe, expect, test } from 'bun:test'
import {
  buildSwitcherRows,
  filterSwitcherRows,
  formatRelativeTime,
  type SwitcherRow,
} from '@/components/TabSwitcher/tab-switcher.helpers'
import type { Project } from '@/screens/workspace/workspace.types'

/* ---------------------------------------------------------------------------
 * Fixtures
 * -------------------------------------------------------------------------*/

function makeProjects(): Project[] {
  return [
    {
      id: 'agent',
      name: 'agent-terminal',
      path: '~/work/agent-terminal',
      pinned: false,
      tabs: [
        { id: 'dev', label: 'dev', cmd: '', pinned: false },
        { id: 'srv', label: 'server', cmd: '', pinned: false },
        { id: 'git', label: 'git status', cmd: '', pinned: false },
      ],
    },
    {
      id: 'cc',
      name: 'control-center',
      path: '~/cc',
      pinned: false,
      tabs: [
        { id: 'mem', label: 'memory', cmd: '', pinned: false },
        { id: 'docs', label: 'docs review', cmd: '', pinned: false },
      ],
    },
  ]
}

function build(
  recency: string[],
  opts: {
    recencyTimes?: Record<string, number>
    activeProjectId?: string
    activeTabIds?: Record<string, string>
    tabMeta?: Record<string, { cwd?: string }>
  } = {},
): SwitcherRow[] {
  return buildSwitcherRows({
    projects: makeProjects(),
    recency,
    recencyTimes: opts.recencyTimes ?? {},
    tabMeta: opts.tabMeta ?? {},
    activeProjectId: opts.activeProjectId ?? '',
    activeTabIds: opts.activeTabIds ?? {},
  })
}

/* ---------------------------------------------------------------------------
 * buildSwitcherRows
 * -------------------------------------------------------------------------*/

describe('buildSwitcherRows', () => {
  test('recency-listed tabs appear first in recency order with 1-based rank', () => {
    const rows = build(['cc:mem', 'agent:dev', 'agent:srv'])
    expect(rows.slice(0, 3).map((r) => r.tabKey)).toEqual([
      'cc:mem',
      'agent:dev',
      'agent:srv',
    ])
    expect(rows.slice(0, 3).map((r) => r.rank)).toEqual([1, 2, 3])
  })

  test('rank is uncapped — the 12th recent tab has rank 12', () => {
    // Recency list of 12 distinct keys; only the first 5 exist as tabs
    // in projects, but cap-checking the rank doesn't depend on tab
    // existence — verify by using a single recency list that aligns with
    // tabs in projects.
    const projects: Project[] = [
      {
        id: 'p',
        name: 'p',
        path: '~/p',
        pinned: false,
        tabs: Array.from({ length: 12 }, (_, i) => ({
          id: `t${i}`,
          label: `t${i}`,
          cmd: '',
          pinned: false,
        })),
      },
    ]
    const recency = Array.from({ length: 12 }, (_, i) => `p:t${i}`)
    const rows = buildSwitcherRows({
      projects,
      recency,
      recencyTimes: {},
      tabMeta: {},
      activeProjectId: '',
      activeTabIds: {},
    })
    expect(rows.length).toBe(12)
    expect(rows[11].rank).toBe(12)
    expect(rows[11].tabKey).toBe('p:t11')
  })

  test('never-visited tabs have rank 0 and appear after recency-listed ones', () => {
    const rows = build(['cc:mem'])
    // 1 recency-listed + 4 never-visited (dev, srv, git from agent, docs from cc)
    expect(rows.length).toBe(5)
    expect(rows[0]).toMatchObject({ tabKey: 'cc:mem', rank: 1 })
    // Rest are rank 0 and in sidebar order (project → tab declaration order)
    expect(rows.slice(1).map((r) => r.tabKey)).toEqual([
      'agent:dev',
      'agent:srv',
      'agent:git',
      'cc:docs',
    ])
    expect(rows.slice(1).every((r) => r.rank === 0)).toBe(true)
  })

  test('stale recency entries (no matching tab) are dropped silently', () => {
    const rows = build(['ghost:abc', 'agent:dev', 'also:stale'])
    expect(rows.find((r) => r.tabKey === 'ghost:abc')).toBeUndefined()
    expect(rows.find((r) => r.tabKey === 'also:stale')).toBeUndefined()
    // agent:dev still appears, but with rank 2 (its index in the
    // recency array) — we don't renumber to skip orphans.
    const dev = rows.find((r) => r.tabKey === 'agent:dev')
    expect(dev?.rank).toBe(2)
  })

  test('isCurrent is true only for the active project + tab pair', () => {
    const rows = build([], {
      activeProjectId: 'agent',
      activeTabIds: { agent: 'dev' },
    })
    expect(rows.find((r) => r.tabKey === 'agent:dev')?.isCurrent).toBe(true)
    expect(rows.find((r) => r.tabKey === 'agent:srv')?.isCurrent).toBe(false)
    // Tab id matching that of the active project's active tab but in a
    // different project does not count as current.
    expect(rows.find((r) => r.tabKey === 'cc:mem')?.isCurrent).toBe(false)
  })

  test('cwd is pulled from tabMeta when available', () => {
    const rows = build(['agent:dev'], {
      tabMeta: { 'agent:dev': { cwd: '/tmp/x' } },
    })
    expect(rows[0].cwd).toBe('/tmp/x')
  })

  test('lastActiveAt is forwarded from recencyTimes', () => {
    const rows = build(['agent:dev'], {
      recencyTimes: { 'agent:dev': 12345 },
    })
    expect(rows[0].lastActiveAt).toBe(12345)
    // never-visited tabs have undefined
    const docs = rows.find((r) => r.tabKey === 'cc:docs')
    expect(docs?.lastActiveAt).toBeUndefined()
  })
})

/* ---------------------------------------------------------------------------
 * filterSwitcherRows
 * -------------------------------------------------------------------------*/

const sampleRows: SwitcherRow[] = [
  {
    tabKey: 'agent:dev',
    projectId: 'agent',
    projectName: 'agent-terminal',
    tabId: 'dev',
    label: 'dev',
    cwd: '/tmp/agent',
    rank: 1,
    lastActiveAt: 0,
    isCurrent: false,
  },
  {
    tabKey: 'cc:mem',
    projectId: 'cc',
    projectName: 'control-center',
    tabId: 'mem',
    label: 'memory note',
    rank: 2,
    lastActiveAt: 0,
    isCurrent: false,
  },
  {
    tabKey: 'agent:srv',
    projectId: 'agent',
    projectName: 'agent-terminal',
    tabId: 'srv',
    label: 'server',
    cwd: '/srv',
    rank: 3,
    lastActiveAt: 0,
    isCurrent: false,
  },
]

describe('filterSwitcherRows', () => {
  test('empty query returns the input array reference', () => {
    expect(filterSwitcherRows(sampleRows, '')).toBe(sampleRows)
    expect(filterSwitcherRows(sampleRows, '   ')).toBe(sampleRows)
  })

  test('substring match on label', () => {
    const out = filterSwitcherRows(sampleRows, 'mem')
    expect(out.map((r) => r.tabKey)).toEqual(['cc:mem'])
  })

  test('substring match on project name', () => {
    const out = filterSwitcherRows(sampleRows, 'agent')
    expect(out.map((r) => r.tabKey)).toEqual(['agent:dev', 'agent:srv'])
  })

  test('substring match on cwd', () => {
    const out = filterSwitcherRows(sampleRows, '/srv')
    expect(out.map((r) => r.tabKey)).toEqual(['agent:srv'])
  })

  test('case-insensitive', () => {
    const out = filterSwitcherRows(sampleRows, 'MeMoRy')
    expect(out.map((r) => r.tabKey)).toEqual(['cc:mem'])
  })

  test('preserves the input order among matches (= recency)', () => {
    const out = filterSwitcherRows(sampleRows, 'agent')
    // Order in `sampleRows`: dev then srv. Filter preserves that, so
    // rank 1 still leads rank 3 even after filter.
    expect(out.map((r) => r.rank)).toEqual([1, 3])
  })
})

/* ---------------------------------------------------------------------------
 * formatRelativeTime
 * -------------------------------------------------------------------------*/

describe('formatRelativeTime', () => {
  const now = 1_000_000_000_000

  test('undefined → never', () => {
    expect(formatRelativeTime(now, undefined)).toBe('never')
  })

  test('< 10s → just now', () => {
    expect(formatRelativeTime(now, now - 5_000)).toBe('just now')
    expect(formatRelativeTime(now, now)).toBe('just now')
  })

  test('< 60s → Ns ago', () => {
    expect(formatRelativeTime(now, now - 15_000)).toBe('15s ago')
    expect(formatRelativeTime(now, now - 59_000)).toBe('59s ago')
  })

  test('< 60min → Nm ago', () => {
    expect(formatRelativeTime(now, now - 60_000)).toBe('1m ago')
    expect(formatRelativeTime(now, now - 59 * 60_000)).toBe('59m ago')
  })

  test('< 24h → Nh ago', () => {
    expect(formatRelativeTime(now, now - 60 * 60_000)).toBe('1h ago')
    expect(formatRelativeTime(now, now - 23 * 60 * 60_000)).toBe('23h ago')
  })

  test('exactly 1 day → yesterday', () => {
    expect(formatRelativeTime(now, now - 24 * 60 * 60_000)).toBe('yesterday')
    expect(formatRelativeTime(now, now - 47 * 60 * 60_000)).toBe('yesterday')
  })

  test('2..6 days → Nd ago', () => {
    expect(formatRelativeTime(now, now - 48 * 60 * 60_000)).toBe('2d ago')
    expect(formatRelativeTime(now, now - 6 * 24 * 60 * 60_000)).toBe('6d ago')
  })

  test('7..29 days → Nw ago', () => {
    expect(formatRelativeTime(now, now - 7 * 24 * 60 * 60_000)).toBe('1w ago')
    expect(formatRelativeTime(now, now - 21 * 24 * 60 * 60_000)).toBe('3w ago')
  })

  test('>= 30 days → Nmo ago', () => {
    expect(formatRelativeTime(now, now - 30 * 24 * 60 * 60_000)).toBe('1mo ago')
    expect(formatRelativeTime(now, now - 120 * 24 * 60 * 60_000)).toBe(
      '4mo ago',
    )
  })

  test('negative diff (then > now) clamps to just now', () => {
    expect(formatRelativeTime(now, now + 5_000)).toBe('just now')
  })
})
