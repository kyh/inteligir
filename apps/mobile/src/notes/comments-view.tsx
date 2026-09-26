import { useState } from "react";
import type { CommentEntry } from "@repo/notes/comments/sidecar-schema";
import type { CommentThread } from "@repo/notes/comments/comment-threads";
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
import { SPACE, useTheme } from "@/lib/theme";
import type { CommentOutcome } from "./comment-ops";
import type { CommentsRead } from "./notes-store";

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

const SOURCE_LABELS = { agent: "Agent", external: "External", user: "You" } as const;

const entryMeta = (entry: CommentEntry): string => {
  const who = SOURCE_LABELS[entry.source ?? "user"];
  return `${who} · ${new Date(entry.createdAt * 1000).toLocaleDateString()}`;
};

// what the sheet asks of the note's comments; each answers once the change is on the phone
export interface CommentEdits {
  reply: (rootId: string, text: string) => Promise<CommentOutcome>;
  resolve: (rootId: string, resolved: boolean) => Promise<CommentOutcome>;
}

const failureOf = (cause: unknown): CommentOutcome => ({
  kind: "refused",
  message: cause instanceof Error ? cause.message : String(cause),
});

const ThreadCard = ({ edits, thread }: { edits: CommentEdits; thread: CommentThread }) => {
  const theme = useTheme();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (change: () => Promise<CommentOutcome>): Promise<boolean> => {
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
      if (await run(async () => await edits.reply(thread.rootId, text))) {
        setDraft("");
      }
    })();
  };

  return (
    <View style={[styles.thread, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[styles.meta, { color: theme.mutedForeground }]}>
        {entryMeta(thread.root)}
        {thread.resolved ? " · Resolved" : ""}
        {thread.anchored ? "" : " · Unanchored"}
      </Text>
      <Text style={[styles.body, { color: theme.foreground }]}>{thread.root.text}</Text>
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
          onPress={() => {
            void run(async () => await edits.resolve(thread.rootId, !thread.resolved));
          }}
        >
          <Text style={[styles.action, { color: busy ? theme.mutedForeground : theme.foreground }]}>
            {thread.resolved ? "Reopen" : "Resolve"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

const CommentsSection = ({
  edits,
  threads,
}: {
  edits: CommentEdits;
  threads: readonly CommentThread[];
}) => {
  const theme = useTheme();
  if (threads.length === 0) {
    return null;
  }
  return (
    <View style={styles.section}>
      <Text style={[styles.heading, { color: theme.mutedForeground }]}>Comments</Text>
      {threads.map((thread) => (
        <ThreadCard key={thread.rootId} edits={edits} thread={thread} />
      ))}
    </View>
  );
};

// a marker the page was tapped on narrows the sheet to its threads; one it no longer holds shows all
const threadsFor = (
  threads: readonly CommentThread[],
  ids: readonly string[] | null,
): readonly CommentThread[] => {
  if (ids === null) {
    return threads;
  }
  const named = threads.filter(
    (thread) =>
      ids.includes(thread.rootId) || thread.replies.some((reply) => ids.includes(reply.id)),
  );
  return named.length > 0 ? named : threads;
};

const sheetStatus = (comments: CommentsRead | null): string | null => {
  if (comments === null) {
    return "Loading…";
  }
  if (!comments.ok) {
    return comments.message;
  }
  return comments.threads.length === 0 ? "No comments on this note." : null;
};

// the open note's comments over the editor: `ids` names the marker the page was tapped on, and
// null is every thread (the header's Comments). A new comment is made on a selection in the note.
export const CommentsSheet = ({
  comments,
  edits,
  ids,
  onClose,
  visible,
}: {
  comments: CommentsRead | null;
  edits: CommentEdits;
  ids: readonly string[] | null;
  onClose: () => void;
  visible: boolean;
}) => {
  const theme = useTheme();
  const status = sheetStatus(comments);
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
          {status === null && comments?.ok === true ? (
            <CommentsSection edits={edits} threads={threadsFor(comments.threads, ids)} />
          ) : (
            <Text style={[styles.status, { color: theme.mutedForeground }]}>{status}</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
};
