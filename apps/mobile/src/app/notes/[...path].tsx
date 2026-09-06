import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CommentsRead } from "@/notes/notes-store";
import {
  assetSource,
  readNote,
  readNoteComments,
  resolveWikiPath,
  useNotesTree,
  useSyncStatus,
} from "@/lib/app-runtime";
import { MONO_FONT, SPACE, useTheme } from "@/lib/theme";
import { CommentsSection } from "@/notes/comments-view";
import { MarkdownBlocks } from "@/notes/markdown-view";
import { projectNote, type NoteProjection } from "@/notes/note-projection";

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
  const [comments, setComments] = useState<CommentsRead | null>(null);
  // subscribed, not read once: a deep link can mount this screen before the tree lands,
  // and the subscription is what re-renders the embeds when it does.
  useNotesTree();
  const signedIn = status.state === "signed-in";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setComments(null);
      const read = await readNote(path);
      if (cancelled) return;
      setScreen(
        read.ok
          ? { state: "ready", projection: projectNote(read.path, read.content) }
          : { state: "error", message: read.message },
      );
      if (!read.ok) return;
      const threads = await readNoteComments(path);
      if (!cancelled) setComments(threads);
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

  const title = signedIn && screen.state === "ready" ? screen.projection.title : "…";

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      <Stack.Screen options={{ title }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
        {!signedIn ? (
          <Text style={[styles.status, { color: theme.mutedForeground }]}>
            Sign in to read your notes.
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
        {signedIn && screen.state === "ready" && comments !== null ? (
          comments.ok ? (
            <CommentsSection threads={comments.threads} />
          ) : (
            <Text style={[styles.rawNote, { color: theme.mutedForeground }]}>
              {comments.message}
            </Text>
          )
        ) : null}
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
