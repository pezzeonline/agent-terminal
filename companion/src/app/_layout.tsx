import '../../global.css'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

export default function RootLayout() {
  return (
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
  )
}
