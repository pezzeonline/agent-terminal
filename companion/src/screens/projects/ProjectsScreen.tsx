import { Link } from 'expo-router'
import { FlatList, Pressable, Text, View } from 'react-native'
import type { ProjectSummary, TabSummary } from '@/modules/wss/protocol.gen'
import { useProjectsData } from './projects.data'

export function ProjectsScreen() {
  const { projects } = useProjectsData()

  if (projects.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-muted-foreground text-sm">
          No projects yet. Open a tab on the desktop to see it here.
        </Text>
      </View>
    )
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      data={projects}
      keyExtractor={(p) => p.project_id}
      renderItem={({ item }) => <ProjectRow project={item} />}
      contentContainerClassName="gap-6 p-4"
    />
  )
}

function ProjectRow({ project }: { project: ProjectSummary }) {
  return (
    <View className="gap-2">
      <Text className="font-semibold text-foreground text-lg">
        {project.name}
      </Text>
      <View className="gap-1">
        {project.tabs.map((tab) => (
          <TabRow key={tab.tab_id} tab={tab} />
        ))}
      </View>
    </View>
  )
}

function TabRow({ tab }: { tab: TabSummary }) {
  return (
    <Link href={`/tab/${tab.tab_id}`} asChild>
      <Pressable className="rounded-md border border-border bg-card p-3">
        <Text className="font-mono text-foreground text-sm">{tab.label}</Text>
        {tab.cwd && (
          <Text className="text-muted-foreground text-xs">{tab.cwd}</Text>
        )}
      </Pressable>
    </Link>
  )
}
