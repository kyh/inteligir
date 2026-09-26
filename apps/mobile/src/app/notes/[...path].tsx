import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CommentsRead } from "@/notes/notes-store";
import {
  assetSource,
  newThreadId,
  noteRevision,
  readNote,
  readNoteComments,
  resolveWikiPath,
  useNotesTree,
} from "@/lib/app-runtime";
import { MONO_FONT, SPACE, useTheme } from "@/lib/theme";
import { CommentsSection } from "@/notes/comments-view";
import { MarkdownBlocks } from "@/notes/markdown-view";
import { projectNote } from "@/notes/note-projection";
import type { NoteProjection } from "@/notes/note-projection";
import type { VaultAssetSource } from "@repo/api/cloud/client";
import { isDocPath } from "@repo/notes/knowledge/doc-file";

const styles = StyleSheet.create({
  askAgent: { fontSize: 16, fontWeight: "600" },
  body: { paddingBottom: 48, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
  pressed: { opacity: 0.7 },
  raw: { fontFamily: MONO_FONT, fontSize: 13, lineHeight: 19 },
  rawBody: { gap: SPACE.md },
  rawNote: { fontSize: 13 },
  screen: { flex: 1 },
  status: { fontSize: 16, paddingVertical: 96, textAlign: "center" },
});

type ScreenState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; content: string; projection: NoteProjection };

const NoteBody = ({
  screen,
  onWikiLink,
  resolveAsset,
}: {
  screen: ScreenState;
  onWikiLink: (target: string, noteId?: string) => void;
  resolveAsset: (target: string) => VaultAssetSource | null;
}) => {
  const theme = useTheme();
  if (screen.state === "loading") {
    return <Text style={[styles.status, { color: theme.mutedForeground }]}>Loading…</Text>;
  }
  if (screen.state === "error") {
    return <Text style={[styles.status, { color: theme.mutedForeground }]}>{screen.message}</Text>;
  }
  if (screen.projection.kind === "raw") {
    return (
      <View style={styles.rawBody}>
        <Text style={[styles.rawNote, { color: theme.mutedForeground }]}>
          This note opens raw here: {screen.projection.reason}
        </Text>
        <Text style={[styles.raw, { color: theme.foreground }]}>{screen.projection.text}</Text>
      </View>
    );
  }
  return (
    <MarkdownBlocks
      blocks={screen.projection.blocks}
      onWikiLink={onWikiLink}
      resolveAsset={resolveAsset}
    />
  );
};

const Comments = ({ comments }: { comments: CommentsRead }) => {
  const theme = useTheme();
  if (!comments.ok) {
    return (
      <Text style={[styles.rawNote, { color: theme.mutedForeground }]}>{comments.message}</Text>
    );
  }
  return <CommentsSection threads={comments.threads} />;
};

const AskAgentButton = ({ onPress }: { onPress: () => void }) => {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={SPACE.sm}
      style={({ pressed }) => pressed && styles.pressed}
      onPress={onPress}
    >
      <Text style={[styles.askAgent, { color: theme.foreground }]}>Ask agent</Text>
    </Pressable>
  );
};

const NoteScreen = () => {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ path: string[] }>();
  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path ?? "");
  const [screen, setScreen] = useState<ScreenState>({ state: "loading" });
  const [comments, setComments] = useState<CommentsRead | null>(null);
  const tree = useNotesTree();
  const entries = tree.state === "ready" ? tree.entries : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setComments(null);
      const read = await readNote(path);
      if (cancelled) {
        return;
      }
      setScreen(
        read.ok
          ? {
              content: read.content,
              projection: projectNote(read.path, read.content),
              state: "ready",
            }
          : { message: read.message, state: "error" },
      );
      if (!read.ok) {
        return;
      }
      const threads = await readNoteComments(read);
      if (!cancelled) {
        setComments(threads);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const onWikiLink = useCallback(
    (target: string, noteId?: string) => {
      const resolved = resolveWikiPath(target, noteId);
      // an image or a pdf has no screen here, and read as a note it shows its bytes
      if (resolved === null || !isDocPath(resolved)) {
        return;
      }
      router.push({ params: { path: resolved.split("/") }, pathname: "/notes/[...path]" });
    },
    [router],
  );

  // the listing is read so it is a dependency: a deep link mounts this screen before the rows
  // load, and the compiler keeps the body's element until this callback changes.
  const resolveAsset = useCallback(
    (target: string) => {
      if (entries === null) {
        return null;
      }
      const resolved = resolveWikiPath(target);
      return resolved === null ? null : assetSource(resolved);
    },
    [entries],
  );

  const title = screen.state === "ready" ? screen.projection.title : "…";

  // a new thread about this note: its first message names the note, and hashes the bytes shown here
  const askAgent = async (content: string): Promise<void> => {
    const revision = await noteRevision(content);
    router.push({
      params: { id: newThreadId(), note: path, revision },
      pathname: "/thread/[id]",
    });
  };

  const header =
    screen.state === "ready"
      ? {
          // oxlint-disable-next-line react/no-unstable-nested-components -- the navigator calls headerRight as a render function, and the button it returns is a module-level component, so nothing remounts
          headerRight: () => (
            <AskAgentButton
              onPress={() => {
                void askAgent(screen.content);
              }}
            />
          ),
          title,
        }
      : { title };

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      <Stack.Screen options={header} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
        <NoteBody screen={screen} onWikiLink={onWikiLink} resolveAsset={resolveAsset} />
        {screen.state === "ready" && comments !== null ? <Comments comments={comments} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
};

export default NoteScreen;
