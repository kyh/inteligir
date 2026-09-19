import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import { refreshNotes, useNotesTree, useSyncStatus } from "@/lib/app-runtime";
import type { NotesTreeState } from "@/notes/notes-store";
import type { SyncStatus } from "@/sync/sync-runtime";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";

const styles = StyleSheet.create({
  body: { fontSize: 16, textAlign: "center" },
  caption: { fontSize: 13 },
  empty: { alignItems: "center", gap: SPACE.sm, paddingHorizontal: SPACE.xxl, paddingVertical: 96 },
  list: { paddingBottom: 32, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
  pressed: { opacity: 0.7 },
  row: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    gap: 2,
    marginBottom: SPACE.sm,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  screen: { flex: 1 },
  title: { fontSize: 16 },
});

const Empty = ({ text }: { text: string }) => {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.body, { color: theme.mutedForeground }]}>{text}</Text>
    </View>
  );
};

const emptyLabel = (status: SyncStatus, tree: NotesTreeState): string => {
  if (status.state !== "signed-in") {
    return "Sign in to read your notes.";
  }
  if (tree.state === "idle" || tree.state === "loading") {
    return "Loading your vault…";
  }
  if (tree.state === "empty" || tree.state === "error") {
    return tree.message;
  }
  return "No notes yet — write one on your desktop.";
};

// FlatList, not ScrollView: a vault can hold thousands of docs and an eager row per doc janks the
// open.
const NotesScreen = () => {
  const theme = useTheme();
  const router = useRouter();
  const status = useSyncStatus();
  const tree = useNotesTree();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await refreshNotes();
    setRefreshing(false);
  }, []);

  // gated on the credential too: a revoked credential leaves the tree "ready" with a listing this device
  // may no longer read.
  const docs =
    status.state === "signed-in" && tree.state === "ready"
      ? tree.entries.filter((entry) => isDocPath(entry.path))
      : [];
  const emptyText = emptyLabel(status, tree);

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      <Stack.Screen options={{ title: "Notes" }} />
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
        data={docs}
        keyExtractor={(entry) => entry.path}
        ListEmptyComponent={<Empty text={emptyText} />}
        renderItem={({ item: entry }) => {
          const dir = dirnamePath(entry.path);
          return (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: theme.card, borderColor: theme.border },
                pressed && styles.pressed,
              ]}
              onPress={() => {
                router.push({
                  params: { path: entry.path.split("/") },
                  pathname: "/notes/[...path]",
                });
              }}
            >
              <Text style={[styles.title, { color: theme.cardForeground }]} numberOfLines={1}>
                {docStem(entry.path)}
              </Text>
              {dir === "" ? null : (
                <Text style={[styles.caption, { color: theme.mutedForeground }]} numberOfLines={1}>
                  {dir}
                </Text>
              )}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
};

export default NotesScreen;
