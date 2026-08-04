import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Markdown from "react-native-markdown-display";

import type { VaultPath } from "@repo/notes/sync/vault-file";

import { markdownStylesFor } from "@/lib/markdown-styles";
import { saveNote, type NoteIo, type SaveOutcome } from "@/lib/notes/note-save";
import { createFsStamp } from "@/lib/sync/clock";
import { syncOnce } from "@/lib/sync/manager";
import { readVaultTextOrNull, vaultFileExists, writeVaultText } from "@/lib/sync/vault-access";
import { SPACE, themeFor } from "@/lib/theme";

// ---------------------------------------------------------------------------
// A single note: READ mode renders common markdown; EDIT mode is a raw textarea
// over the file bytes. This is a LIGHT companion — it renders GFM markdown, but
// inteligir's custom MDX vocabulary ([[wiki-links]], <toggle>, <column_group>,
// $$ math, mermaid, alerts) has no mobile renderer and simply shows as its raw
// source. The full rich editor stays desktop-only. Saving goes through
// ../../lib/notes/note-save, which folds in any change a sync pass landed
// while the note was open, then triggers a sync pass to push the result.
//
// `load.text` is BOTH what read mode renders and the merge base: it holds the
// exact text this screen last read or wrote at `path`.
//
// A save that forked takes the user's words OUT of the editor, so its notice is
// STICKY — the next successful save or a navigation clears it, never a stray
// tap — and it carries the way back to the copy that holds them.
// ---------------------------------------------------------------------------

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly text: string }
  | { readonly kind: "missing" };

/** What the banner says, plus the note it can take the user to. */
type Notice = {
  readonly message: string;
  readonly openPath: VaultPath | null;
};

const io: NoteIo = { read: readVaultTextOrNull, exists: vaultFileExists, write: writeVaultText };
const stamp = createFsStamp();

export default function NoteScreen() {
  const params = useLocalSearchParams<{ path?: string }>();
  // expo-router already percent-decodes the segment, so this is the real path.
  const path = typeof params.path === "string" ? params.path : "";
  const title = path === "" ? "Note" : (path.split("/").pop() ?? path);

  const dark = useColorScheme() === "dark";
  const theme = themeFor(dark);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const text = path === "" ? null : readVaultTextOrNull(path);
    setNotice(null);
    if (text === null) {
      setLoad({ kind: "missing" });
      return;
    }
    setLoad({ kind: "loaded", text });
    setDraft(text);
  }, [path]);

  const save = useCallback(async () => {
    if (path === "" || load.kind !== "loaded") return;
    setSaving(true);
    const outcome = saveNote({ io, path, openedText: load.text, draft, stamp });
    setLoad({ kind: "loaded", text: outcome.text });
    setDraft(outcome.text);
    setNotice(saveNotice(outcome));
    setEditing(false);
    await syncOnce();
    setSaving(false);
  }, [path, draft, load]);

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right", "bottom"]}
    >
      <Stack.Screen
        options={{
          title,
          headerRight: () =>
            load.kind === "loaded" ? (
              <Pressable
                onPress={() => {
                  if (editing) void save();
                  else setEditing(true);
                }}
                disabled={saving}
              >
                <Text style={[styles.headerAction, { color: theme.foreground }]}>
                  {editing ? (saving ? "Saving…" : "Save") : "Edit"}
                </Text>
              </Pressable>
            ) : null,
        }}
      />

      {notice === null ? null : <NoticeBanner notice={notice} dark={dark} />}

      {load.kind === "loading" ? (
        <View style={styles.center}>
          <Text style={[styles.status, { color: theme.mutedForeground }]}>Loading…</Text>
        </View>
      ) : load.kind === "missing" ? (
        <View style={[styles.center, styles.centerPadded]}>
          <Text style={[styles.status, styles.centerText, { color: theme.mutedForeground }]}>
            This note isn’t on this device yet. Sync from the vault screen first.
          </Text>
        </View>
      ) : editing ? (
        <TextInput
          style={[styles.editor, styles.mono, { color: theme.foreground }]}
          value={draft}
          onChangeText={setDraft}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          textAlignVertical="top"
        />
      ) : (
        <ScrollView style={styles.reader} contentContainerStyle={styles.readerContent}>
          <Markdown style={markdownStylesFor(dark)}>{load.text}</Markdown>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** The sticky report of a save that did not land in the note the user was
 * editing, with the way to the copy that holds their words. */
function NoticeBanner({ notice, dark }: { notice: Notice; dark: boolean }) {
  const router = useRouter();
  const theme = themeFor(dark);
  const openPath = notice.openPath;
  return (
    <View
      style={[styles.notice, { backgroundColor: theme.muted, borderBottomColor: theme.border }]}
    >
      <Text style={[styles.noticeText, { color: theme.foreground }]}>{notice.message}</Text>
      {openPath === null ? null : (
        <Pressable
          onPress={() => router.push({ pathname: "/note/[path]", params: { path: openPath } })}
        >
          <Text style={[styles.noticeAction, { color: theme.foreground }]}>Open your version</Text>
        </Pressable>
      )}
    </View>
  );
}

/** What to tell the user about a save that met a concurrent change. Null when
 * the save was ordinary — silence is the right report for the common case. */
function saveNotice(outcome: SaveOutcome): Notice | null {
  switch (outcome.kind) {
    case "written":
      return null;
    case "merged":
      return {
        message: "This note also changed on another device. Both sets of edits were kept.",
        openPath: null,
      };
    case "forked": {
      const name = outcome.copyPath.split("/").pop() ?? outcome.copyPath;
      const why =
        outcome.cause === "unreadable"
          ? "This note couldn’t be read back, so it was left untouched."
          : "This note also changed on another device, and the two versions couldn’t be combined.";
      return { message: `${why} Your edits are saved as “${name}”.`, openPath: outcome.copyPath };
    }
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerAction: { fontSize: 16, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerPadded: { paddingHorizontal: SPACE.xxl },
  centerText: { textAlign: "center" },
  status: { fontSize: 14 },
  notice: {
    gap: SPACE.xs,
    borderBottomWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  noticeText: { fontSize: 13, lineHeight: 18 },
  noticeAction: { fontSize: 13, fontWeight: "600" },
  editor: { flex: 1, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md, fontSize: 16 },
  // A monospace face for the raw editor, using platform defaults (no bundled font).
  mono: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  reader: { flex: 1 },
  readerContent: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
});
