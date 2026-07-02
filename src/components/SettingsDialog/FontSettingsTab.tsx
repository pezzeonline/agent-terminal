import { useStore } from '@nanostores/react'
import { ChevronDown, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  $fontFamily,
  FONT_FAMILY_OPTIONS,
  setFontFamily,
} from '@/modules/stores/$fontFamily'
import {
  $fontSize,
  decreaseFontSize,
  increaseFontSize,
  resetFontSize,
} from '@/modules/stores/$fontSize'

export function FontSettingsTab() {
  const fontFamily = useStore($fontFamily)
  const fontSize = useStore($fontSize)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-font-family">Font Family</Label>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(triggerProps) => (
              <button
                id="settings-font-family"
                type="button"
                {...triggerProps}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm',
                  triggerProps.className,
                )}
              >
                {fontFamily}
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className="shrink-0 opacity-60"
                />
              </button>
            )}
          />
          <DropdownMenuContent align="end" className="min-w-40">
            {FONT_FAMILY_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option}
                onClick={() => setFontFamily(option)}
                className="justify-between gap-2"
                style={{ fontFamily: `"${option}", monospace` }}
              >
                {option}
                <span
                  aria-hidden="true"
                  className={cn(
                    'text-foreground/70',
                    fontFamily === option ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  ✓
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-font-size">Font Size</Label>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Decrease font size"
            onClick={() => decreaseFontSize()}
          >
            <Minus />
          </Button>
          <button
            id="settings-font-size"
            type="button"
            onClick={() => resetFontSize()}
            title="Reset to default"
            className="w-10 text-center text-muted-foreground text-sm tabular-nums hover:text-foreground"
          >
            {fontSize}
          </button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Increase font size"
            onClick={() => increaseFontSize()}
          >
            <Plus />
          </Button>
        </div>
      </div>
    </div>
  )
}
