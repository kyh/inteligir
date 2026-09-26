import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { logout, submitCapture, syncNow, useSyncStatus, useThreadList } from "@/lib/app-runtime";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";
import type { Theme } from "@/lib/theme";
import type { SyncStatus } from "@/sync/sync-runtime";
import { describeCloudFailure } from "@repo/api/cloud/client";

const styles = StyleSheet.create({
  bodyText: { fontSize: 16, textAlign: "center" },
  captionText: { fontSize: 12 },
  captureBox: { gap: SPACE.sm, paddingHorizontal: SPACE.lg, paddingTop: SPACE.md },
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
  screen: { flex: 1 },
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
});

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

const unsentLine = (count: number): string =>
  count === 1
    ? "1 change on this phone has not reached your vault yet."
    : `${String(count)} changes on this phone have not reached your vault yet.`;

// a sign-out that would discard edits the vault has not taken asks first, naming how many
const signOut = async (): Promise<void> => {
  const outcome = await logout();
  if (outcome.kind === "signed-out") {
    return;
  }
  Alert.alert(
    "Sign out and discard changes?",
    `${unsentLine(outcome.count)} Signing out discards them.`,
    [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          void logout({ discardUnsent: true });
        },
        style: "destructive",
        text: "Discard and sign out",
      },
    ],
  );
};

const HomeScreen = () => {
  const theme = useTheme();
  const router = useRouter();
  const status = useSyncStatus();
  const threads = useThreadList();
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

      <FlatList
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
        data={threads}
        keyExtractor={(thread) => thread.threadId}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.bodyText, { color: theme.mutedForeground }]}>No threads yet.</Text>
            <Text style={[styles.smallText, { color: theme.mutedForeground }]}>
              Pull to refresh, or open a note and ask the agent.
            </Text>
          </View>
        }
        renderItem={({ item: thread }) => {
          const { caption } = thread;
          return (
            <Pressable
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
              {caption === "" ? null : (
                <Text
                  style={[styles.smallText, { color: theme.mutedForeground }]}
                  numberOfLines={1}
                >
                  {caption}
                </Text>
              )}
            </Pressable>
          );
        }}
      />

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Pressable
          onPress={() => {
            void signOut();
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

export default HomeScreen;
