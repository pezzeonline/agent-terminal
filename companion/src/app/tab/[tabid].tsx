import { Stack, useLocalSearchParams } from 'expo-router'
import { Text, View } from 'react-native'

export default function TabScreen() {
  const { tabid } = useLocalSearchParams<{ tabid: string }>()

  return (
    <View className="flex-1 items-center justify-center p-6">
      <Stack.Screen options={{ title: `Tab ${tabid}` }} />
      <Text className="font-semibold text-2xl">Tab {tabid}</Text>
      <Text className="text-neutral-500">
        Terminal (xterm.js in a WebView) lands in sub-step 6.
      </Text>
    </View>
  )
}
