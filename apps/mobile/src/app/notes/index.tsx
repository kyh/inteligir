import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import { refreshNotes, useNotesTree, useSyncStatus } from "@/lib/app-runtime";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";

// FlatList, not ScrollView: a vault can hold thousands of docs and an eager row per doc janks the
// open.
export default function NotesScreen() {
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

  // gated on pairing too: a revoked credential leaves the tree "ready" with a listing this device
  // may no longer read.
  const docs =
    status.state === "paired" && tree.state === "ready"
      ? tree.entries.filter((entry) => isDocPath(entry.path))
      : [];
  const emptyText =
    status.state !== "paired"
      ? "Pair this device to read your notes."
      : tree.state === "loading" || tree.state === "idle"
        ? "Loading your vault…"
        : tree.state === "empty" || tree.state === "error"
          ? tree.message
          : "No notes yet — write one on your desktop.";

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      <Stack.Screen options={{ title: "Notes" }} />
      <FlatList
        style={styles.screen}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        data={docs}
        keyExtractor={(entry) => entry.path}
        ListEmptyComponent={<Empty text={emptyText} />}
        renderItem={({ item: entry }) => {
          const dir = dirnamePath(entry.path);
          return (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                { borderColor: theme.border, backgroundColor: theme.card },
                pressed && styles.pressed,
              ]}
              onPress={() =>
                router.push({
                  pathname: "/notes/[...path]",
                  params: { path: entry.path.split("/") },
                })
              }
            >
              <Text style={[styles.title, { color: theme.cardForeground }]} numberOfLines={1}>
                {docStem(entry.path)}
              </Text>
              {dir !== "" ? (
                <Text style={[styles.caption, { color: theme.mutedForeground }]} numberOfLines={1}>
                  {dir}
                </Text>
              ) : null}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

function Empty({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.body, { color: theme.mutedForeground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md, paddingBottom: 32 },
  empty: { alignItems: "center", gap: SPACE.sm, paddingVertical: 96, paddingHorizontal: SPACE.xxl },
  body: { fontSize: 16, textAlign: "center" },
  row: {
    gap: 2,
    marginBottom: SPACE.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  title: { fontSize: 16 },
  caption: { fontSize: 13 },
  pressed: { opacity: 0.7 },
});
