import { Stack } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { login, useLoginState, useSyncStatus } from "@/lib/app-runtime";
import { useTheme } from "@/lib/theme";
import type { Palette } from "@/lib/palette";
import { defaultDeviceName } from "@/login/device-name";

// a value, not a class: className draws nothing on a SafeAreaView
const screenOf = (theme: Palette) =>
  ({
    alignItems: "center",
    backgroundColor: theme.background,
    flex: 1,
    justifyContent: "center",
  }) as const;

const FIELD_CLASS = "rounded-lg border border-input bg-card px-4 py-3 text-16 text-foreground";

// the sign-in stands and what the phone holds is kept: the update picks up where it left off
const UpdateNeeded = () => {
  const theme = useTheme();
  return (
    <SafeAreaView style={screenOf(theme)}>
      <Stack.Screen options={{ title: "inteligir" }} />
      <View className="gap-3 self-stretch px-6">
        <Text className="text-30 font-bold text-foreground">Update Inteligir</Text>
        <Text className="text-center text-16 text-muted-foreground">
          This version can&apos;t sync with your account anymore. Update the app to pick up where
          you left off.
        </Text>
      </View>
    </SafeAreaView>
  );
};

const SignInScreen = () => {
  const theme = useTheme();
  const status = useSyncStatus();
  const signIn = useLoginState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const busy = signIn.kind === "signing-in";
  const ready = email.trim() !== "" && password !== "" && deviceName.trim() !== "";
  const reason =
    status.state === "unauthorized"
      ? "This device was signed out. Sign in again to resume syncing."
      : "Sign in with your account to see and edit your library, and ask your Mac's agent.";
  if (status.state === "outdated") {
    return <UpdateNeeded />;
  }

  return (
    <SafeAreaView style={screenOf(theme)}>
      <Stack.Screen options={{ title: "inteligir" }} />
      <View className="gap-3 self-stretch px-6">
        <Text className="text-30 font-bold text-foreground">inteligir</Text>
        <Text className="text-center text-16 text-muted-foreground">{reason}</Text>
        <TextInput
          className={FIELD_CLASS}
          placeholder="Email"
          placeholderTextColor={theme.mutedForeground}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          editable={!busy}
        />
        <TextInput
          className={FIELD_CLASS}
          placeholder="Password"
          placeholderTextColor={theme.mutedForeground}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          editable={!busy}
        />
        <TextInput
          className={FIELD_CLASS}
          placeholder="This device's name"
          placeholderTextColor={theme.mutedForeground}
          value={deviceName}
          onChangeText={setDeviceName}
          editable={!busy}
        />
        {signIn.kind === "failed" ? (
          <Text className="text-14 text-destructive">{signIn.message}</Text>
        ) : null}
        <Pressable
          className="mt-2 items-center rounded-lg bg-primary px-6 py-3 active:opacity-80 disabled:opacity-50"
          disabled={busy || !ready}
          onPress={() => {
            void login({ deviceName, email, password });
          }}
        >
          {busy ? (
            <ActivityIndicator color={theme.primaryForeground} />
          ) : (
            <Text className="text-16 font-semibold text-primary-foreground">Sign in</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

export default SignInScreen;
