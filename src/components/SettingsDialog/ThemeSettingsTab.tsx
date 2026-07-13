import { useStore } from '@nanostores/react'
import { ChevronDown, Monitor } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  $colorTheme,
  resolveTheme,
  setColorTheme,
} from '@/modules/stores/$colorTheme'
import { AUTO_ID, THEME_DEFS, type ThemeDef } from '@/modules/theme/colorThemes'

const DARK_THEMES = THEME_DEFS.filter((t) => t.type === 'dark')
const LIGHT_THEMES = THEME_DEFS.filter((t) => t.type === 'light')

/** Tiny preview of a theme: window background with accent + a few ANSI dots. */
function Swatch({ def }: { def: ThemeDef }) {
  const dots = [def.accent, def.ansi[2], def.ansi[1], def.ansi[4]]
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-5 w-8 shrink-0 items-center gap-[3px] rounded-[5px] border border-border px-1"
      style={{ background: def.bg }}
    >
      {dots.map((c, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length swatch
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: c }}
        />
      ))}
    </span>
  )
}

function ThemeRow({ def, selected }: { def: ThemeDef; selected: boolean }) {
  return (
    <DropdownMenuItem
      onClick={() => setColorTheme(def.id)}
      className="justify-between gap-3"
    >
      <span className="flex items-center gap-2">
        <Swatch def={def} />
        {def.label}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'text-foreground/70',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      >
        ✓
      </span>
    </DropdownMenuItem>
  )
}

export function ThemeSettingsTab() {
  const selection = useStore($colorTheme)
  const resolved = resolveTheme(selection)
  const isAuto = selection === AUTO_ID
  const triggerLabel = isAuto ? 'Auto (follow OS)' : resolved.label

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-color-theme">Color Theme</Label>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(triggerProps) => (
              <button
                id="settings-color-theme"
                type="button"
                {...triggerProps}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-sm',
                  triggerProps.className,
                )}
              >
                {isAuto ? (
                  <Monitor size={14} aria-hidden="true" className="shrink-0" />
                ) : (
                  <Swatch def={resolved} />
                )}
                {triggerLabel}
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className="shrink-0 opacity-60"
                />
              </button>
            )}
          />
          <DropdownMenuContent
            align="end"
            className="max-h-[min(60vh,26rem)] min-w-56 overflow-y-auto"
          >
            <DropdownMenuItem
              onClick={() => setColorTheme(AUTO_ID)}
              className="justify-between gap-3"
            >
              <span className="flex items-center gap-2">
                <Monitor size={14} aria-hidden="true" className="shrink-0" />
                Auto (follow OS)
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'text-foreground/70',
                  isAuto ? 'opacity-100' : 'opacity-0',
                )}
              >
                ✓
              </span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider opacity-60">
                Dark
              </DropdownMenuLabel>
              {DARK_THEMES.map((def) => (
                <ThemeRow
                  key={def.id}
                  def={def}
                  selected={!isAuto && selection === def.id}
                />
              ))}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider opacity-60">
                Light
              </DropdownMenuLabel>
              {LIGHT_THEMES.map((def) => (
                <ThemeRow
                  key={def.id}
                  def={def}
                  selected={!isAuto && selection === def.id}
                />
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
