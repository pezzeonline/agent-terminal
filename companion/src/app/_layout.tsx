import '../../global.css'
import { ActionSheetProvider } from '@expo/react-native-action-sheet'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

// ActionSheetProvider wraps any component that uses useActionSheet()
// from @expo/react-native-action-sheet (Phase B long-press menus on
// Projects screen). Pure JS; safe here at the root.
//
// GestureHandlerRootView is NOT wrapped here per the Expo tutorial's
// pattern (https://docs.expo.dev/tutorial/gestures/). It goes inside
// the specific screen that uses gestures, so gesture-handler's
// native-module setup runs after expo-router has bootstrapped rather
// than during the first import of _layout.tsx.
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
