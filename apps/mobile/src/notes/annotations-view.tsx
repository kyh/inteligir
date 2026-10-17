import { useState } from "react";
import { annotationSourceLabel } from "@repo/notes/annotations/store-schema";
import type { AnnotationEntry } from "@repo/notes/annotations/store-schema";
import type { AnnotationThread } from "@repo/notes/annotations/annotation-threads";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { messageOf } from "@/lib/error-message";
import { SPACE, useTheme } from "@/lib/theme";
import type { AnnotationOutcome } from "./annotation-ops";
import type { AnnotationsRead } from "./notes-store";

const styles = StyleSheet.create({
  action: { fontSize: 15, fontWeight: "600", paddingHorizontal: SPACE.sm },
  actions: { alignItems: "center", flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.sm },
  body: { fontSize: 15, lineHeight: 21 },
  done: { fontSize: 16, fontWeight: "600" },
  field: {
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    fontSize: 16,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  heading: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  meta: { fontSize: 12 },
  quote: { borderLeftWidth: 2, fontSize: 15, lineHeight: 21, paddingLeft: SPACE.md },
  reply: { borderLeftWidth: 2, gap: SPACE.xs, marginTop: SPACE.xs, paddingLeft: SPACE.md },
  section: { gap: SPACE.sm, paddingTop: SPACE.xxl },
  sheet: { flex: 1 },
  sheetBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.lg,
  },
  sheetBody: { paddingBottom: 48, paddingHorizontal: SPACE.lg },
  status: { fontSize: 15, paddingTop: SPACE.xxl, textAlign: "center" },
  thread: { borderRadius: 8, borderWidth: 1, gap: SPACE.xs, padding: SPACE.md },
});

const entryMeta = (entry: AnnotationEntry): string =>
  `${annotationSourceLabel(entry.source)} · ${new Date(entry.createdAt * 1000).toLocaleDateString()}`;

// what the sheet asks of the note's annotations; each answers once the change is on the phone
export interface AnnotationEdits {
  reply: (rootId: string, text: string) => Promise<AnnotationOutcome>;
  // the annotation with every reply, and its markers in the note
  remove: (rootId: string) => Promise<AnnotationOutcome>;
}

const failureOf = (cause: unknown): AnnotationOutcome => ({
  kind: "refused",
  message: messageOf(cause),
});

const ThreadCard = ({ edits, thread }: { edits: AnnotationEdits; thread: AnnotationThread }) => {
  const theme = useTheme();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (change: () => Promise<AnnotationOutcome>): Promise<boolean> => {
    setBusy(true);
    const outcome = await change().catch(failureOf);
    setBusy(false);
    if (outcome.kind === "refused") {
      Alert.alert("Couldn't change this comment", outcome.message);
      return false;
    }
    return true;
  };

  const sendReply = (): void => {
    const text = draft.trim();
    if (text === "" || busy) {
      return;
    }
    void (async () => {
      if (await run(async () => await edits.reply(thread.id, text))) {
        setDraft("");
      }
    })();
  };

  const confirmRemove = (): void => {
    Alert.alert(
      "Delete this comment?",
      thread.replies.length === 0
        ? "It goes from this note on every device."
        : "It and its replies go from this note on every device.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            void run(async () => await edits.remove(thread.id));
          },
          style: "destructive",
          text: "Delete",
        },
      ],
    );
  };

  return (
    <View style={[styles.thread, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[styles.meta, { color: theme.mutedForeground }]}>
        {entryMeta(thread.root)}
        {thread.anchored ? "" : " · Unanchored"}
      </Text>
      {thread.root.quote === undefined ? null : (
        <Text style={[styles.quote, { borderColor: theme.border, color: theme.mutedForeground }]}>
          {thread.root.quote}
        </Text>
      )}
      {thread.root.text === "" ? null : (
        <Text style={[styles.body, { color: theme.foreground }]}>{thread.root.text}</Text>
      )}
      {thread.replies.map((reply) => (
        <View key={reply.id} style={[styles.reply, { borderColor: theme.border }]}>
          <Text style={[styles.meta, { color: theme.mutedForeground }]}>
            {entryMeta(reply.entry)}
          </Text>
          <Text style={[styles.body, { color: theme.foreground }]}>{reply.entry.text}</Text>
        </View>
      ))}
      <View style={styles.actions}>
        <TextInput
          accessibilityLabel="Reply to comment"
          style={[
            styles.field,
            {
              backgroundColor: theme.background,
              borderColor: theme.input,
              color: theme.foreground,
            },
          ]}
          placeholder="Reply…"
          placeholderTextColor={theme.mutedForeground}
          value={draft}
          editable={!busy}
          returnKeyType="send"
          onChangeText={setDraft}
          onSubmitEditing={sendReply}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          hitSlop={SPACE.sm}
          onPress={confirmRemove}
        >
          <Text
            style={[styles.action, { color: busy ? theme.mutedForeground : theme.destructive }]}
          >
            Delete
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

const AnnotationsSection = ({
  edits,
  threads,
}: {
  edits: AnnotationEdits;
  threads: readonly AnnotationThread[];
}) => {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.heading, { color: theme.mutedForeground }]}>Comments</Text>
      {threads.map((thread) => (
        <ThreadCard key={thread.id} edits={edits} thread={thread} />
      ))}
    </View>
  );
};

// a marker the page was tapped on narrows the sheet to its threads; one it no longer holds shows all
const threadsFor = (
  threads: readonly AnnotationThread[],
  ids: readonly string[] | null,
): readonly AnnotationThread[] => {
  if (ids === null) {
    return threads;
  }
  const named = threads.filter(
    (thread) => ids.includes(thread.id) || thread.replies.some((reply) => ids.includes(reply.id)),
  );
  return named.length > 0 ? named : threads;
};

const sheetStatus = (annotations: AnnotationsRead | null): string | null => {
  if (annotations === null) {
    return "Loading…";
  }
  if (!annotations.ok) {
    return annotations.message;
  }
  return annotations.annotations.length === 0 ? "No comments on this note." : null;
};

// the open note's annotations over the editor: `ids` names the marker the page was tapped on, and
// null is every thread (the header's Annotations). A new annotation is made on a selection in the note.
export const AnnotationsSheet = ({
  annotations,
  edits,
  ids,
  onClose,
  visible,
}: {
  annotations: AnnotationsRead | null;
  edits: AnnotationEdits;
  ids: readonly string[] | null;
  onClose: () => void;
  visible: boolean;
}) => {
  const theme = useTheme();
  const status = sheetStatus(annotations);
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={styles.sheetBar}>
          <Pressable accessibilityRole="button" hitSlop={SPACE.md} onPress={onClose}>
            <Text style={[styles.done, { color: theme.foreground }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.sheetBody}
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
        >
          {status === null && annotations?.ok === true ? (
            <AnnotationsSection edits={edits} threads={threadsFor(annotations.annotations, ids)} />
          ) : (
            <Text style={[styles.status, { color: theme.mutedForeground }]}>{status}</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
};
