import { useStore } from '@nanostores/react'
import { Redirect, Stack, useLocalSearchParams } from 'expo-router'
import { Text, View } from 'react-native'
import { $session } from '@/modules/stores/$session'

export default function TabRoute() {
  const session = useStore($session)
  const { tabid } = useLocalSearchParams<{ tabid: string }>()
  if (session.status !== 'connected') {
    return <Redirect href="/connect" />
  }
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-background p-6">
      <Stack.Screen options={{ title: `Tab ${tabid}` }} />
      <Text className="font-semibold text-2xl text-foreground">
        Tab {tabid}
      </Text>
      <Text className="text-muted-foreground">
        Terminal WebView lands next.
      </Text>
    </View>
  )
}
