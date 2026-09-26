import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { docStem, isDocPath, isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import { refreshNotes, useNotesTree } from "@/lib/app-runtime";
import type { NotesTreeState } from "@/notes/notes-store";
import type { MirrorProgress } from "@/notes/vault-mirror";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";

const styles = StyleSheet.create({
  body: { fontSize: 16, textAlign: "center" },
  caption: { fontSize: 13 },
  empty: { alignItems: "center", gap: SPACE.sm, paddingHorizontal: SPACE.xxl, paddingVertical: 96 },
  list: { paddingBottom: 32, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
  notice: { marginBottom: SPACE.sm },
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

const LOADING = "Loading your vault…";

const Notices = ({
  progress,
  refreshError,
}: {
  progress: MirrorProgress | null;
  refreshError: string | null;
}) => {
  const theme = useTheme();
  const style = [styles.caption, styles.notice, { color: theme.mutedForeground }];
  return (
    <>
      {progress === null ? null : (
        <Text style={style}>
          {LOADING} {String(progress.fetched)} of {String(progress.total)}
        </Text>
      )}
      {refreshError === null ? null : <Text style={style}>Refresh issue: {refreshError}</Text>}
    </>
  );
};

const emptyLabel = (tree: NotesTreeState): string => {
  if (tree.state === "idle" || tree.state === "loading") {
    return LOADING;
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
  const tree = useNotesTree();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await refreshNotes();
    setRefreshing(false);
  }, []);

  const docs =
    tree.state === "ready"
      ? tree.entries.filter((entry) => isDocPath(entry.path) && !isVaultMetadataPath(entry.path))
      : [];
  const refreshError = tree.state === "ready" ? tree.refreshError : null;
  const progress = tree.state === "ready" ? tree.progress : null;
  const emptyText = emptyLabel(tree);

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
        ListHeaderComponent={<Notices progress={progress} refreshError={refreshError} />}
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
