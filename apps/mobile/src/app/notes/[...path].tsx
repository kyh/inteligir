import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  assetSource,
  readNote,
  resolveWikiPath,
  useNotesTree,
  useSyncStatus,
} from "@/lib/app-runtime";
import { MONO_FONT, SPACE, useTheme } from "@/lib/theme";
import { MarkdownBlocks } from "@/notes/markdown-view";
import { projectNote, type NoteProjection } from "@/notes/note-projection";

// One note, rendered read-only through the dialect's own parse. A wiki link
// resolves over the tree the list screen fetched and pushes the target; an
// unresolvable one (a new note, an alias this surface cannot see) stays inert
// text rather than a dead navigation.
type ScreenState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; projection: NoteProjection };

export default function NoteScreen() {
  const theme = useTheme();
  const router = useRouter();
  const status = useSyncStatus();
  const params = useLocalSearchParams<{ path: string[] }>();
  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path ?? "");
  const [screen, setScreen] = useState<ScreenState>({ state: "loading" });
  // SUBSCRIBED, not just read imperatively: a deep link can mount this screen
  // before the tree lands (the note still opens — an unpinned read), and this
  // subscription is what re-renders its embeds from "unavailable" to images
  // when it does. Fetching a cold tree is the runtime's job, not a screen's.
  useNotesTree();
  const paired = status.state === "paired";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const read = await readNote(path);
      if (cancelled) return;
      setScreen(
        read.ok
          ? { state: "ready", projection: projectNote(read.path, read.content) }
          : { state: "error", message: read.message },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const onWikiLink = useCallback(
    (target: string) => {
      const resolved = resolveWikiPath(target);
      if (resolved === null) return;
      router.push({ pathname: "/notes/[...path]", params: { path: resolved.split("/") } });
    },
    [router],
  );

  const resolveAsset = useCallback((target: string) => {
    const resolved = resolveWikiPath(target);
    return resolved === null ? null : assetSource(resolved);
  }, []);

  // A mounted note must not outlive the pairing that fetched it.
  const title = paired && screen.state === "ready" ? screen.projection.title : "…";

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      <Stack.Screen options={{ title }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
        {!paired ? (
          <Text style={[styles.status, { color: theme.mutedForeground }]}>
            Pair this device to read your notes.
          </Text>
        ) : screen.state === "loading" ? (
          <Text style={[styles.status, { color: theme.mutedForeground }]}>Loading…</Text>
        ) : screen.state === "error" ? (
          <Text style={[styles.status, { color: theme.mutedForeground }]}>{screen.message}</Text>
        ) : screen.projection.kind === "raw" ? (
          <View style={styles.rawBody}>
            <Text style={[styles.rawNote, { color: theme.mutedForeground }]}>
              This note opens raw here: {screen.projection.reason}
            </Text>
            <Text style={[styles.raw, { color: theme.foreground }]}>{screen.projection.text}</Text>
          </View>
        ) : (
          <MarkdownBlocks
            blocks={screen.projection.blocks}
            onWikiLink={onWikiLink}
            resolveAsset={resolveAsset}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md, paddingBottom: 48 },
  status: { fontSize: 16, textAlign: "center", paddingVertical: 96 },
  rawBody: { gap: SPACE.md },
  rawNote: { fontSize: 13 },
  raw: { fontFamily: MONO_FONT, fontSize: 13, lineHeight: 19 },
});
