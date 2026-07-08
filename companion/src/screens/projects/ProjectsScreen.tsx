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

// fallow-ignore-next-line complexity
function TabRow({ tab }: { tab: TabSummary }) {
  // A tab is "sleeping" when it exists in the desktop's projects.json but
  // has no live PtyHandle. Tapping still navigates to /tab/[id]; the
  // subscribe path on the server will auto-spawn the PTY in a follow-up
  // PR (Phase A step 5). Until then, tapping a sleeping tab produces a
  // "not spawned" state on the terminal screen.
  const sleeping = !tab.is_spawned
  const displayCwd = tab.last_cwd ?? tab.cwd
  return (
    <Link href={`/tab/${tab.tab_id}`} asChild>
      <Pressable
        className={`rounded-md border border-border bg-card p-3 ${sleeping ? 'opacity-60' : ''}`}
      >
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 font-mono text-foreground text-sm">
            {tab.label}
          </Text>
          {sleeping && (
            <Text className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
              sleeping
            </Text>
          )}
        </View>
        {displayCwd && (
          <Text className="text-muted-foreground text-xs">{displayCwd}</Text>
        )}
      </Pressable>
    </Link>
  )
}
