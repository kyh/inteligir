import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  login,
  submitCapture,
  syncNow,
  unpair,
  useLoginState,
  useSyncStatus,
  useThreads,
} from "@/lib/app-runtime";
import { RADIUS, SPACE, type Theme, useTheme } from "@/lib/theme";
import { defaultDeviceName } from "@/login/device-name";
import type { SyncStatus } from "@/sync/sync-runtime";
import { describeCloudFailure } from "@repo/api/cloud/client";

export default function Index() {
  const status = useSyncStatus();
  return status.state === "paired" ? <HomeScreen /> : <SignInScreen status={status} />;
}

function SignInScreen({ status }: { status: SyncStatus }) {
  const theme = useTheme();
  const signIn = useLoginState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const busy = signIn.kind === "signing-in";
  const ready = email.trim() !== "" && password !== "" && deviceName.trim() !== "";
  const reason =
    status.state === "unauthorized"
      ? "This device was signed out. Sign in again to resume syncing."
      : "Sign in with your account to read your notes and threads, and capture ideas.";
  const fieldStyle = [
    styles.input,
    { borderColor: theme.input, backgroundColor: theme.card, color: theme.foreground },
  ];

  return (
    <SafeAreaView style={[styles.screen, styles.center, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "inteligir" }} />
      <View style={styles.signInBody}>
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
            pressed && styles.pressed80,
            (busy || !ready) && styles.disabled,
          ]}
          disabled={busy || !ready}
          onPress={() => void login({ email, password, deviceName })}
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
}

function describeStatus(status: SyncStatus): string {
  if (status.state !== "paired") return "";
  if (status.lastError !== null) return `Sync issue: ${status.lastError}`;
  return status.lastSyncedAt === null ? "Not synced yet" : "Synced";
}

function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const status = useSyncStatus();
  const threads = useThreads();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await syncNow();
    setRefreshing(false);
  }, []);

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["top", "left", "right"]}
    >
      <Stack.Screen options={{ title: "inteligir" }} />
      <CaptureBox />
      <View style={styles.syncRow}>
        <Text style={[styles.smallText, { color: theme.mutedForeground }]} numberOfLines={1}>
          {describeStatus(status)}
        </Text>
        <View style={styles.syncActions}>
          <Pressable
            style={({ pressed }) => [
              styles.syncButton,
              { borderColor: theme.border, borderWidth: 1 },
              pressed && styles.pressed80,
            ]}
            onPress={() => router.push("/notes")}
          >
            <Text style={[styles.smallLabel, { color: theme.foreground }]}>Notes</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.syncButton,
              { backgroundColor: theme.primary },
              pressed && styles.pressed80,
            ]}
            disabled={refreshing}
            onPress={() => void refresh()}
          >
            <Text style={[styles.smallLabel, { color: theme.primaryForeground }]}>
              {refreshing ? "Syncing…" : "Sync"}
            </Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {threads.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.bodyText, { color: theme.mutedForeground }]}>No threads yet.</Text>
            <Text style={[styles.smallText, { color: theme.mutedForeground }]}>
              Pull to refresh, or start one on your desktop.
            </Text>
          </View>
        ) : (
          threads.map((thread) => (
            <Pressable
              key={thread.threadId}
              style={({ pressed }) => [
                styles.threadRow,
                { borderColor: theme.border, backgroundColor: theme.card },
                pressed && styles.pressed70,
              ]}
              onPress={() =>
                router.push({ pathname: "/thread/[id]", params: { id: thread.threadId } })
              }
            >
              <Text style={[styles.bodyText, { color: theme.cardForeground }]} numberOfLines={1}>
                {thread.title}
              </Text>
              {thread.preview !== "" ? (
                <Text
                  style={[styles.smallText, { color: theme.mutedForeground }]}
                  numberOfLines={1}
                >
                  {thread.preview}
                </Text>
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Pressable onPress={() => void unpair()}>
          <Text style={[styles.smallText, { color: theme.mutedForeground }]}>
            Sign this device out
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

type CaptureNotice =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "captured" }
  | { kind: "failed"; message: string };

function captureNoticeLine(
  notice: CaptureNotice,
  theme: Theme,
): { text: string; color: string } | null {
  switch (notice.kind) {
    case "idle":
    case "sending":
      return null;
    case "captured":
      return { text: "Captured", color: theme.mutedForeground };
    case "failed":
      return { text: notice.message, color: theme.destructive };
  }
}

function CaptureBox() {
  const theme = useTheme();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<CaptureNotice>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const capture = useCallback(async () => {
    const value = text.trim();
    if (value === "" || notice.kind === "sending") return;
    if (timer.current !== null) clearTimeout(timer.current);
    setNotice({ kind: "sending" });
    const result = await submitCapture(value);
    if (!result.ok) {
      setNotice({ kind: "failed", message: describeCloudFailure(result.failure) });
      return;
    }
    // clear only the words that were sent; text typed while the POST was in flight stays.
    setText((current) => (current === text ? "" : current));
    setNotice({ kind: "captured" });
    timer.current = setTimeout(() => setNotice({ kind: "idle" }), 2500);
  }, [text, notice.kind]);

  const line = captureNoticeLine(notice, theme);
  return (
    <View style={styles.captureBox}>
      <TextInput
        style={[
          styles.input,
          { borderColor: theme.input, backgroundColor: theme.card, color: theme.foreground },
        ]}
        placeholder="Capture to your inbox…"
        placeholderTextColor={theme.mutedForeground}
        value={text}
        onChangeText={setText}
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        onSubmitEditing={() => void capture()}
      />
      {line !== null ? (
        <Text style={[styles.captionText, { color: line.color }]}>{line.text}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  signInBody: { gap: SPACE.md, paddingHorizontal: SPACE.xxl, alignSelf: "stretch" },
  captureBox: { gap: SPACE.sm, paddingHorizontal: SPACE.lg, paddingTop: SPACE.md },
  input: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
    fontSize: 16,
  },
  syncRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACE.md,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  syncActions: { flexDirection: "row", gap: SPACE.sm },
  syncButton: { borderRadius: RADIUS.md, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.sm },
  list: { paddingHorizontal: SPACE.lg, paddingBottom: 32 },
  empty: { alignItems: "center", gap: SPACE.sm, paddingVertical: 96 },
  threadRow: {
    gap: 2,
    marginBottom: SPACE.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  footer: { borderTopWidth: 1, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
  primaryButton: {
    alignItems: "center",
    borderRadius: RADIUS.md,
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.xxl,
    marginTop: SPACE.sm,
  },
  title: { fontSize: 30, fontWeight: "700" },
  bodyText: { fontSize: 16, textAlign: "center" },
  smallText: { fontSize: 14 },
  smallLabel: { fontSize: 14, fontWeight: "600" },
  captionText: { fontSize: 12 },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
  pressed70: { opacity: 0.7 },
  pressed80: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
