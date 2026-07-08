import { useActionSheet } from '@expo/react-native-action-sheet'
import { Link } from 'expo-router'
import { useState } from 'react'
import { Alert, FlatList, Pressable, Text, View } from 'react-native'
import {
  sendRemoveProject,
  sendRemoveTab,
  sendReorderTabs,
} from '@/modules/wss/client'
import type { ProjectSummary, TabSummary } from '@/modules/wss/protocol.gen'
import { NewProjectSheet } from './NewProjectSheet'
import { NewTabSheet } from './NewTabSheet'
import { RenameSheet, type RenameTarget } from './RenameSheet'
import { useProjectsData } from './projects.data'

// fallow-ignore-next-line complexity
export function ProjectsScreen() {
  const { projects } = useProjectsData()
  const { showActionSheetWithOptions } = useActionSheet()
  const [showNewProject, setShowNewProject] = useState(false)
  const [newTabProjectId, setNewTabProjectId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)

  function openProjectMenu(project: ProjectSummary) {
    showActionSheetWithOptions(
      {
        options: ['Rename', 'Delete', 'Cancel'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
        title: project.name,
      },
      (idx) => {
        if (idx === 0) {
          setRenameTarget({
            kind: 'project',
            projectId: project.project_id,
            currentName: project.name,
          })
        } else if (idx === 1) {
          Alert.alert(
            'Delete project?',
            `${project.name} and all its tabs will be removed.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  sendRemoveProject({ project_id: project.project_id }).catch(
                    (err) => Alert.alert('Delete failed', String(err)),
                  )
                },
              },
            ],
          )
        }
      },
    )
  }

  // fallow-ignore-next-line complexity
  function openTabMenu(project: ProjectSummary, tab: TabSummary) {
    const idxOfTab = project.tabs.findIndex((t) => t.tab_id === tab.tab_id)
    const canMoveUp = idxOfTab > 0
    const canMoveDown = idxOfTab < project.tabs.length - 1

    // Reorder-via-menu is the Expo-Go-compatible substitute for the
    // planned drag-to-reorder UX. react-native-gesture-handler +
    // react-native-reanimated crash at import in Expo Go on SDK 56, so
    // draggable-flatlist stays deferred until a dev client lands.
    const options: string[] = ['Rename']
    if (canMoveUp) options.push('Move up')
    if (canMoveDown) options.push('Move down')
    options.push('Delete', 'Cancel')
    const renameIdx = 0
    const moveUpIdx = canMoveUp ? 1 : -1
    const moveDownIdx = canMoveDown ? (canMoveUp ? 2 : 1) : -1
    const deleteIdx = options.length - 2
    const cancelIdx = options.length - 1

    showActionSheetWithOptions(
      {
        options,
        destructiveButtonIndex: deleteIdx,
        cancelButtonIndex: cancelIdx,
        title: tab.label,
      },
      // fallow-ignore-next-line complexity
      (idx) => {
        if (idx === renameIdx) {
          setRenameTarget({
            kind: 'tab',
            projectId: project.project_id,
            tabId: tab.tab_id,
            currentLabel: tab.label,
          })
        } else if (idx === moveUpIdx) {
          sendReorderTabs({
            project_id: project.project_id,
            old_index: idxOfTab,
            new_index: idxOfTab - 1,
          }).catch((err) => Alert.alert('Move failed', String(err)))
        } else if (idx === moveDownIdx) {
          sendReorderTabs({
            project_id: project.project_id,
            old_index: idxOfTab,
            new_index: idxOfTab + 1,
          }).catch((err) => Alert.alert('Move failed', String(err)))
        } else if (idx === deleteIdx) {
          Alert.alert('Delete tab?', tab.label, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                sendRemoveTab({
                  project_id: project.project_id,
                  tab_id: tab.tab_id,
                }).catch((err) => Alert.alert('Delete failed', String(err)))
              },
            },
          ])
        }
      },
    )
  }

  return (
    <>
      <View className="flex-row items-center justify-between border-border border-b bg-background px-4 py-3">
        <Text className="font-semibold text-foreground text-lg">Projects</Text>
        <Pressable
          onPress={() => setShowNewProject(true)}
          className="rounded-md bg-primary px-3 py-1.5"
        >
          <Text className="font-medium text-primary-foreground text-sm">
            + New Project
          </Text>
        </Pressable>
      </View>
      {projects.length === 0 ? (
        <View className="flex-1 items-center justify-center bg-background p-6">
          <Text className="text-muted-foreground text-sm">
            No projects yet. Tap "+ New Project" to add one.
          </Text>
        </View>
      ) : (
        <FlatList
          className="flex-1 bg-background"
          data={projects}
          keyExtractor={(p) => p.project_id}
          renderItem={({ item }) => (
            <ProjectRow
              project={item}
              onProjectLongPress={() => openProjectMenu(item)}
              onTabLongPress={(tab) => openTabMenu(item, tab)}
              onAddTab={() => setNewTabProjectId(item.project_id)}
            />
          )}
          contentContainerClassName="gap-6 p-4"
        />
      )}
      <NewProjectSheet
        visible={showNewProject}
        onDismiss={() => setShowNewProject(false)}
      />
      <NewTabSheet
        projectId={newTabProjectId}
        onDismiss={() => setNewTabProjectId(null)}
      />
      <RenameSheet
        target={renameTarget}
        onDismiss={() => setRenameTarget(null)}
      />
    </>
  )
}

interface ProjectRowProps {
  project: ProjectSummary
  onProjectLongPress: () => void
  onTabLongPress: (tab: TabSummary) => void
  onAddTab: () => void
}

function ProjectRow({
  project,
  onProjectLongPress,
  onTabLongPress,
  onAddTab,
}: ProjectRowProps) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Pressable
          onLongPress={onProjectLongPress}
          delayLongPress={350}
          className="flex-1"
        >
          <Text className="font-semibold text-foreground text-lg">
            {project.name}
          </Text>
          {project.path && (
            <Text className="text-muted-foreground text-xs">
              {project.path}
            </Text>
          )}
        </Pressable>
        <Pressable
          onPress={onAddTab}
          className="rounded-md border border-border px-2 py-1"
        >
          <Text className="text-foreground text-xs">+ Tab</Text>
        </Pressable>
      </View>
      <View className="gap-1">
        {project.tabs.map((tab) => (
          <TabRow
            key={tab.tab_id}
            tab={tab}
            onLongPress={() => onTabLongPress(tab)}
          />
        ))}
      </View>
    </View>
  )
}

interface TabRowProps {
  tab: TabSummary
  onLongPress: () => void
}

// fallow-ignore-next-line complexity
function TabRow({ tab, onLongPress }: TabRowProps) {
  const sleeping = !tab.is_spawned
  const displayCwd = tab.last_cwd ?? tab.cwd
  return (
    <Link href={`/tab/${tab.tab_id}`} asChild>
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={350}
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
