// Custom entry so `react-native-gesture-handler` can register its native
// modules BEFORE expo-router's own entry runs. Gesture-handler docs list
// this as required for setups where the library's side-effect imports
// need to fire first. Without it, `import { GestureHandlerRootView }`
// from `_layout.tsx` runs against an unregistered native module and
// throws `TypeError: undefined is not a function` at the import site.
import 'react-native-gesture-handler'
import 'expo-router/entry'
