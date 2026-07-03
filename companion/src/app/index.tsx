import { Link } from 'expo-router'
import { Text, View } from 'react-native'

export default function HomeScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-4 p-6">
      <Text className="font-semibold text-2xl">Home</Text>
      <Text className="text-neutral-500">
        Skeleton. Paired/unpaired branch lands in sub-step 5.
      </Text>
      <Link href="/connect" className="text-blue-500">
        Go to /connect
      </Link>
      <Link href="/projects" className="text-blue-500">
        Open /projects (modal)
      </Link>
      <Link href="/tab/example-tab-id" className="text-blue-500">
        Open /tab/example-tab-id
      </Link>
    </View>
  )
}
