import { Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  DECISION_LABELS,
  dispatchCaption,
  localThreadTitle,
  WORKING_CAPTION,
} from "@/dispatch/dispatch-projection";
import type { ApprovalView } from "@/dispatch/dispatch-projection";
import { noMacHasIt } from "@/dispatch/dispatch-runtime";
import type { AskAgentRequest, DesktopsOnline, TurnDispatch } from "@/dispatch/dispatch-runtime";
import {
  answerApproval,
  askAgent,
  cancelDispatch,
  dismissDispatch,
  useDispatches,
  useLiveItems,
  useThread,
} from "@/lib/app-runtime";
import { MONO_FONT, RADIUS, SPACE, useTheme } from "@/lib/theme";
import type { ThreadDisplayItem } from "@/sync/thread-projection";
import { DISPATCH_MAX_CHARS } from "@repo/api/cloud/dispatch/dispatch-schema";
import { docStem } from "@repo/notes/knowledge/doc-file";

const styles = StyleSheet.create({
  action: { fontSize: 13, fontWeight: "600" },
  agentText: { fontSize: 16, lineHeight: 24 },
  body: { fontSize: 15, textAlign: "center" },
  caption: { flexShrink: 1, fontSize: 12 },
  card: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
  },
  code: { fontFamily: MONO_FONT, fontSize: 13 },
  composer: {
    borderTopWidth: 1,
    gap: SPACE.xs,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
  },
  composerRow: { alignItems: "flex-end", flexDirection: "row", gap: SPACE.sm },
  content: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.lg },
  decision: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  decisions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  disabled: { opacity: 0.5 },
  empty: { alignItems: "center", flex: 1, justifyContent: "center", paddingHorizontal: SPACE.xxl },
  input: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flex: 1,
    fontSize: 16,
    maxHeight: 140,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  meta: { alignItems: "center", flexDirection: "row", gap: SPACE.md, justifyContent: "flex-end" },
  notice: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  pending: { gap: SPACE.xs },
  pendingBubble: { opacity: 0.6 },
  pressed: { opacity: 0.7 },
  reasoning: { fontSize: 13, fontStyle: "italic" },
  screen: { flex: 1 },
  send: { borderRadius: RADIUS.md, paddingHorizontal: SPACE.lg, paddingVertical: 10 },
  separator: { height: SPACE.md },
  title: { fontSize: 13, fontWeight: "600" },
  tool: { fontSize: 12 },
  userBubble: {
    borderBottomRightRadius: RADIUS.md,
    borderRadius: 16,
    maxWidth: "85%",
    paddingHorizontal: SPACE.lg,
    paddingVertical: 10,
  },
  userRow: { flexDirection: "row", justifyContent: "flex-end" },
  userText: { fontSize: 16 },
  working: { alignItems: "center", flexDirection: "row", gap: SPACE.sm },
});

type ThreadRow =
  | { kind: "item"; key: string; item: ThreadDisplayItem }
  | { kind: "working"; key: string }
  | { kind: "approval"; key: string; approval: ApprovalView }
  | { kind: "pending"; key: string; dispatch: TurnDispatch };

const Item = ({ item }: { item: ThreadDisplayItem }) => {
  const theme = useTheme();
  switch (item.kind) {
    case "user": {
      return (
        <View style={styles.userRow}>
          <View style={[styles.userBubble, { backgroundColor: theme.primary }]}>
            <Text style={[styles.userText, { color: theme.primaryForeground }]}>{item.text}</Text>
          </View>
        </View>
      );
    }
    case "agent": {
      return <Text style={[styles.agentText, { color: theme.foreground }]}>{item.text}</Text>;
    }
    case "reasoning": {
      return (
        <Text style={[styles.reasoning, { color: theme.mutedForeground }]} numberOfLines={4}>
          {item.text}
        </Text>
      );
    }
    case "tool": {
      return (
        <Text
          style={[styles.tool, { color: item.failed ? theme.destructive : theme.mutedForeground }]}
          numberOfLines={1}
        >
          {item.failed ? `${item.label} — failed` : item.label}
        </Text>
      );
    }
    case "notice": {
      return (
        <View style={[styles.notice, { borderColor: theme.destructive }]}>
          <Text style={[styles.body, { color: theme.destructive }]}>{item.text}</Text>
        </View>
      );
    }
    // no default
  }
};

const TextAction = ({ label, onPress }: { label: string; onPress: () => void }) => {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={SPACE.sm}
      style={({ pressed }) => pressed && styles.pressed}
      onPress={onPress}
    >
      <Text style={[styles.action, { color: theme.foreground }]}>{label}</Text>
    </Pressable>
  );
};

const cancel = async (id: string): Promise<void> => {
  const outcome = await cancelDispatch(id);
  if (!outcome.ok) {
    Alert.alert("Could not cancel", outcome.message);
  }
};

// the words stay on screen until the log's own copy replaces them, and a refused request keeps
// them for the user to copy before dismissing it
const PendingRow = ({
  dispatch,
  desktops,
}: {
  dispatch: TurnDispatch;
  desktops: DesktopsOnline | null;
}) => {
  const theme = useTheme();
  const { phase } = dispatch;
  const refused = phase.kind === "refused";
  const cancellable = noMacHasIt(phase);
  return (
    <View style={styles.pending}>
      <View style={styles.userRow}>
        <View style={[styles.userBubble, styles.pendingBubble, { backgroundColor: theme.primary }]}>
          <Text selectable style={[styles.userText, { color: theme.primaryForeground }]}>
            {dispatch.text}
          </Text>
        </View>
      </View>
      <View style={styles.meta}>
        <Text
          style={[styles.caption, { color: refused ? theme.destructive : theme.mutedForeground }]}
        >
          {dispatchCaption(phase, desktops)}
        </Text>
        {cancellable ? (
          <TextAction
            label="Cancel"
            onPress={() => {
              void cancel(dispatch.id);
            }}
          />
        ) : null}
        {refused ? (
          <TextAction
            label="Dismiss"
            onPress={() => {
              void dismissDispatch(dispatch.id);
            }}
          />
        ) : null}
      </View>
    </View>
  );
};

const WorkingRow = () => {
  const theme = useTheme();
  return (
    <View style={styles.working}>
      <ActivityIndicator size="small" color={theme.mutedForeground} />
      <Text style={[styles.caption, { color: theme.mutedForeground }]}>{WORKING_CAPTION}</Text>
    </View>
  );
};

const ApprovalAnswer = ({
  approval,
  desktops,
}: {
  approval: ApprovalView;
  desktops: DesktopsOnline | null;
}) => {
  const theme = useTheme();
  const { answer } = approval;
  if (answer !== null) {
    const refused = answer.phase.kind === "refused";
    return (
      <View style={styles.meta}>
        <Text
          style={[styles.caption, { color: refused ? theme.destructive : theme.mutedForeground }]}
        >
          {`${DECISION_LABELS[answer.decision]} · ${dispatchCaption(answer.phase, desktops)}`}
        </Text>
        {refused ? (
          <TextAction
            label="Dismiss"
            onPress={() => {
              void dismissDispatch(answer.id);
            }}
          />
        ) : null}
      </View>
    );
  }
  if (approval.answeredElsewhere) {
    return (
      <Text style={[styles.caption, { color: theme.mutedForeground }]}>
        Answered on another device
      </Text>
    );
  }
  return (
    <View style={styles.decisions}>
      {approval.decisions.map((decision) => (
        <Pressable
          key={decision}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.decision,
            decision === "deny"
              ? { borderColor: theme.border }
              : { backgroundColor: theme.primary, borderColor: theme.primary },
            pressed && styles.pressed,
          ]}
          onPress={() => {
            void (async () => {
              const outcome = await answerApproval(approval.id, decision);
              if (!outcome.ok) {
                Alert.alert("Could not answer", outcome.message);
              }
            })();
          }}
        >
          <Text
            style={[
              styles.action,
              { color: decision === "deny" ? theme.foreground : theme.primaryForeground },
            ]}
          >
            {DECISION_LABELS[decision]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
};

const ApprovalCard = ({
  approval,
  desktops,
}: {
  approval: ApprovalView;
  desktops: DesktopsOnline | null;
}) => {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[styles.title, { color: theme.cardForeground }]}>The agent asks to</Text>
      <Text
        selectable
        style={[approval.code ? styles.code : styles.userText, { color: theme.cardForeground }]}
      >
        {approval.summary}
      </Text>
      {approval.reason === null || approval.reason === "" ? null : (
        <Text style={[styles.caption, { color: theme.mutedForeground }]}>{approval.reason}</Text>
      )}
      <ApprovalAnswer approval={approval} desktops={desktops} />
    </View>
  );
};

const Composer = ({
  placeholder,
  seed,
  onSend,
}: {
  placeholder: string;
  seed: string;
  // the reason it was not sent, or null once it is durable on this phone
  onSend: (text: string) => Promise<string | null>;
}) => {
  const theme = useTheme();
  const [text, setText] = useState(seed);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = text.trim() !== "" && !sending;

  const send = async (): Promise<void> => {
    if (!ready) {
      return;
    }
    const sent = text;
    setSending(true);
    setError(null);
    const failure = await onSend(sent);
    setSending(false);
    if (failure !== null) {
      setError(failure);
      return;
    }
    // only the words that were sent: text typed while the send was saved stays
    setText((current) => (current === sent ? "" : current));
  };

  return (
    <View style={[styles.composer, { borderTopColor: theme.border }]}>
      {error === null ? null : (
        <Text style={[styles.caption, { color: theme.destructive }]}>{error}</Text>
      )}
      <View style={styles.composerRow}>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: theme.card, borderColor: theme.input, color: theme.foreground },
          ]}
          placeholder={placeholder}
          placeholderTextColor={theme.mutedForeground}
          value={text}
          onChangeText={setText}
          maxLength={DISPATCH_MAX_CHARS}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          disabled={!ready}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: theme.primary },
            !ready && styles.disabled,
            pressed && styles.pressed,
          ]}
          onPress={() => {
            void send();
          }}
        >
          <Text style={[styles.action, { color: theme.primaryForeground }]}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
};

// a separator, not the container's gap: the list's windowing spacers are its siblings and would
// take a gap each.
const Separator = () => <View style={styles.separator} />;

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

// a selection the note's Ask agent was pressed over, quoted as the Mac's composer quotes one
const quotedSeed = (selection: string | null): string =>
  selection === null
    ? ""
    : `${selection
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`.slice(0, DISPATCH_MAX_CHARS);

// A synced thread — the Mac agent's work, mirrored — with what this phone has asked of it and not
// yet seen in the log. A `note` param makes an empty thread one about that note: its first message
// carries the note as the thread's origin, and the bytes the note screen showed as the revision;
// a `quote` is the selection it was asked over, which the composer starts with.
const ThreadScreen = () => {
  const theme = useTheme();
  const headerHeight = useHeaderHeight();
  const params = useLocalSearchParams<{
    id: string | string[];
    note?: string | string[];
    quote?: string | string[];
    revision?: string | string[];
  }>();
  const threadId = firstParam(params.id) ?? "";
  const notePath = firstParam(params.note);
  const revision = firstParam(params.revision);
  const quote = firstParam(params.quote);
  const thread = useThread(threadId);
  const live = useLiveItems(threadId);
  const { approvals, desktops, pending } = useDispatches(threadId);
  const list = useRef<FlatList<ThreadRow>>(null);

  const fresh = thread === null && pending.length === 0;
  const canCompose = thread === null ? !fresh || notePath !== null : !thread.archived;
  const title =
    thread?.title ?? localThreadTitle(pending) ?? (notePath === null ? "Thread" : "Ask agent");

  const running = thread?.running === true;
  const rows: ThreadRow[] = [
    ...(thread?.items ?? []).map((item): ThreadRow => ({ item, key: item.id, kind: "item" })),
    ...(running ? [{ key: "working", kind: "working" } satisfies ThreadRow] : []),
    ...(running
      ? live.map((item): ThreadRow => ({ item, key: `live:${item.id}`, kind: "item" }))
      : []),
    ...approvals.map((approval): ThreadRow => ({ approval, key: approval.id, kind: "approval" })),
    ...pending.map((dispatch): ThreadRow => ({ dispatch, key: dispatch.id, kind: "pending" })),
  ];

  const send = async (text: string): Promise<string | null> => {
    const request: AskAgentRequest = { text, threadId };
    if (fresh && notePath !== null) {
      request.note = revision === null ? { path: notePath } : { path: notePath, revision };
    }
    const outcome = await askAgent(request);
    return outcome.ok ? null : outcome.message;
  };

  const renderRow = ({ item: row }: { item: ThreadRow }) => {
    switch (row.kind) {
      case "item": {
        return <Item item={row.item} />;
      }
      case "working": {
        return <WorkingRow />;
      }
      case "approval": {
        return <ApprovalCard approval={row.approval} desktops={desktops} />;
      }
      case "pending": {
        return <PendingRow dispatch={row.dispatch} desktops={desktops} />;
      }
      // no default
    }
  };

  let emptyLine: string | null = null;
  if (fresh) {
    emptyLine =
      notePath === null
        ? "This thread has not synced to this device yet."
        : `Ask the agent about ${docStem(notePath)}. It runs on your Mac, and its answer shows up here.`;
  }

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right", "bottom"]}
    >
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
      >
        {emptyLine === null ? (
          <FlatList
            ref={list}
            style={styles.screen}
            contentContainerStyle={styles.content}
            data={rows}
            keyExtractor={(row) => row.key}
            ItemSeparatorComponent={Separator}
            renderItem={renderRow}
            keyboardDismissMode="interactive"
            onContentSizeChange={() => {
              list.current?.scrollToEnd({ animated: true });
            }}
          />
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.body, { color: theme.mutedForeground }]}>{emptyLine}</Text>
          </View>
        )}
        {canCompose ? (
          <Composer
            placeholder={fresh ? "Ask the agent…" : "Reply…"}
            seed={fresh ? quotedSeed(quote) : ""}
            onSend={send}
          />
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default ThreadScreen;
