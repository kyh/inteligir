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
  logout,
  submitCapture,
  syncNow,
  useLoginState,
  useSyncStatus,
  useThreads,
} from "@/lib/app-runtime";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";
import type { Theme } from "@/lib/theme";
import { defaultDeviceName } from "@/login/device-name";
import type { SyncStatus } from "@/sync/sync-runtime";
import { describeCloudFailure } from "@repo/api/cloud/client";

const styles = StyleSheet.create({
  bodyText: { fontSize: 16, textAlign: "center" },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
  captionText: { fontSize: 12 },
  captureBox: { gap: SPACE.sm, paddingHorizontal: SPACE.lg, paddingTop: SPACE.md },
  center: { alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.5 },
  empty: { alignItems: "center", gap: SPACE.sm, paddingVertical: 96 },
  footer: { borderTopWidth: 1, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
  input: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  list: { paddingBottom: 32, paddingHorizontal: SPACE.lg },
  pressed70: { opacity: 0.7 },
  pressed80: { opacity: 0.8 },
  primaryButton: {
    alignItems: "center",
    borderRadius: RADIUS.md,
    marginTop: SPACE.sm,
    paddingHorizontal: SPACE.xxl,
    paddingVertical: SPACE.md,
  },
  screen: { flex: 1 },
  signInBody: { alignSelf: "stretch", gap: SPACE.md, paddingHorizontal: SPACE.xxl },
  smallLabel: { fontSize: 14, fontWeight: "600" },
  smallText: { fontSize: 14 },
  syncActions: { flexDirection: "row", gap: SPACE.sm },
  syncButton: { borderRadius: RADIUS.md, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.sm },
  syncRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACE.md,
    justifyContent: "space-between",
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  threadRow: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    gap: 2,
    marginBottom: SPACE.sm,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  title: { fontSize: 30, fontWeight: "700" },
});

const SignInScreen = ({ status }: { status: SyncStatus }) => {
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
    { backgroundColor: theme.card, borderColor: theme.input, color: theme.foreground },
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

const describeStatus = (status: SyncStatus): string => {
  if (status.state !== "signed-in") {
    return "";
  }
  if (status.lastError !== null) {
    return `Sync issue: ${status.lastError}`;
  }
  return status.lastSyncedAt === null ? "Not synced yet" : "Synced";
};

type CaptureNotice =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "captured" }
  | { kind: "failed"; message: string };

const captureNoticeLine = (
  notice: CaptureNotice,
  theme: Theme,
): { text: string; color: string } | null => {
  switch (notice.kind) {
    case "captured": {
      return { color: theme.mutedForeground, text: "Captured" };
    }
    case "failed": {
      return { color: theme.destructive, text: notice.message };
    }
    case "idle":
    case "sending": {
      return null;
    }
    // no default
  }
};

const CaptureBox = () => {
  const theme = useTheme();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<CaptureNotice>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const capture = useCallback(async () => {
    const value = text.trim();
    if (value === "" || notice.kind === "sending") {
      return;
    }
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    setNotice({ kind: "sending" });
    const result = await submitCapture(value);
    if (!result.ok) {
      setNotice({ kind: "failed", message: describeCloudFailure(result.failure) });
      return;
    }
    // clear only the words that were sent; text typed while the POST was in flight stays.
    setText((current) => (current === text ? "" : current));
    setNotice({ kind: "captured" });
    timer.current = setTimeout(() => {
      setNotice({ kind: "idle" });
    }, 2500);
  }, [text, notice.kind]);

  const line = captureNoticeLine(notice, theme);
  return (
    <View style={styles.captureBox}>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: theme.card, borderColor: theme.input, color: theme.foreground },
        ]}
        placeholder="Capture to your inbox…"
        placeholderTextColor={theme.mutedForeground}
        value={text}
        onChangeText={setText}
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        onSubmitEditing={() => {
          void capture();
        }}
      />
      {line === null ? null : (
        <Text style={[styles.captionText, { color: line.color }]}>{line.text}</Text>
      )}
    </View>
  );
};

const HomeScreen = () => {
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
            onPress={() => {
              router.push("/notes");
            }}
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
            onPress={() => {
              void refresh();
            }}
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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void refresh();
            }}
          />
        }
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
                { backgroundColor: theme.card, borderColor: theme.border },
                pressed && styles.pressed70,
              ]}
              onPress={() => {
                router.push({ params: { id: thread.threadId }, pathname: "/thread/[id]" });
              }}
            >
              <Text style={[styles.bodyText, { color: theme.cardForeground }]} numberOfLines={1}>
                {thread.title}
              </Text>
              {thread.preview === "" ? null : (
                <Text
                  style={[styles.smallText, { color: theme.mutedForeground }]}
                  numberOfLines={1}
                >
                  {thread.preview}
                </Text>
              )}
            </Pressable>
          ))
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Pressable
          onPress={() => {
            void logout();
          }}
        >
          <Text style={[styles.smallText, { color: theme.mutedForeground }]}>
            Sign this device out
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const Index = () => {
  const status = useSyncStatus();
  return status.state === "signed-in" ? <HomeScreen /> : <SignInScreen status={status} />;
};

export default Index;
