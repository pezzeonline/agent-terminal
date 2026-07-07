import { KeyboardAvoidingView, Platform, Text, View } from 'react-native'
import TerminalDom from './TerminalDom'
import { useTabData } from './tab.data'

export function TabScreen({ tabId }: { tabId: string }) {
  const { terminalRef, onData, onResize, onReady, status, deviceName } =
    useTabData(tabId)

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <View className="border-border border-b bg-muted px-4 py-2">
        <Text className="text-muted-foreground text-xs">
          {deviceName ?? 'unknown'} · {status}
        </Text>
      </View>
      <View className="flex-1">
        <TerminalDom
          ref={terminalRef}
          onData={onData}
          onResize={onResize}
          onReady={onReady}
          dom={{ scrollEnabled: false }}
        />
      </View>
    </KeyboardAvoidingView>
  )
}
