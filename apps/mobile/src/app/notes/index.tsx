import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { titleFromPath } from "@repo/notes/knowledge/link-extract";
import { refreshNotes, useNotesTree, useSyncStatus } from "@/lib/app-runtime";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";

// The vault, read-only: every doc in the hosted repo, title first with its
// folder as the caption. The tree fetch pins one commit, so a list and the
// notes opened from it agree with each other even mid-push elsewhere.
export default function NotesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const status = useSyncStatus();
  const tree = useNotesTree();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (tree.state === "idle") void refreshNotes();
  }, [tree.state]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await refreshNotes();
    setRefreshing(false);
  }, []);

  const docs = tree.state === "ready" ? tree.entries.filter((entry) => isDocPath(entry.path)) : [];

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      <Stack.Screen options={{ title: "Notes" }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {status.state !== "paired" ? (
          <Empty text="Pair this device to read your notes." />
        ) : tree.state === "loading" || tree.state === "idle" ? (
          <Empty text="Loading your vault…" />
        ) : tree.state === "empty" ? (
          <Empty text={tree.message} />
        ) : tree.state === "error" ? (
          <Empty text={tree.message} />
        ) : docs.length === 0 ? (
          <Empty text="No notes yet — write one on your desktop." />
        ) : (
          docs.map((entry) => {
            const dir = entry.path.includes("/")
              ? entry.path.slice(0, entry.path.lastIndexOf("/"))
              : null;
            return (
              <Pressable
                key={entry.path}
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
                  {titleFromPath(entry.path)}
                </Text>
                {dir !== null ? (
                  <Text
                    style={[styles.caption, { color: theme.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {dir}
                  </Text>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
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
