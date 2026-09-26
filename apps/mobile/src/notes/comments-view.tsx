import type { CommentEntry } from "@repo/notes/comments/sidecar-schema";
import type { CommentThread } from "@repo/notes/comments/comment-threads";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SPACE, useTheme } from "@/lib/theme";
import type { CommentsRead } from "./notes-store";

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21 },
  done: { fontSize: 16, fontWeight: "600" },
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

// Read-only: the phone shows what the desktop wrote; writing rides the capture inbox.
const CommentsSection = ({ threads }: { threads: readonly CommentThread[] }) => {
  const theme = useTheme();
  if (threads.length === 0) {
    return null;
  }
  return (
    <View style={styles.section}>
      <Text style={[styles.heading, { color: theme.mutedForeground }]}>Comments</Text>
      {threads.map((thread) => (
        <View
          key={thread.rootId}
          style={[styles.thread, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
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
        </View>
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
// null is every thread (the header's Comments)
export const CommentsSheet = ({
  comments,
  ids,
  onClose,
  visible,
}: {
  comments: CommentsRead | null;
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
        <ScrollView contentContainerStyle={styles.sheetBody}>
          {status === null && comments?.ok === true ? (
            <CommentsSection threads={threadsFor(comments.threads, ids)} />
          ) : (
            <Text style={[styles.status, { color: theme.mutedForeground }]}>{status}</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
};
