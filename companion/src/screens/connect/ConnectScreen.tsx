import { Pressable, Text, TextInput, View } from 'react-native'
import { useConnectData } from './connect.data'
import { connectErrorMessage } from './connect.helpers'

export function ConnectScreen() {
  const {
    url,
    token,
    setUrl,
    setToken,
    submit,
    status,
    error,
    validationError,
  } = useConnectData()
  const disabled = status === 'connecting'

  return (
    <View className="flex-1 bg-background p-6">
      <View className="gap-6">
        <ConnectHeader />
        <LabeledField label="WSS URL">
          <TextInput
            className="rounded-md border border-input bg-card px-3 py-3 text-foreground"
            placeholder="ws://192.168.1.42:47823/stream"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={url}
            onChangeText={setUrl}
          />
        </LabeledField>
        <LabeledField label="Token">
          <TextInput
            className="rounded-md border border-input bg-card px-3 py-3 font-mono text-foreground"
            placeholder="paste the UUID from companion-dev.json"
            autoCapitalize="none"
            autoCorrect={false}
            value={token}
            onChangeText={setToken}
          />
        </LabeledField>
        <ConnectError
          status={status}
          error={error}
          validationError={validationError}
        />
        <Pressable
          onPress={submit}
          disabled={disabled}
          className="items-center rounded-md bg-accent px-4 py-3"
        >
          <Text className="font-semibold text-accent-foreground text-base">
            {disabled ? 'Connecting…' : 'Connect'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function ConnectHeader() {
  return (
    <View className="gap-2">
      <Text className="font-semibold text-2xl text-foreground">
        Pair with desktop
      </Text>
      <Text className="text-muted-foreground text-sm">
        Enter the WSS URL and token from the desktop's dev config file.
      </Text>
    </View>
  )
}

function LabeledField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <View className="gap-2">
      <Text className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </Text>
      {children}
    </View>
  )
}

function ConnectError({
  status,
  error,
  validationError,
}: {
  status: string
  error: string | null
  validationError: string | null
}) {
  const message = connectErrorMessage(status, error, validationError)
  if (!message) return null
  return <Text className="text-destructive text-sm">{message}</Text>
}
