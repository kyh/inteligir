import { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";

import { useDispatch, type AgentEvent } from "@/lib/use-dispatch";

type ChatEntry =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "tool"; name: string; isError: boolean; text: string }
  | { role: "status"; text: string };

export default function DispatchScreen() {
  const { deviceId, deviceName } = useLocalSearchParams<{
    deviceId: string;
    deviceName: string;
  }>();

  const { events, assistantText, isAgentBusy, sendMessage, interrupt, isSending } =
    useDispatch(deviceId ?? null);

  const [input, setInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([]);
  const flatListRef = useRef<FlatList>(null);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setChatHistory((prev) => [...prev, { role: "user", text }]);
    sendMessage(text);
  };

  // Build the live view from events
  const liveEntries: ChatEntry[] = [];

  // Collect tool executions from events
  for (const event of events) {
    if (event.type === "tool_execution_start") {
      liveEntries.push({
        role: "tool",
        name: event.toolName as string,
        isError: false,
        text: `Running ${event.toolName}...`,
      });
    }
    if (event.type === "tool_execution_end") {
      liveEntries.push({
        role: "tool",
        name: "",
        isError: event.isError as boolean,
        text: (event.resultText as string).slice(0, 200),
      });
    }
  }

  // Add streaming assistant text
  if (assistantText) {
    liveEntries.push({ role: "assistant", text: assistantText });
  }

  const allEntries = [...chatHistory, ...liveEntries];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      <View style={styles.header}>
        <Text style={styles.deviceName}>{deviceName ?? "Device"}</Text>
        <View style={styles.statusRow}>
          {isAgentBusy && (
            <>
              <ActivityIndicator size="small" color="#d1684e" />
              <Text style={styles.busyText}>Agent working...</Text>
            </>
          )}
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={allEntries}
        keyExtractor={(_, i) => String(i)}
        style={styles.chatList}
        contentContainerStyle={styles.chatContent}
        onContentSizeChange={() =>
          flatListRef.current?.scrollToEnd({ animated: true })
        }
        renderItem={({ item }) => {
          switch (item.role) {
            case "user":
              return (
                <View style={styles.userBubble}>
                  <Text style={styles.userText}>{item.text}</Text>
                </View>
              );
            case "assistant":
              return (
                <View style={styles.assistantBubble}>
                  <Text style={styles.assistantText}>{item.text}</Text>
                </View>
              );
            case "tool":
              return (
                <View style={styles.toolBubble}>
                  <Text
                    style={[
                      styles.toolText,
                      item.isError && { color: "#ef4444" },
                    ]}
                  >
                    {item.text}
                  </Text>
                </View>
              );
            case "status":
              return (
                <Text style={styles.statusText}>{item.text}</Text>
              );
          }
        }}
        ListEmptyComponent={
          <View style={styles.emptyChat}>
            <Text style={styles.emptyChatText}>
              Send a message to your desktop agent.
            </Text>
          </View>
        }
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
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
          <TouchableOpacity style={styles.stopButton} onPress={interrupt}>
            <Text style={styles.stopButtonText}>Stop</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || isSending}
          >
            {isSending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.sendButtonText}>Send</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111",
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  deviceName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    minHeight: 20,
  },
  busyText: {
    color: "#d1684e",
    fontSize: 13,
  },
  chatList: {
    flex: 1,
  },
  chatContent: {
    padding: 16,
    gap: 8,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#d1684e",
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "80%",
  },
  userText: {
    color: "#fff",
    fontSize: 15,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "85%",
  },
  assistantText: {
    color: "#e5e5e5",
    fontSize: 15,
    lineHeight: 22,
  },
  toolBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#1a1a2a",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: "85%",
    borderLeftWidth: 3,
    borderLeftColor: "#4a4a8a",
  },
  toolText: {
    color: "#999",
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  statusText: {
    color: "#666",
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 4,
  },
  emptyChat: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 100,
  },
  emptyChatText: {
    color: "#666",
    fontSize: 16,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#222",
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: "#fff",
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "#333",
  },
  sendButton: {
    backgroundColor: "#d1684e",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  stopButton: {
    backgroundColor: "#ef4444",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  stopButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
});
