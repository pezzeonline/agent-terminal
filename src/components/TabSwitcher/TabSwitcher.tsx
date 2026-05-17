import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { TabStatusIcon } from '@/components/TabStatusIcon'
import {
  buildSwitcherRows,
  filterSwitcherRows,
  formatRelativeTime,
  type SwitcherRow,
} from '@/components/TabSwitcher/tab-switcher.helpers'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Keys, Mod } from '@/modules/keymap/keys'
import {
  $activeProjectId,
  $activeTabId,
  navigateToTab,
} from '@/modules/stores/$navigation'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { $tabRecency, $tabRecencyTimes } from '@/modules/stores/$tabRecency'
import { cwdBasename, MONO_FONT } from '@/screens/workspace/workspace.helpers'

/* ---------------------------------------------------------------------------
 * TabSwitcher — Cmd+P quick-switch palette.
 *
 * Lists every open tab sorted by recency. Fuzzy-filterable by typing into
 * the search input (label + project name + cwd). Enter switches to the
 * selected tab. Rank shown for every visited tab — no cap, unlike the
 * sidebar's 1..10 ambient badge.
 * -------------------------------------------------------------------------*/

// Owns its own open state and Cmd+P hotkey so consumers (WorkspaceLayout)
// can just render `<TabSwitcher />`. Keeps `WorkspaceLayout` short and
// makes future call sites trivial.
const hotkeyOpts = { preventDefault: true, enableOnFormTags: true } as const

export function TabSwitcher() {
  const [open, setOpen] = useState(false)

  // ⌘P — toggle. Matches VS Code / Cursor / Sublime quick-switcher.
  // preventDefault suppresses the webview's default print dialog.
  useHotkeys(`${Mod.Meta}+${Keys.P}`, () => setOpen((v) => !v), hotkeyOpts)

  const projects = useStore($projects)
  const recency = useStore($tabRecency)
  const recencyTimes = useStore($tabRecencyTimes)
  const tabMeta = useStore($tabMeta)
  const activeProjectId = useStore($activeProjectId)
  const activeTabIds = useStore($activeTabId)
  const [query, setQuery] = useState('')

  // Re-render every 30s while open so "3m ago" stays fresh without
  // invalidating sidebar subscribers.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [open])

  // Reset query each time the dialog opens. Otherwise a previous search
  // lingers and the user sees a filtered list when they expected the full
  // recency view.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const rows = useMemo(
    () =>
      buildSwitcherRows({
        projects,
        recency,
        recencyTimes,
        tabMeta,
        activeProjectId,
        activeTabIds,
      }),
    [projects, recency, recencyTimes, tabMeta, activeProjectId, activeTabIds],
  )

  const filtered = useMemo(() => filterSwitcherRows(rows, query), [rows, query])

  function handleSelect(row: SwitcherRow): void {
    setOpen(false)
    if (!row.isCurrent) navigateToTab(row.projectId, row.tabId)
  }

  // Recompute `now` on each render (including the 30s tick) so the
  // relative-time formatter stays fresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick forces refresh
  const now = useMemo(() => Date.now(), [tick, open])

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Tab switcher"
      description="Jump to a recently active tab"
    >
      {/* shouldFilter=false: we own the filter (filterSwitcherRows) so we
          can preserve recency order among matches. cmdk's default filter
          would score-sort and lose the recency ranking. */}
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search tabs…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No matching tabs.</CommandEmpty>
          {filtered.map((row) => (
            <CommandItem
              key={row.tabKey}
              // cmdk uses `value` as the keyboard-nav identity. Use the
              // tabKey alone (guaranteed unique) so duplicate label/project
              // strings across projects don't collide.
              value={row.tabKey}
              onSelect={() => handleSelect(row)}
              className={row.isCurrent ? 'opacity-60' : ''}
            >
              <div className="flex w-full items-center gap-3">
                <span
                  aria-hidden="true"
                  className="w-5 shrink-0 text-right tabular-nums opacity-50"
                  style={{ fontFamily: MONO_FONT, fontSize: 10 }}
                >
                  {row.rank > 0 ? row.rank : ''}
                </span>
                <TabStatusIcon tabId={row.tabKey} active={row.isCurrent} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px]">
                    {row.label}
                    {row.isCurrent && (
                      <span className="ml-2 opacity-50">(current)</span>
                    )}
                  </div>
                  <div
                    className="truncate text-[10.5px] opacity-60"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    {row.projectName}
                    {row.cwd && ` · ${cwdBasename(row.cwd)}`}
                    {` · ${formatRelativeTime(now, row.lastActiveAt)}`}
                  </div>
                </div>
              </div>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
