import { Stack } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { login, useLoginState, useSyncStatus } from "@/lib/app-runtime";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";
import { defaultDeviceName } from "@/login/device-name";

const styles = StyleSheet.create({
  body: { alignSelf: "stretch", gap: SPACE.md, paddingHorizontal: SPACE.xxl },
  bodyText: { fontSize: 16, textAlign: "center" },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  input: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  pressed: { opacity: 0.8 },
  primaryButton: {
    alignItems: "center",
    borderRadius: RADIUS.md,
    marginTop: SPACE.sm,
    paddingHorizontal: SPACE.xxl,
    paddingVertical: SPACE.md,
  },
  screen: { alignItems: "center", flex: 1, justifyContent: "center" },
  smallText: { fontSize: 14 },
  title: { fontSize: 30, fontWeight: "700" },
});

// the sign-in stands and what the phone holds is kept: the update picks up where it left off
const UpdateNeeded = () => {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "inteligir" }} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.foreground }]}>Update Inteligir</Text>
        <Text style={[styles.bodyText, { color: theme.mutedForeground }]}>
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
      : "Sign in with your account to read and edit your notes, and ask your Mac's agent.";
  const fieldStyle = [
    styles.input,
    { backgroundColor: theme.card, borderColor: theme.input, color: theme.foreground },
  ];
  if (status.state === "outdated") {
    return <UpdateNeeded />;
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "inteligir" }} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.foreground }]}>inteligir</Text>
        <Text style={[styles.bodyText, { color: theme.mutedForeground }]}>{reason}</Text>
        <TextInput
          style={fieldStyle}
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
          style={fieldStyle}
          placeholder="Password"
          placeholderTextColor={theme.mutedForeground}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          editable={!busy}
        />
        <TextInput
          style={fieldStyle}
          placeholder="This device's name"
          placeholderTextColor={theme.mutedForeground}
          value={deviceName}
          onChangeText={setDeviceName}
          editable={!busy}
        />
        {signIn.kind === "failed" ? (
          <Text style={[styles.smallText, { color: theme.destructive }]}>{signIn.message}</Text>
        ) : null}
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.primary },
            pressed && styles.pressed,
            (busy || !ready) && styles.disabled,
          ]}
          disabled={busy || !ready}
          onPress={() => {
            void login({ deviceName, email, password });
          }}
        >
          {busy ? (
            <ActivityIndicator color={theme.primaryForeground} />
          ) : (
            <Text style={[styles.buttonLabel, { color: theme.primaryForeground }]}>Sign in</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

export default SignInScreen;
