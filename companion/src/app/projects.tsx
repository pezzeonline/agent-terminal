import { useStore } from '@nanostores/react'
import { Redirect } from 'expo-router'
import { Text, View } from 'react-native'
import { $session } from '@/modules/stores/$session'

export default function ProjectsRoute() {
  const session = useStore($session)
  if (session.status !== 'connected') {
    return <Redirect href="/connect" />
  }
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-background p-6">
      <Text className="font-semibold text-2xl text-foreground">Projects</Text>
      <Text className="text-muted-foreground">
        Project + tab list lands next.
      </Text>
    </View>
  )
}
