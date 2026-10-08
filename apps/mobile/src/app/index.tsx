import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { logout, syncNow, useSyncStatus, useThreadList } from "@/lib/app-runtime";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";
import type { SyncStatus } from "@/sync/sync-runtime";

const styles = StyleSheet.create({
  bodyText: { fontSize: 16, textAlign: "center" },
  empty: { alignItems: "center", gap: SPACE.sm, paddingVertical: 96 },
  footer: { borderTopWidth: 1, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
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

const unsentLine = (requests: number): string =>
  requests === 1
    ? "1 request to your Mac has not reached it yet."
    : `${String(requests)} requests to your Mac have not reached it yet.`;

// a sign-out that would discard requests no Mac holds yet asks first, naming how many
const signOut = async (): Promise<void> => {
  const outcome = await logout();
  if (outcome.kind === "signed-out") {
    return;
  }
  Alert.alert(
    "Sign out and discard them?",
    `${unsentLine(outcome.requests)} Signing out discards them.`,
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
      <View style={styles.syncRow}>
        <Text style={[styles.smallText, { color: theme.mutedForeground }]} numberOfLines={1}>
          {describeStatus(status)}
        </Text>
        <View style={styles.syncActions}>
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
              Pull to refresh.
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
