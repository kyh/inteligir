import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import PartySocket from "partysocket";

import { trpc } from "@/utils/api";
import { getPartyHost } from "@/utils/base-url";
import { clearSession, getMobileToken } from "@/utils/session-store";

let msgCounter = 0;
function generateClientId(): string {
  return `m_${Date.now()}_${++msgCounter}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentEvent = {
  type: string;
  [key: string]: unknown;
};

type ChatEntry =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "tool"; text: string; isError: boolean };

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function DispatchScreen() {
  const { deviceId, deviceName } = useLocalSearchParams<{
    deviceId: string;
    deviceName: string;
  }>();
  const router = useRouter();
  const mobileToken = getMobileToken();

  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [assistantText, setAssistantText] = useState("");
  const [isAgentBusy, setIsAgentBusy] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const assistantTextRef = useRef("");
  const partySocketRef = useRef<PartySocket | null>(null);

  // -- PartySocket connection (replaces Supabase Realtime) -------------------

  useEffect(() => {
    if (!deviceId || !mobileToken) return;

    const ws = new PartySocket({
      host: getPartyHost(),
      party: "dispatch-server",
      room: deviceId,
    });

    partySocketRef.current = ws;

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.direction !== "to_mobile") return;
        handleAgentEvent(msg.payload as AgentEvent);
      } catch {
        // Skip malformed messages
      }
    });

    // Catch up on any missed messages on connect
    ws.addEventListener("open", () => {
      // Notify desktop of pairing via WebSocket (DB record already exists
      // from the pair mutation, but the desktop may not have caught up yet)
      ws.send(JSON.stringify({
        direction: "to_device",
        type: "device_paired",
        payload: { deviceId },
      }));

      if (mobileToken) {
        catchUpMutation.mutate({ mobileToken });
      }
    });

    return () => {
      ws.close();
      partySocketRef.current = null;
    };
  }, [deviceId, mobileToken]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case "agent_start":
        setIsAgentBusy(true);
        break;
      case "agent_end":
        setIsAgentBusy(false);
        if (assistantTextRef.current) {
          setEntries((prev) => [...prev, { role: "assistant", text: assistantTextRef.current }]);
        }
        assistantTextRef.current = "";
        setAssistantText("");
        break;
      case "message_start":
        if (event.role === "assistant") {
          if (assistantTextRef.current) {
            setEntries((prev) => [...prev, { role: "assistant", text: assistantTextRef.current }]);
          }
          assistantTextRef.current = "";
          setAssistantText("");
        }
        break;
      case "message_update":
        if (typeof event.delta === "string") {
          assistantTextRef.current += event.delta;
          setAssistantText(assistantTextRef.current);
        }
        break;
      case "message_end":
        if (event.role === "assistant" && typeof event.text === "string") {
          assistantTextRef.current = "";
          setAssistantText("");
          setEntries((prev) => [...prev, { role: "assistant", text: String(event.text) }]);
        }
        break;
      case "tool_execution_start": {
        const flushed = assistantTextRef.current;
        assistantTextRef.current = "";
        setAssistantText("");
        setEntries((prev) => [
          ...prev,
          ...(flushed ? [{ role: "assistant" as const, text: flushed }] : []),
          { role: "tool" as const, text: `Running ${event.toolName}...`, isError: false },
        ]);
        break;
      }
      case "tool_execution_end":
        setEntries((prev) => [
          ...prev,
          {
            role: "tool",
            text: String(event.resultText).slice(0, 200),
            isError: event.isError as boolean,
          },
        ]);
        break;
    }
  }

  // -- Catch-up on connect ---------------------------------------------------

  const catchUpMutation = useMutation(
    trpc.dispatch.mobileCatchUp.mutationOptions({
      onSuccess(data) {
        const restored: ChatEntry[] = [];
        for (const msg of data.messages) {
          const event = msg.payload as AgentEvent;
          if (event.type === "message_end" && event.role === "assistant" && typeof event.text === "string") {
            restored.push({ role: "assistant", text: String(event.text) });
          }
        }
        if (restored.length > 0) {
          setEntries((prev) => [...prev, ...restored]);
        }
      },
    }),
  );

  // -- Send message ----------------------------------------------------------

  const sendMutation = useMutation(
    trpc.dispatch.sendMessage.mutationOptions({}),
  );
  const { mutate: sendMessage } = sendMutation;

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !mobileToken) return;
    setInput("");
    setEntries((prev) => [...prev, { role: "user", text }]);

    const clientId = generateClientId();
    const payload = { text, clientId };

    partySocketRef.current?.send(JSON.stringify({
      direction: "to_device",
      type: "user_message",
      payload,
    }));

    sendMessage({ mobileToken, type: "user_message", payload });
  }, [input, mobileToken, sendMessage]);

  const handleInterrupt = useCallback(() => {
    if (!mobileToken) return;

    const clientId = generateClientId();

    partySocketRef.current?.send(JSON.stringify({
      direction: "to_device",
      type: "interrupt",
      payload: { clientId },
    }));

    sendMessage({ mobileToken, type: "interrupt", payload: { clientId } });
  }, [mobileToken, sendMessage]);

  const handleDisconnect = useCallback(async () => {
    await clearSession();
    router.replace("/");
  }, [router]);

  // -- Build display entries ------------------------------------------------

  const displayEntries = [
    ...entries,
    ...(assistantText
      ? [{ role: "assistant" as const, text: assistantText }]
      : []),
  ];

  return (
    <SafeAreaView className="bg-background flex-1" edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: deviceName ?? "Dispatch",
          headerRight: () => (
            <Pressable onPress={handleDisconnect}>
              <Text className="text-destructive text-sm">Disconnect</Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={90}
      >
        {/* Agent status */}
        {isAgentBusy && (
          <View className="flex-row items-center gap-2 border-b border-border px-4 py-2">
            <ActivityIndicator size="small" color="#d1684e" />
            <Text className="text-primary text-xs">Agent working...</Text>
          </View>
        )}

        {/* Chat */}
        <FlatList
          ref={flatListRef}
          data={displayEntries}
          keyExtractor={(_, i) => String(i)}
          className="flex-1"
          contentContainerClassName="p-4 gap-2"
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          renderItem={({ item }) => {
            switch (item.role) {
              case "user":
                return (
                  <View className="bg-primary self-end rounded-2xl rounded-br-sm px-4 py-2.5" style={{ maxWidth: "80%" }}>
                    <Text className="text-primary-foreground text-[15px]">
                      {item.text}
                    </Text>
                  </View>
                );
              case "assistant":
                return (
                  <View className="bg-muted self-start rounded-2xl rounded-bl-sm px-4 py-2.5" style={{ maxWidth: "85%" }}>
                    <Text className="text-foreground text-[15px] leading-[22px]">
                      {item.text}
                    </Text>
                  </View>
                );
              case "tool":
                return (
                  <View className="self-start rounded-lg border-l-[3px] border-l-[#4a4a8a] bg-[#1a1a2a] px-3 py-2" style={{ maxWidth: "85%" }}>
                    <Text
                      className={`text-xs font-mono ${item.isError ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {item.text}
                    </Text>
                  </View>
                );
            }
          }}
          ListEmptyComponent={
            <View className="flex-1 items-center pt-24">
              <Text className="text-muted-foreground text-base">
                Send a message to your desktop agent.
              </Text>
            </View>
          }
        />

        {/* Input */}
        <View className="flex-row items-end gap-2 border-t border-border px-3 py-3">
          <TextInput
            className="bg-muted text-foreground min-h-[40px] flex-1 rounded-2xl border border-border px-4 py-2.5 text-[15px]"
            value={input}
            onChangeText={setInput}
            placeholder="Type a message..."
            placeholderTextColor="#666"
            multiline
            maxLength={4000}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          {isAgentBusy ? (
            <Pressable
              className="bg-destructive rounded-2xl px-5 py-2.5"
              onPress={handleInterrupt}
            >
              <Text className="text-foreground text-[15px] font-semibold">
                Stop
              </Text>
            </Pressable>
          ) : (
            <Pressable
              className="bg-primary rounded-2xl px-5 py-2.5 disabled:opacity-40"
              onPress={handleSend}
              disabled={!input.trim() || sendMutation.isPending}
            >
              {sendMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text className="text-primary-foreground text-[15px] font-semibold">
                  Send
                </Text>
              )}
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
