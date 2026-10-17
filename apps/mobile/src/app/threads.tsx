import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { syncNow, useSyncStatus, useThreadList } from "@/lib/app-runtime";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";
import type { SyncStatus } from "@/sync/sync-runtime";

const styles = StyleSheet.create({
  bodyText: { fontSize: 16, textAlign: "center" },
  empty: { alignItems: "center", gap: SPACE.sm, paddingVertical: 96 },
  list: { paddingBottom: 32, paddingHorizontal: SPACE.lg },
  pressed: { opacity: 0.7 },
  screen: { flex: 1 },
  smallText: { fontSize: 14 },
  status: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
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

// the threads this account's Macs and this phone hold, newest first
const ThreadsScreen = () => {
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
      edges={["left", "right"]}
    >
      <Stack.Screen options={{ title: "Threads" }} />
      <View style={styles.status}>
        <Text style={[styles.smallText, { color: theme.mutedForeground }]} numberOfLines={1}>
          {describeStatus(status)}
        </Text>
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
              Pull to refresh, or open an item and ask the agent.
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
                pressed && styles.pressed,
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
    </SafeAreaView>
  );
};

export default ThreadsScreen;
