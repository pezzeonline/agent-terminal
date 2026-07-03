import { Text, View } from 'react-native'

export default function ConnectScreen() {
  return (
    <View className="flex-1 items-center justify-center p-6">
      <Text className="font-semibold text-2xl">Connect</Text>
      <Text className="text-neutral-500">
        URL + token form lands in sub-step 5.
      </Text>
    </View>
  )
}
