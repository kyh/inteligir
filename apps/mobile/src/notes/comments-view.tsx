import type { CommentEntry } from "@repo/notes/comments/sidecar-schema";
import type { CommentThread } from "@repo/notes/comments/comment-threads";
import { StyleSheet, Text, View } from "react-native";
import { SPACE, useTheme } from "@/lib/theme";

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21 },
  heading: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  meta: { fontSize: 12 },
  reply: { borderLeftWidth: 2, gap: SPACE.xs, marginTop: SPACE.xs, paddingLeft: SPACE.md },
  section: { gap: SPACE.sm, paddingTop: SPACE.xxl },
  thread: { borderRadius: 8, borderWidth: 1, gap: SPACE.xs, padding: SPACE.md },
});

const SOURCE_LABELS = { agent: "Agent", external: "External", user: "You" } as const;

const entryMeta = (entry: CommentEntry): string => {
  const who = SOURCE_LABELS[entry.source ?? "user"];
  return `${who} · ${new Date(entry.createdAt * 1000).toLocaleDateString()}`;
};

// Read-only: the phone shows what the desktop wrote; writing rides the capture inbox.
export const CommentsSection = ({ threads }: { threads: readonly CommentThread[] }) => {
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
