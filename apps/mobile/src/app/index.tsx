import { Stack } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DEPLOYMENT_ORIGIN, deploymentLabel } from "@/lib/deployment";
import { sessionStore, signIn, signOut, type SessionState } from "@/lib/session";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";

// ---------------------------------------------------------------------------
// The whole app, and it is one screen on purpose.
//
// This is a SIGNED-IN SHELL: it holds an account against the deployment and
// says so. It does not open a note, run the agent, or watch a delegation, and
// the screen says that too rather than offering a button that would fail — the
// host admits browser clients only (its WebSocket upgrade requires an Origin
// header, which React Native does not send), so a native client cannot reach
// the Bridge until that admission has a design.
//
// What it is for today is the account: signing in on a phone, confirming which
// deployment it belongs to, and signing out of a device you no longer hold.
// ---------------------------------------------------------------------------

export default function Index() {
  const theme = useTheme();
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "inteligir" }} />
      <View style={styles.body}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.foreground }]}>inteligir</Text>
          <Text style={[styles.caption, { color: theme.mutedForeground }]}>
            {deploymentLabel()}
          </Text>
        </View>
        <Body session={session} />
      </View>
    </SafeAreaView>
  );
}

function Body({ session }: { session: SessionState }) {
  switch (session.kind) {
    case "loading":
      return <ActivityIndicator />;
    case "signedOut":
      return <SignInForm />;
    case "signedIn":
      return <Account email={session.account.email} />;
  }
}

function Account({ email }: { email: string }) {
  const theme = useTheme();
  return (
    <View style={styles.actions}>
      <Text style={[styles.bodyText, { color: theme.foreground }]}>Signed in as {email}.</Text>
      <Text style={[styles.bodyText, { color: theme.mutedForeground }]}>
        Your notes, the agent and your background tasks live in the web app. This phone holds your
        account and nothing else yet.
      </Text>
      <PrimaryAction
        label="Open inteligir in your browser"
        onPress={() => {
          void Linking.openURL(`${DEPLOYMENT_ORIGIN}/app`);
        }}
      />
      <SecondaryAction
        label="Sign out"
        onPress={() => {
          Alert.alert("Sign out?", `This signs ${email} out on this device.`, [
            { text: "Cancel", style: "cancel" },
            { text: "Sign out", style: "destructive", onPress: () => void signOut() },
          ]);
        }}
      />
    </View>
  );
}

function SignInForm() {
  const theme = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim() !== "" && password !== "" && !busy;

  const submit = () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    void (async () => {
      const result = await signIn(email.trim(), password);
      setBusy(false);
      if (!result.ok) setError(result.error);
    })();
  };

  return (
    <View style={styles.actions}>
      <Text style={[styles.bodyText, { color: theme.mutedForeground }]}>
        Sign in to the account your notes live under.
      </Text>
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
        onSubmitEditing={submit}
      />
      {error !== null && (
        <Text style={[styles.caption, { color: theme.destructive }]}>{error}</Text>
      )}
      <PrimaryAction
        label={busy ? "Signing in…" : "Sign in"}
        onPress={submit}
        disabled={!canSubmit}
      />
      <Text style={[styles.caption, { color: theme.mutedForeground }]}>
        New accounts are created in the web app — sign-up needs an invite.
      </Text>
    </View>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
} & Pick<
  React.ComponentProps<typeof TextInput>,
  "autoCapitalize" | "keyboardType" | "secureTextEntry" | "textContentType" | "onSubmitEditing"
>;

function Field({ label, ...input }: FieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.caption, { color: theme.mutedForeground }]}>{label}</Text>
      <TextInput
        {...input}
        autoCorrect={false}
        placeholderTextColor={theme.mutedForeground}
        style={[
          styles.input,
          { borderColor: theme.input, backgroundColor: theme.card, color: theme.foreground },
        ]}
      />
    </View>
  );
}

function PrimaryAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: theme.primary },
        disabled && styles.disabled,
        pressed && styles.pressed80,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.buttonLabel, { color: theme.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

function SecondaryAction({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.secondaryButton,
        { borderColor: theme.border, backgroundColor: theme.card },
        pressed && styles.pressed70,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.buttonLabel, { color: theme.cardForeground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, justifyContent: "center", gap: SPACE.xl, paddingHorizontal: SPACE.xxl },
  header: { gap: SPACE.xs },
  actions: { gap: SPACE.md },
  field: { gap: SPACE.xs },
  input: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
  },
  primaryButton: { alignItems: "center", borderRadius: RADIUS.md, paddingVertical: SPACE.md },
  secondaryButton: {
    alignItems: "center",
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingVertical: SPACE.md,
  },
  title: { fontSize: 30, fontWeight: "700" },
  bodyText: { fontSize: 16 },
  caption: { fontSize: 13 },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  pressed70: { opacity: 0.7 },
  pressed80: { opacity: 0.8 },
});
