import { Stack, useLocalSearchParams } from "expo-router";
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

import { markdownStylesFor } from "@/lib/markdown-styles";
import { syncOnce } from "@/lib/sync/manager";
import { readVaultText, writeVaultText } from "@/lib/sync/vault-access";
import { SPACE, themeFor } from "@/lib/theme";

// ---------------------------------------------------------------------------
// A single note: READ mode renders common markdown; EDIT mode is a raw textarea
// over the file bytes. This is a LIGHT companion — it renders GFM markdown, but
// inteligir's custom MDX vocabulary ([[wiki-links]], <toggle>, <column_group>,
// $$ math, mermaid, alerts) has no mobile renderer and simply shows as its raw
// source. The full rich editor stays desktop-only. Saving writes the bytes
// locally, then triggers a sync pass to push them to the coordinator.
// ---------------------------------------------------------------------------

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly text: string }
  | { readonly kind: "missing" };

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

  useEffect(() => {
    if (path === "") {
      setLoad({ kind: "missing" });
      return;
    }
    try {
      const text = readVaultText(path);
      setLoad({ kind: "loaded", text });
      setDraft(text);
    } catch {
      setLoad({ kind: "missing" });
    }
  }, [path]);

  const save = useCallback(async () => {
    if (path === "") return;
    setSaving(true);
    writeVaultText(path, draft);
    setLoad({ kind: "loaded", text: draft });
    setEditing(false);
    await syncOnce();
    setSaving(false);
  }, [path, draft]);

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

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerAction: { fontSize: 16, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerPadded: { paddingHorizontal: SPACE.xxl },
  centerText: { textAlign: "center" },
  status: { fontSize: 14 },
  editor: { flex: 1, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md, fontSize: 16 },
  // A monospace face for the raw editor, using platform defaults (no bundled font).
  mono: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  reader: { flex: 1 },
  readerContent: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
});
