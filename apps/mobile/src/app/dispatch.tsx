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

import { trpc } from "@/utils/api";
import { supabase } from "@/utils/supabase";
import { clearSession, getMobileToken } from "@/utils/session-store";

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

  // -- Supabase Realtime subscription ----------------------------------------

  useEffect(() => {
    if (!deviceId) return;

    const channel = supabase.channel(`dispatch:${deviceId}`);

    channel.on("broadcast", { event: "dispatch_message" }, ({ payload }) => {
      if (payload.direction !== "to_mobile") return;
      const event = payload.payload as AgentEvent;

      switch (event.type) {
        case "agent_start":
          setIsAgentBusy(true);
          break;
        case "agent_end":
          setIsAgentBusy(false);
          // Commit the streaming text as a final entry
          setAssistantText((text) => {
            if (text) {
              setEntries((prev) => [...prev, { role: "assistant", text }]);
            }
            return "";
          });
          break;
        case "message_start":
          if (event.role === "assistant") {
            // Commit any existing text before starting a new message
            setAssistantText((text) => {
              if (text) {
                setEntries((prev) => [...prev, { role: "assistant", text }]);
              }
              return "";
            });
          }
          break;
        case "message_update":
          if (typeof event.delta === "string") {
            setAssistantText((prev) => prev + event.delta);
          }
          break;
        case "message_end":
          if (event.role === "assistant" && typeof event.text === "string") {
            // Commit the final text directly into entries (not assistantText)
            // so it's ordered correctly before any tool events that follow
            setAssistantText("");
            setEntries((prev) => [...prev, { role: "assistant", text: event.text as string }]);
          }
          break;
        case "tool_execution_start":
          // Flush any streaming assistantText before adding tool entries
          // to preserve chronological order in the chat
          setAssistantText((text) => {
            if (text) {
              setEntries((prev) => [...prev, { role: "assistant", text }]);
            }
            return "";
          });
          setEntries((prev) => [
            ...prev,
            { role: "tool", text: `Running ${event.toolName}...`, isError: false },
          ]);
          break;
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
    });

    // Subscribe + catch up on any missed messages
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED" && mobileToken) {
        catchUpMutation.mutate({ mobileToken });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // -- Catch-up on connect ---------------------------------------------------

  const catchUpMutation = useMutation(
    trpc.dispatch.mobileCatchUp.mutationOptions({
      onSuccess(data) {
        for (const msg of data.messages) {
          const event = msg.payload as AgentEvent;
          if (event.type === "message_end" && event.role === "assistant" && typeof event.text === "string") {
            setEntries((prev) => [...prev, { role: "assistant", text: event.text as string }]);
          }
        }
      },
    }),
  );

  // -- Send message ----------------------------------------------------------

  const sendMutation = useMutation(
    trpc.dispatch.sendMessage.mutationOptions({}),
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !mobileToken) return;
    setInput("");
    setEntries((prev) => [...prev, { role: "user", text }]);
    sendMutation.mutate({
      mobileToken,
      type: "user_message",
      payload: { text },
    });
  }, [input, mobileToken, sendMutation]);

  const handleInterrupt = useCallback(() => {
    if (!mobileToken) return;
    sendMutation.mutate({ mobileToken, type: "interrupt", payload: {} });
  }, [mobileToken, sendMutation]);

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
