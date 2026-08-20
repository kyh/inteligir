import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThread } from "@/lib/app-runtime";
import type { ThreadDisplayItem } from "@/sync/thread-projection";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";

// A read-only view of one synced thread — the desktop agent's work, mirrored.
// No composer: sending a turn (the desktop runs it) is a fast follow.
export default function ThreadScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const threadId = Array.isArray(params.id) ? (params.id[0] ?? "") : params.id;
  const thread = useThread(threadId);

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right", "bottom"]}
    >
      <Stack.Screen options={{ title: thread?.title ?? "Thread" }} />
      {thread === null ? (
        <View style={styles.empty}>
          <Text style={[styles.body, { color: theme.mutedForeground }]}>
            This thread has not synced to this device yet.
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          {thread.items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ item }: { item: ThreadDisplayItem }) {
  const theme = useTheme();
  switch (item.kind) {
    case "user":
      return (
        <View style={styles.userRow}>
          <View style={[styles.userBubble, { backgroundColor: theme.primary }]}>
            <Text style={[styles.userText, { color: theme.primaryForeground }]}>{item.text}</Text>
          </View>
        </View>
      );
    case "agent":
      return <Text style={[styles.agentText, { color: theme.foreground }]}>{item.text}</Text>;
    case "reasoning":
      return (
        <Text style={[styles.reasoning, { color: theme.mutedForeground }]} numberOfLines={4}>
          {item.text}
        </Text>
      );
    case "tool":
      return (
        <Text
          style={[styles.tool, { color: item.failed ? theme.destructive : theme.mutedForeground }]}
          numberOfLines={1}
        >
          {item.failed ? `${item.label} — failed` : item.label}
        </Text>
      );
    case "notice":
      return (
        <View style={[styles.notice, { borderColor: theme.destructive }]}>
          <Text style={[styles.body, { color: theme.destructive }]}>{item.text}</Text>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.lg, gap: SPACE.md },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: SPACE.xxl },
  body: { fontSize: 15, textAlign: "center" },
  userRow: { flexDirection: "row", justifyContent: "flex-end" },
  userBubble: {
    maxWidth: "85%",
    borderRadius: 16,
    borderBottomRightRadius: RADIUS.md,
    paddingHorizontal: SPACE.lg,
    paddingVertical: 10,
  },
  userText: { fontSize: 16 },
  agentText: { fontSize: 16, lineHeight: 24 },
  reasoning: { fontSize: 13, fontStyle: "italic" },
  tool: { fontSize: 12 },
  notice: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
});
