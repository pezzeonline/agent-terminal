import { useStore } from '@nanostores/react'
import { FontSettingsTab } from '@/components/SettingsDialog/FontSettingsTab'
import { ThemeSettingsTab } from '@/components/SettingsDialog/ThemeSettingsTab'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { $settingsOpen, closeSettings } from '@/modules/stores/$settingsOpen'

/**
 * App-wide Settings dialog. Opened via the "Settings…" app-menu item
 * (⌘,) — see `useSettingsWiring`. Tabbed so more setting categories can
 * be added later without restructuring; today there's "Theme" and "Font".
 */
export function SettingsDialog() {
  const open = useStore($settingsOpen)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSettings()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="theme">
          <TabsList>
            <TabsTrigger value="theme">Theme</TabsTrigger>
            <TabsTrigger value="font">Font</TabsTrigger>
          </TabsList>
          <TabsContent value="theme">
            <ThemeSettingsTab />
          </TabsContent>
          <TabsContent value="font">
            <FontSettingsTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
