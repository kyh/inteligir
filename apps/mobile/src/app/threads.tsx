import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { syncNow, useSyncStatus, useThreadList } from "@/lib/app-runtime";
import { useTheme } from "@/lib/theme";
import type { SyncStatus } from "@/sync/sync-runtime";

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
  // a value, not a class: className draws nothing on a SafeAreaView
  const screen = { backgroundColor: theme.background, flex: 1 };
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
    <SafeAreaView style={screen} edges={["left", "right"]}>
      <Stack.Screen options={{ title: "Threads" }} />
      <View className="px-4 py-3">
        <Text className="text-14 text-muted-foreground" numberOfLines={1}>
          {describeStatus(status)}
        </Text>
      </View>
      <FlatList
        className="grow basis-0"
        contentContainerClassName="px-4 pb-8"
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
          <View className="items-center gap-2 py-24">
            <Text className="text-center text-16 text-muted-foreground">No threads yet.</Text>
            <Text className="text-14 text-muted-foreground">
              Pull to refresh, or open an item and ask the agent.
            </Text>
          </View>
        }
        renderItem={({ item: thread }) => {
          const { caption } = thread;
          return (
            <Pressable
              className="mb-2 gap-0.5 rounded-lg border border-border bg-card px-4 py-3 active:opacity-70"
              onPress={() => {
                router.push({ params: { id: thread.threadId }, pathname: "/thread/[id]" });
              }}
            >
              <Text className="text-center text-16 text-card-foreground" numberOfLines={1}>
                {thread.title}
              </Text>
              {caption === "" ? null : (
                <Text className="text-14 text-muted-foreground" numberOfLines={1}>
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
