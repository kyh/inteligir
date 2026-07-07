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

import { syncOnce } from "@/lib/sync/manager";
import { readVaultText, writeVaultText } from "@/lib/sync/vault-access";

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
    <SafeAreaView className="flex-1 bg-background" edges={["left", "right", "bottom"]}>
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
                <Text className="text-base font-semibold text-foreground">
                  {editing ? (saving ? "Saving…" : "Save") : "Edit"}
                </Text>
              </Pressable>
            ) : null,
        }}
      />

      {load.kind === "loading" ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm text-muted-foreground">Loading…</Text>
        </View>
      ) : load.kind === "missing" ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-sm text-muted-foreground">
            This note isn’t on this device yet. Sync from the vault screen first.
          </Text>
        </View>
      ) : editing ? (
        <TextInput
          className="flex-1 px-4 py-3 text-base text-foreground"
          style={styles.mono}
          value={draft}
          onChangeText={setDraft}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          textAlignVertical="top"
        />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4 py-3">
          <Markdown style={dark ? darkMarkdownStyles : lightMarkdownStyles}>{load.text}</Markdown>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // A monospace face for the raw editor, using platform defaults (no bundled font).
  mono: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
});

// react-native-markdown-display styles. Colors mirror src/styles.css zinc tokens
// for light + dark; StyleSheet keys match the library's node types.
const lightMarkdownStyles = StyleSheet.create({
  body: { color: "#171717", fontSize: 16, lineHeight: 24 },
  heading1: { color: "#171717", fontSize: 24, fontWeight: "700", marginTop: 12, marginBottom: 6 },
  heading2: { color: "#171717", fontSize: 20, fontWeight: "700", marginTop: 12, marginBottom: 6 },
  heading3: { color: "#171717", fontSize: 18, fontWeight: "600", marginTop: 10, marginBottom: 4 },
  link: { color: "#2563eb" },
  code_inline: {
    backgroundColor: "#f4f4f5",
    color: "#171717",
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  fence: { backgroundColor: "#f4f4f5", color: "#171717", borderRadius: 8, padding: 12 },
  code_block: { backgroundColor: "#f4f4f5", color: "#171717", borderRadius: 8, padding: 12 },
  blockquote: {
    backgroundColor: "#f4f4f5",
    borderColor: "#e5e5e5",
    borderLeftWidth: 4,
    paddingHorizontal: 12,
  },
  hr: { backgroundColor: "#e5e5e5" },
});

const darkMarkdownStyles = StyleSheet.create({
  body: { color: "#f5f5f5", fontSize: 16, lineHeight: 24 },
  heading1: { color: "#f5f5f5", fontSize: 24, fontWeight: "700", marginTop: 12, marginBottom: 6 },
  heading2: { color: "#f5f5f5", fontSize: 20, fontWeight: "700", marginTop: 12, marginBottom: 6 },
  heading3: { color: "#f5f5f5", fontSize: 18, fontWeight: "600", marginTop: 10, marginBottom: 4 },
  link: { color: "#6b97ff" },
  code_inline: {
    backgroundColor: "#1e1e1e",
    color: "#f5f5f5",
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  fence: { backgroundColor: "#1e1e1e", color: "#f5f5f5", borderRadius: 8, padding: 12 },
  code_block: { backgroundColor: "#1e1e1e", color: "#f5f5f5", borderRadius: 8, padding: 12 },
  blockquote: {
    backgroundColor: "#1e1e1e",
    borderColor: "#404040",
    borderLeftWidth: 4,
    paddingHorizontal: 12,
  },
  hr: { backgroundColor: "#404040" },
});
