import { Stack, useRouter } from "expo-router";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Markdown from "react-native-markdown-display";

import type { AppAgentEvent } from "@repo/features/agent-events";
import {
  appendNotice,
  appendUser,
  applyAgentEvent,
  emptyChatLog,
  logFromHistory,
  type ChatItem,
  type ChatLog,
} from "@repo/features/chat-log";
import type { ChatHistoryEntry } from "@repo/features/ipc-registry";
import { getHostBridge, useHostStatus } from "@/lib/host/connection";
import { hostStatusDotClass, hostStatusLabel, type HostStatus } from "@/lib/host/status-display";
import { useHostChannel } from "@/lib/host/use-host-channel";
import { markdownStylesFor } from "@/lib/markdown-styles";

// ---------------------------------------------------------------------------
// Chat with the DESKTOP agent over the ws bridge: the agent (and the vault it
// edits) lives on the paired computer; this screen is a remote for the same
// single persistent thread the desktop composer drives. History rehydrates on
// mount and on every reconnect; live turns stream through the pure chat-log
// fold. The composer routes a mid-turn submission as a follow_up, exactly
// like the desktop.
// ---------------------------------------------------------------------------

// How close to the end (px) still counts as "at the bottom" for auto-scroll.
const NEAR_BOTTOM_SLOP_PX = 80;

export default function ChatScreen() {
  const router = useRouter();
  const { status } = useHostStatus();
  const dark = useColorScheme() === "dark";
  const insets = useSafeAreaInsets();
  const [log, setLog] = useState<ChatLog>(emptyChatLog);
  const [input, setInput] = useState("");
  const scrollRef = useRef<ScrollView | null>(null);
  // Auto-scroll only while the user is pinned to the bottom — scrolling up to
  // reread must not be yanked back down by streaming deltas.
  const nearBottomRef = useRef(true);

  // Live agent events + a history reload on every (re)connect.
  useHostChannel<AppAgentEvent, ChatHistoryEntry[]>({
    subscribe: (bridge, onEvent) => bridge.onAgentEvent(onEvent),
    load: (bridge) => bridge.getAgentHistory(),
    onEvent: (event) => setLog((current) => applyAgentEvent(current, event)),
    onLoad: (history) => setLog(logFromHistory(history)),
  });

  const connected = status === "connected";
  const canSend = connected && input.trim() !== "";
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
    const bridge = getHostBridge();
    const text = input.trim();
    if (bridge === null || text === "") return;
    setInput("");
    setLog((current) => appendUser(current, text));
    void bridge
      .sendAgentCommand({ type: log.busy ? "follow_up" : "user_message", text })
      .catch(() => {
        setLog((current) => appendNotice(current, "Your message wasn't delivered."));
      });
  }, [input, log.busy]);

  const interrupt = useCallback(() => {
    // Benign if nothing is running to interrupt — swallow the rejection.
    void getHostBridge()
      ?.sendAgentCommand({ type: "interrupt" })
      .catch(() => {});
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["left", "right", "bottom"]}>
      <Stack.Screen options={screenOptions} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // Approximate native-stack header height so padding clears it on iOS.
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 44 : 0}
      >
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="px-4 py-4"
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
          {log.items.length === 0 ? (
            <View className="items-center gap-2 py-24">
              <Text className="text-base text-muted-foreground">
                {connected ? "Chat with your desktop agent." : "Not connected to a desktop."}
              </Text>
              <Text className="px-6 text-center text-sm text-muted-foreground">
                Messages run on the paired computer and edit the vault there.
              </Text>
            </View>
          ) : (
            log.items.map((item) => <ChatRow key={item.id} item={item} dark={dark} />)
          )}
          {log.busy && log.streamingId === null ? (
            <Text className="mb-3 text-sm text-muted-foreground">Working…</Text>
          ) : null}
        </ScrollView>

        <View className="border-t border-border px-4 py-3">
          {connected ? (
            <View className="flex-row items-end gap-2">
              <TextInput
                className="max-h-32 flex-1 rounded-2xl border border-input bg-card px-4 py-2.5 text-base text-foreground"
                placeholder="Message the desktop agent"
                placeholderTextColor="#737373"
                multiline
                value={input}
                onChangeText={setInput}
              />
              {log.busy ? (
                <Pressable
                  className="rounded-full border border-border px-4 py-2.5 active:opacity-70"
                  onPress={interrupt}
                >
                  <Text className="text-sm font-semibold text-foreground">Stop</Text>
                </Pressable>
              ) : null}
              <Pressable
                className="rounded-full bg-primary px-4 py-2.5 active:opacity-80 disabled:opacity-50"
                disabled={!canSend}
                onPress={send}
              >
                <Text className="text-sm font-semibold text-primary-foreground">Send</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable className="items-center py-2" onPress={() => router.push("/connect")}>
              <Text className="text-center text-sm text-muted-foreground">
                {composerHint(status)}{" "}
                <Text className="font-semibold text-foreground">Open Connect</Text>
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function HeaderStatus({ status }: { status: HostStatus }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View className={`h-2 w-2 rounded-full ${hostStatusDotClass(status)}`} />
      <Text className="text-xs text-muted-foreground">{hostStatusLabel(status)}</Text>
    </View>
  );
}

function composerHint(status: HostStatus): string {
  switch (status) {
    case "none":
      return "Pair with your desktop to chat.";
    case "unauthorized":
      return "This device is no longer authorized.";
    case "connecting":
    case "disconnected":
      return "Connecting to your desktop…";
    case "connected":
      return "";
  }
}

// ---- rows -------------------------------------------------------------------

// Memoized: the chat-log fold keeps untouched item references stable, so a
// streaming delta re-renders ONE row, not the whole transcript.
const ChatRow = memo(function ChatRow({ item, dark }: { item: ChatItem; dark: boolean }) {
  if (item.kind === "user") {
    return (
      <View className="mb-3 flex-row justify-end">
        <View className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5">
          <Text className="text-base text-primary-foreground">{item.text}</Text>
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
        className={`mb-2 text-xs ${item.state === "error" ? "text-destructive" : "text-muted-foreground"}`}
        numberOfLines={1}
      >
        {label}
      </Text>
    );
  }

  if (item.isError) {
    return (
      <View className="mb-3 rounded-lg border border-destructive px-3 py-2">
        <Text className="text-sm text-destructive">{item.text}</Text>
      </View>
    );
  }

  if (item.streaming && item.text === "") {
    return <Text className="mb-3 text-sm text-muted-foreground">Thinking…</Text>;
  }

  return (
    <View className="mb-3">
      <Markdown style={markdownStylesFor(dark)}>{item.text}</Markdown>
    </View>
  );
});
