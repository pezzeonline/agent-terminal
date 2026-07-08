import '../../global.css'
import { ActionSheetProvider } from '@expo/react-native-action-sheet'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

// Root providers:
// - GestureHandlerRootView must wrap the entire app; DraggableFlatList
//   swallows drags otherwise.
// - ActionSheetProvider must wrap any component that uses
//   useActionSheet() from @expo/react-native-action-sheet (Phase B
//   long-press menus on Projects screen).
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
    </GestureHandlerRootView>
  )
}
