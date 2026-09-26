import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CommentsRead } from "@/notes/notes-store";
import {
  addPhotoToNote,
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
  body: { paddingBottom: 48, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
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

  const [addingPhoto, setAddingPhoto] = useState(false);
  const addPhoto = useCallback(async () => {
    setAddingPhoto(true);
    const added = await addPhotoToNote(path);
    setAddingPhoto(false);
    if (added.kind === "added") {
      setScreen({
        content: added.content,
        projection: projectNote(path, added.content),
        state: "ready",
      });
    } else if (added.kind === "refused") {
      Alert.alert("Couldn't add the photo", added.message);
    }
  }, [path]);

  const title = screen.state === "ready" ? screen.projection.title : "…";

  // a new thread about this note: its first message names the note, and hashes the bytes shown here
  const askAgent = async (content: string): Promise<void> => {
    const revision = await noteRevision(content);
    router.push({
      params: { id: newThreadId(), note: path, revision },
      pathname: "/thread/[id]",
    });
  };

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      <Stack.Screen options={{ title }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          hidden={screen.state !== "ready"}
          onPress={() => {
            if (screen.state === "ready") {
              void askAgent(screen.content);
            }
          }}
        >
          Ask agent
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Button
          disabled={screen.state !== "ready" || addingPhoto}
          onPress={() => {
            void addPhoto();
          }}
        >
          {addingPhoto ? "Adding…" : "Add photo"}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
        <NoteBody screen={screen} onWikiLink={onWikiLink} resolveAsset={resolveAsset} />
        {screen.state === "ready" && comments !== null ? <Comments comments={comments} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
};

export default NoteScreen;
