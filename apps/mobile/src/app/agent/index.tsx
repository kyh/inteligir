// The built-in agent's conversations, the account's and the same on every device: as the phone last
// read them, so a past one reads offline, newest first, each with its state when a turn is under
// way. Asking needs a connection, which the conversation says where it would send.

import { Stack } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EMPTY_WORDS, statusWords } from "@repo/agent-panel/thread-entries";
import { useThreads } from "@/lib/library-hooks";
import { openAgent } from "@/lib/routes";
import { screenStyle, useTheme } from "@/lib/theme";

const ConversationsScreen = () => {
  const theme = useTheme();
  const { more, threads = [] } = useThreads();
  return (
    <SafeAreaView style={screenStyle(theme)} edges={["left", "right"]}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          accessibilityLabel="New conversation"
          icon="square.and.pencil"
          onPress={() => {
            openAgent();
          }}
        />
      </Stack.Toolbar>
      <FlatList
        className="grow basis-0"
        contentContainerClassName="px-4 pt-3 pb-8"
        contentInsetAdjustmentBehavior="automatic"
        data={threads}
        keyExtractor={(thread) => thread.id}
        onEndReached={more}
        ListEmptyComponent={
          <View className="items-center px-6 py-24">
            <Text className="text-center text-16 text-muted-foreground">{EMPTY_WORDS}</Text>
          </View>
        }
        renderItem={({ item: thread }) => {
          const state = statusWords(thread.status);
          return (
            <Pressable
              accessibilityRole="button"
              className="mb-2 gap-0.5 rounded-lg border border-border bg-card px-4 py-3 active:opacity-70"
              onPress={() => {
                openAgent(thread.id);
              }}
            >
              <Text className="text-16 text-card-foreground" numberOfLines={2}>
                {thread.title}
              </Text>
              <Text className="text-13 text-muted-foreground" numberOfLines={1}>
                {state === "" ? new Date(thread.updatedAt).toLocaleString() : state}
              </Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
};

export default ConversationsScreen;
