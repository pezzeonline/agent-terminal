import '../../global.css'
import { ActionSheetProvider } from '@expo/react-native-action-sheet'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

// ActionSheetProvider wraps any component that uses useActionSheet()
// from @expo/react-native-action-sheet (Phase B long-press menus on
// Projects screen). It's pure JS with an ActionSheetIOS binding, so it
// works cleanly in Expo Go on both platforms.
//
// react-native-gesture-handler + react-native-reanimated were installed
// alongside for drag-to-reorder, but their JSI setup crashes at import
// in Expo Go for iOS/Android on SDK 56. Reorder from mobile uses
// Move-up/Move-down items in the long-press action sheet instead until
// a dev client lands (deferred per the plan's fallback path). The deps
// stay installed so a future dev-client PR can wire drag without a
// re-install round trip.
export default function RootLayout() {
  return (
    <ActionSheetProvider>
      <>
        <StatusBar style="auto" />
        <Stack>
          <Stack.Screen name="index" options={{ title: 'Agent Terminal' }} />
          <Stack.Screen
            name="connect"
            options={{ title: 'Connect to desktop' }}
          />
          <Stack.Screen
            name="projects"
            options={{
              title: 'Projects',
              presentation: 'modal',
            }}
          />
          <Stack.Screen
            name="tab/[tabid]"
            options={{
              headerBackTitle: 'Back',
            }}
          />
        </Stack>
      </>
    </ActionSheetProvider>
  )
}
