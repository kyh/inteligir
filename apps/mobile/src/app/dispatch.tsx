import { useCallback, useMemo, useRef, useState } from "react";
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
import { Redirect, Stack, useRouter } from "expo-router";
import type { PairingCredential } from "@repo/dispatch/pairing";
import { PROTOCOL_VERSION, type AgentEvent } from "@repo/dispatch/protocol";

import { useDispatchConnection, type DispatchFatal } from "@/hooks/use-dispatch-connection";
import { clearCredential, getCredential } from "@/utils/session-store";

type ChatEntryBody =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "tool"; text: string; isError: boolean };

type ChatEntry = ChatEntryBody & { id: number };

export default function DispatchScreen() {
  const [credential] = useState(getCredential);
  if (!credential) {
    return <Redirect href="/" />;
  }
  return <DispatchSession credential={credential} />;
}

function fatalCopy(fatal: DispatchFatal): { title: string; body: string } {
  switch (fatal.kind) {
    case "room_closed":
      return {
        title: "Pairing rotated",
        body: "The desktop rotated its pairing. Grab the new pairing string from Remote Access and pair again.",
      };
    case "unauthorized":
      return {
        title: "Pairing rejected",
        body: "The desktop refused this pairing — it was likely rotated or disabled. Pair again with a fresh pairing string.",
      };
    case "version_mismatch":
      return {
        title: "Version mismatch",
        body: "This app and your desktop speak different protocol versions. Update both, then pair again.",
      };
  }
}

function DispatchSession({ credential }: { credential: PairingCredential }) {
  const router = useRouter();

  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [assistantText, setAssistantText] = useState("");
  const [isAgentBusy, setIsAgentBusy] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const assistantTextRef = useRef("");
  const nextEntryIdRef = useRef(0);

  const appendEntry = useCallback((entry: ChatEntryBody) => {
    setEntries((prev) => [...prev, { ...entry, id: nextEntryIdRef.current++ }]);
  }, []);

  const flushAssistantText = useCallback(() => {
    const flushed = assistantTextRef.current;
    assistantTextRef.current = "";
    setAssistantText("");
    if (flushed) {
      appendEntry({ role: "assistant", text: flushed });
    }
  }, [appendEntry]);

  const handleAgentEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case "agent_start":
          setIsAgentBusy(true);
          break;
        case "agent_end":
          setIsAgentBusy(false);
          flushAssistantText();
          break;
        case "message_start":
          if (event.role === "assistant") {
            flushAssistantText();
          }
          break;
        case "message_update":
          assistantTextRef.current += event.delta;
          setAssistantText(assistantTextRef.current);
          break;
        case "message_end":
          if (event.role === "assistant") {
            assistantTextRef.current = "";
            setAssistantText("");
            if (event.text) {
              appendEntry({ role: "assistant", text: event.text });
            }
          }
          if (event.stopReason === "error") {
            appendEntry({
              role: "tool",
              text: event.errorMessage ?? "The turn ended with an error.",
              isError: true,
            });
          }
          break;
        case "tool_execution_start":
          flushAssistantText();
          appendEntry({ role: "tool", text: `Running ${event.toolName}...`, isError: false });
          break;
        case "tool_execution_end":
          appendEntry({
            role: "tool",
            text: event.resultText.slice(0, 200),
            isError: event.isError,
          });
          break;
        case "queue_update":
          // Queue introspection has no surface here yet; the desktop UI owns it.
          break;
        case "turn_error":
          setIsAgentBusy(false);
          assistantTextRef.current = "";
          setAssistantText("");
          appendEntry({ role: "tool", text: event.reason, isError: true });
          break;
      }
    },
    [appendEntry, flushAssistantText],
  );

  const handleNotice = useCallback(
    (text: string) => {
      appendEntry({ role: "tool", text, isError: true });
    },
    [appendEntry],
  );

  const connection = useDispatchConnection({
    credential,
    onAgentEvent: handleAgentEvent,
    onNotice: handleNotice,
  });

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    appendEntry({ role: "user", text });
    connection.send({ v: PROTOCOL_VERSION, type: "user_message", text });
  }, [appendEntry, connection, input]);

  const handleInterrupt = useCallback(() => {
    connection.send({ v: PROTOCOL_VERSION, type: "interrupt" });
  }, [connection]);

  const handleUnpair = useCallback(async () => {
    await clearCredential();
    router.replace("/");
  }, [router]);

  const handleRepair = useCallback(async () => {
    await clearCredential();
    router.replace("/pair");
  }, [router]);

  const displayEntries = useMemo(
    () => [
      ...entries,
      ...(assistantText ? [{ id: -1, role: "assistant" as const, text: assistantText }] : []),
    ],
    [entries, assistantText],
  );

  const canSend = connection.socket === "online" && connection.desktopOnline;

  const statusBanner = (() => {
    if (connection.fatal) return null; // the fatal overlay takes over
    if (connection.socket === "connecting") {
      return connection.failedAttempts >= 3
        ? "Can't reach the relay — retrying. Is Remote Access enabled on your desktop?"
        : "Connecting...";
    }
    if (!connection.desktopOnline) return "Desktop offline — messages won't be delivered.";
    if (isAgentBusy) return "Agent working...";
    return null;
  })();

  return (
    <SafeAreaView className="bg-background flex-1" edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: "Dispatch",
          headerRight: () => (
            <Pressable onPress={handleUnpair}>
              <Text className="text-destructive text-sm">Unpair</Text>
            </Pressable>
          ),
        }}
      />
      {connection.fatal ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-foreground mb-2 text-center text-xl font-bold">
            {fatalCopy(connection.fatal).title}
          </Text>
          <Text className="text-muted-foreground mb-8 text-center text-sm leading-5">
            {fatalCopy(connection.fatal).body}
          </Text>
          <Pressable
            className="bg-primary w-full items-center rounded-xl p-4"
            onPress={handleRepair}
          >
            <Text className="text-primary-foreground text-base font-semibold">Re-pair</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={90}
        >
          {statusBanner !== null && (
            <View className="flex-row items-center gap-2 border-b border-border px-4 py-2">
              {(connection.socket === "connecting" || isAgentBusy) && (
                <ActivityIndicator size="small" color="#d1684e" />
              )}
              <Text className="text-muted-foreground flex-1 text-xs">{statusBanner}</Text>
            </View>
          )}

          <FlatList
            ref={flatListRef}
            data={displayEntries}
            keyExtractor={(item) => String(item.id)}
            className="flex-1"
            contentContainerStyle={{ padding: 16, gap: 8 }}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            renderItem={({ item }) => {
              switch (item.role) {
                case "user":
                  return (
                    <View
                      className="bg-primary self-end rounded-2xl rounded-br-sm px-4 py-2.5"
                      style={{ maxWidth: "80%" }}
                    >
                      <Text className="text-primary-foreground text-[15px]">{item.text}</Text>
                    </View>
                  );
                case "assistant":
                  return (
                    <View
                      className="bg-muted self-start rounded-2xl rounded-bl-sm px-4 py-2.5"
                      style={{ maxWidth: "85%" }}
                    >
                      <Text className="text-foreground text-[15px] leading-[22px]">
                        {item.text}
                      </Text>
                    </View>
                  );
                case "tool":
                  return (
                    <View
                      className="self-start rounded-lg border-l-[3px] border-l-[#4a4a8a] bg-[#1a1a2a] px-3 py-2"
                      style={{ maxWidth: "85%" }}
                    >
                      <Text
                        className={`text-xs font-mono ${item.isError ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {item.text}
                      </Text>
                    </View>
                  );
                default:
                  return null;
              }
            }}
            ListEmptyComponent={
              <View className="flex-1 items-center pt-24">
                <Text className="text-muted-foreground text-base">
                  {canSend
                    ? "Send a message to your desktop agent."
                    : "Waiting for your desktop to come online."}
                </Text>
              </View>
            }
          />

          <View className="flex-row items-end gap-2 border-t border-border px-3 py-3">
            <TextInput
              className="bg-muted text-foreground min-h-[40px] flex-1 rounded-2xl border border-border px-4 py-2.5 text-[15px]"
              value={input}
              onChangeText={setInput}
              placeholder={canSend ? "Type a message..." : "Waiting for desktop..."}
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
                <Text className="text-foreground text-[15px] font-semibold">Stop</Text>
              </Pressable>
            ) : (
              <Pressable
                className="bg-primary rounded-2xl px-5 py-2.5 disabled:opacity-40"
                onPress={handleSend}
                disabled={!input.trim() || !canSend}
              >
                <Text className="text-primary-foreground text-[15px] font-semibold">Send</Text>
              </Pressable>
            )}
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
