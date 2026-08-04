import { Stack, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Markdown from "react-native-markdown-display";

import type { AppAgentEvent } from "@repo/bridge/agent-events";
import {
  appendUser,
  applyAgentEvent,
  emptyChatLog,
  logFromHistory,
  type ChatItem,
  type ChatLog,
} from "@repo/bridge/chat-log";
import type { ChatHistoryEntry } from "@repo/bridge/chat-log";
import type { OutboxEntry } from "@/lib/chat/chat-outbox";
import {
  dismissUnreadableNotice,
  enqueueChatMessage,
  subscribeDelivered,
  useOutbox,
} from "@/lib/chat/outbox";
import { getHostBridge, useHostStatus } from "@/lib/host/connection";
import { hostStatusDotColor, hostStatusLabel, type HostStatus } from "@/lib/host/status-display";
import { useHostChannel } from "@/lib/host/use-host-channel";
import { markdownStylesFor } from "@/lib/markdown-styles";
import { RADIUS, SPACE, themeFor, useTheme } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Chat with the DESKTOP agent over the ws bridge: the agent (and the vault it
// edits) lives on the paired computer; this screen is a remote for the same
// single persistent thread the desktop composer drives. History rehydrates on
// mount and on every reconnect; live turns stream through the pure chat-log
// fold. The composer routes a mid-turn submission as a follow_up, exactly
// like the desktop.
//
// Sending goes through the durable outbox (../lib/chat/outbox.ts), never
// straight at the bridge: a phone backgrounds mid-request constantly, and the
// queue is what turns that from a silently lost message into one that
// delivers on reconnect. That also lets the composer accept a message while
// the desktop is unreachable.
//
// So a submission is NOT a log entry. The transcript is the host's history
// plus the outbox's own rows, and a message crosses from one to the other only
// when the host acknowledges it — otherwise a queued message would appear in
// the log and then vanish at the next reconnect, when the host's history
// replaces it wholesale.
// ---------------------------------------------------------------------------

// How close to the end (px) still counts as "at the bottom" for auto-scroll.
const NEAR_BOTTOM_SLOP_PX = 80;

export default function ChatScreen() {
  const router = useRouter();
  const { status } = useHostStatus();
  const dark = useColorScheme() === "dark";
  const theme = themeFor(dark);
  const insets = useSafeAreaInsets();
  const [log, setLog] = useState<ChatLog>(emptyChatLog);
  const [input, setInput] = useState("");
  const scrollRef = useRef<ScrollView | null>(null);
  // Auto-scroll only while the user is pinned to the bottom — scrolling up to
  // reread must not be yanked back down by streaming deltas.
  const nearBottomRef = useRef(true);

  // Messages acked SINCE the in-flight history request was issued. The host
  // serves history off the session file, but a dispatch only fires the turn —
  // pi appends the user entry several awaits later, so a history served right
  // after an ack legitimately predates it. Both land on one reconnect and the
  // order is a coin flip; folding these on top stops the reload erasing the
  // user's own message. Anything acked BEFORE the request was issued is
  // already on disk, so nothing renders twice.
  const ackedSinceLoad = useRef<string[]>([]);

  useHostChannel<AppAgentEvent, ChatHistoryEntry[]>({
    subscribe: (bridge, onEvent) => bridge.onAgentEvent(onEvent),
    load: (bridge) => {
      ackedSinceLoad.current = [];
      return bridge.getAgentHistory();
    },
    onEvent: (event) => setLog((current) => applyAgentEvent(current, event)),
    onLoad: (history) => setLog(ackedSinceLoad.current.reduce(appendUser, logFromHistory(history))),
  });

  // An acknowledged message leaves the queue; that is the moment it becomes
  // part of the conversation, and the next history reload confirms it.
  useEffect(
    () =>
      subscribeDelivered((text) => {
        ackedSinceLoad.current.push(text);
        setLog((current) => appendUser(current, text));
      }),
    [],
  );

  const outbox = useOutbox();
  const connected = status === "connected";
  // A started, still-authorized environment accepts messages even while the
  // socket is down — the outbox holds them.
  const composing = status !== "none" && status !== "unauthorized";
  const canSend = composing && input.trim() !== "";
  const streaming = log.streamingId !== null;

  // Recreated only when the status changes — not per keystroke/delta render.
  const screenOptions = useMemo(
    () => ({
      title: "Chat",
      headerRight: () => <HeaderStatus status={status} />,
    }),
    [status],
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (text === "") return;
    setInput("");
    enqueueChatMessage(text);
  }, [input]);

  const interrupt = useCallback(() => {
    // Benign if nothing is running to interrupt — swallow the rejection.
    void getHostBridge()
      ?.sendAgentCommand({ type: "interrupt" })
      .catch(() => {});
  }, []);

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right", "bottom"]}
    >
      <Stack.Screen options={screenOptions} />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // Approximate native-stack header height so padding clears it on iOS.
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 44 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.fill}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            nearBottomRef.current =
              contentOffset.y + layoutMeasurement.height >=
              contentSize.height - NEAR_BOTTOM_SLOP_PX;
          }}
          scrollEventThrottle={32}
          onContentSizeChange={() => {
            if (!nearBottomRef.current) return;
            // Non-animated during streaming: deltas land faster than the
            // animation, which otherwise stutters and lags the tail.
            scrollRef.current?.scrollToEnd({ animated: !streaming });
          }}
        >
          {log.items.length === 0 && outbox.entries.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.mutedForeground }]}>
                {connected ? "Chat with your desktop agent." : "Not connected to a desktop."}
              </Text>
              <Text style={[styles.emptyHint, { color: theme.mutedForeground }]}>
                Messages run on the paired computer and edit the vault there.
              </Text>
            </View>
          ) : (
            log.items.map((item) => <ChatRow key={item.id} item={item} dark={dark} />)
          )}
          {log.busy && log.streamingId === null ? (
            <Text style={[styles.pending, { color: theme.mutedForeground }]}>Working…</Text>
          ) : null}
          {outbox.entries.map((entry) => (
            <QueuedRow key={entry.id} entry={entry} dark={dark} />
          ))}
        </ScrollView>

        {outbox.unreadable ? (
          <Pressable
            style={[styles.unreadable, { borderTopColor: theme.border }]}
            onPress={dismissUnreadableNotice}
          >
            <Text style={[styles.unreadableText, { color: theme.destructive }]}>
              Some messages waiting to send couldn’t be read and were set aside. Anything missing
              will need sending again.
            </Text>
          </Pressable>
        ) : null}

        <View style={[styles.composer, { borderTopColor: theme.border }]}>
          {composing ? (
            <View style={styles.composerRow}>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.input,
                    color: theme.foreground,
                  },
                ]}
                placeholder="Message the desktop agent"
                placeholderTextColor={theme.mutedForeground}
                multiline
                value={input}
                onChangeText={setInput}
              />
              {log.busy ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.stopButton,
                    { borderColor: theme.border },
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={interrupt}
                >
                  <Text style={[styles.buttonLabel, { color: theme.foreground }]}>Stop</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.sendButton,
                  { backgroundColor: theme.primary },
                  pressed && { opacity: 0.8 },
                  !canSend && { opacity: 0.5 },
                ]}
                disabled={!canSend}
                onPress={send}
              >
                <Text style={[styles.buttonLabel, { color: theme.primaryForeground }]}>Send</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.hintButton} onPress={() => router.push("/connect")}>
              <Text style={[styles.hint, { color: theme.mutedForeground }]}>
                {composerHint(status)}{" "}
                <Text style={[styles.hintAction, { color: theme.foreground }]}>Open Connect</Text>
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function HeaderStatus({ status }: { status: HostStatus }) {
  const theme = useTheme();
  return (
    <View style={styles.headerStatus}>
      <View style={[styles.headerDot, { backgroundColor: hostStatusDotColor(status) }]} />
      <Text style={[styles.headerLabel, { color: theme.mutedForeground }]}>
        {hostStatusLabel(status)}
      </Text>
    </View>
  );
}

/** Only reached for the two states the composer refuses outright; every other
 * status accepts a message and lets the outbox hold it. */
function composerHint(status: HostStatus): string {
  return status === "unauthorized"
    ? "This device is no longer authorized."
    : "Pair with your desktop to chat.";
}

// ---- rows -------------------------------------------------------------------

/** A message the desktop has not acknowledged yet: the user's own bubble, held
 * apart from the conversation until it is really in it. */
function QueuedRow({ entry, dark }: { entry: OutboxEntry; dark: boolean }) {
  const theme = themeFor(dark);
  return (
    <View style={styles.userRow}>
      <View style={styles.queued}>
        <View style={[styles.userBubble, styles.queuedBubble, { backgroundColor: theme.primary }]}>
          <Text style={[styles.userText, { color: theme.primaryForeground }]}>{entry.text}</Text>
        </View>
        <Text style={[styles.queuedLabel, { color: theme.mutedForeground }]}>
          {entry.state.kind === "sending" ? "Sending…" : "Waiting to send"}
        </Text>
      </View>
    </View>
  );
}

// Memoized: the chat-log fold keeps untouched item references stable, so a
// streaming delta re-renders ONE row, not the whole transcript.
const ChatRow = memo(function ChatRow({ item, dark }: { item: ChatItem; dark: boolean }) {
  const theme = themeFor(dark);

  if (item.kind === "user") {
    return (
      <View style={styles.userRow}>
        <View style={[styles.userBubble, { backgroundColor: theme.primary }]}>
          <Text style={[styles.userText, { color: theme.primaryForeground }]}>{item.text}</Text>
        </View>
      </View>
    );
  }

  if (item.kind === "tool") {
    const label =
      item.state === "running"
        ? `${item.toolName}…`
        : item.state === "error"
          ? `${item.toolName} — failed`
          : item.toolName;
    return (
      <Text
        style={[
          styles.tool,
          { color: item.state === "error" ? theme.destructive : theme.mutedForeground },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    );
  }

  if (item.isError) {
    return (
      <View style={[styles.errorCard, { borderColor: theme.destructive }]}>
        <Text style={[styles.errorText, { color: theme.destructive }]}>{item.text}</Text>
      </View>
    );
  }

  if (item.streaming && item.text === "") {
    return <Text style={[styles.pending, { color: theme.mutedForeground }]}>Thinking…</Text>;
  }

  return (
    <View style={styles.markdownRow}>
      <Markdown style={markdownStylesFor(dark)}>{item.text}</Markdown>
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flex: 1 },
  scrollContent: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.lg },
  empty: { alignItems: "center", gap: SPACE.sm, paddingVertical: 96 },
  emptyTitle: { fontSize: 16 },
  emptyHint: { paddingHorizontal: SPACE.xxl, textAlign: "center", fontSize: 14 },
  pending: { marginBottom: SPACE.md, fontSize: 14 },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  unreadable: {
    borderTopWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
  },
  unreadableText: { fontSize: 12, lineHeight: 16 },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: SPACE.sm },
  input: {
    flex: 1,
    maxHeight: 128,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: 10,
    fontSize: 16,
  },
  stopButton: {
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: 10,
  },
  sendButton: {
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACE.lg,
    paddingVertical: 10,
  },
  buttonLabel: { fontSize: 14, fontWeight: "600" },
  hintButton: { alignItems: "center", paddingVertical: SPACE.sm },
  hint: { textAlign: "center", fontSize: 14 },
  hintAction: { fontWeight: "600" },
  headerStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerDot: { height: 8, width: 8, borderRadius: RADIUS.full },
  headerLabel: { fontSize: 12 },
  userRow: { marginBottom: SPACE.md, flexDirection: "row", justifyContent: "flex-end" },
  userBubble: {
    maxWidth: "85%",
    borderRadius: 16,
    borderBottomRightRadius: RADIUS.md,
    paddingHorizontal: SPACE.lg,
    paddingVertical: 10,
  },
  userText: { fontSize: 16 },
  queued: { maxWidth: "85%", alignItems: "flex-end", gap: 2 },
  queuedBubble: { maxWidth: "100%", opacity: 0.55 },
  queuedLabel: { fontSize: 11 },
  tool: { marginBottom: SPACE.sm, fontSize: 12 },
  errorCard: {
    marginBottom: SPACE.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  errorText: { fontSize: 14 },
  markdownRow: { marginBottom: SPACE.md },
});
