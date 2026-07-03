import { Text, View } from 'react-native'

export default function ProjectsScreen() {
  return (
    <View className="flex-1 items-center justify-center p-6">
      <Text className="font-semibold text-2xl">Projects</Text>
      <Text className="text-neutral-500">
        Project + tab list lands in sub-step 5. Modal auto-dismisses via native
        swipe-down or the header close button provided by the Stack.
      </Text>
    </View>
  )
}
