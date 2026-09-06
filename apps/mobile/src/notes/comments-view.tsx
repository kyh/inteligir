import type { CommentEntry } from "@repo/notes/comments/sidecar-schema";
import type { CommentThread } from "@repo/notes/comments/comment-threads";
import { StyleSheet, Text, View } from "react-native";
import { SPACE, useTheme } from "@/lib/theme";

const SOURCE_LABELS = { user: "You", agent: "Agent", external: "External" } as const;

function entryMeta(entry: CommentEntry): string {
  const who = SOURCE_LABELS[entry.source ?? "user"];
  return `${who} · ${new Date(entry.createdAt * 1000).toLocaleDateString()}`;
}

// Read-only: the phone shows what the desktop wrote; writing rides the capture inbox.
export function CommentsSection({ threads }: { threads: readonly CommentThread[] }) {
  const theme = useTheme();
  if (threads.length === 0) return null;
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
}

const styles = StyleSheet.create({
  section: { gap: SPACE.sm, paddingTop: SPACE.xxl },
  heading: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  thread: { gap: SPACE.xs, padding: SPACE.md, borderRadius: 8, borderWidth: 1 },
  reply: { gap: SPACE.xs, marginTop: SPACE.xs, paddingLeft: SPACE.md, borderLeftWidth: 2 },
  meta: { fontSize: 12 },
  body: { fontSize: 15, lineHeight: 21 },
});
