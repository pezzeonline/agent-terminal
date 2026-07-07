import { useEffect, useRef } from 'react'
import { Animated, Keyboard, Text, View } from 'react-native'
import TerminalDom from './TerminalDom'
import { useTabData } from './tab.data'

const DOM_PROPS = { scrollEnabled: false }

export function TabScreen({ tabId }: { tabId: string }) {
  const { terminalRef, onData, onResize, onReady, status, deviceName } =
    useTabData(tabId)
  const spacerHeight = useRef(new Animated.Value(0)).current

  useEffect(() => {
    // Animated.Value updates the native view's height directly, no React
    // re-render. Prevents the WebView from being torn down / losing focus
    // when the keyboard shows.
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      Animated.timing(spacerHeight, {
        toValue: e.endCoordinates.height,
        duration: 250,
        useNativeDriver: false,
      }).start()
    })
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      Animated.timing(spacerHeight, {
        toValue: 0,
        duration: 250,
        useNativeDriver: false,
      }).start()
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [spacerHeight])

  return (
    <View className="flex-1 bg-background">
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
          dom={DOM_PROPS}
        />
      </View>
      <Animated.View style={{ height: spacerHeight }} />
    </View>
  )
}
