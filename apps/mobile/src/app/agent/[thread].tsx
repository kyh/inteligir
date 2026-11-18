// One conversation with the built-in agent, drawn natively over the same logic the library's page
// draws its panel with (`@repo/client`): the thread's events as they happen, held as the phone
// last read them so it reads offline, the reply as it is written, each turn's ending in the
// person's words, and the composer, whose message carries the item it was asked from. A send and a
// stop go to the cloud, so each needs a connection and says so rather than wait for one; the day's
// allowance and an agent switched off are said as the page says them.

import { useMutation } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useHeaderHeight } from "expo-router/react-navigation";
import { SafeAreaView } from "react-native-safe-area-context";
import { composerPlaceholder, sendInput, viewContextOf } from "@repo/client/agent-send";
import type { AgentViewContext } from "@repo/client/agent-send";
import {
  callRefusalWords,
  conversationOf,
  EMPTY_WORDS,
  endingWords,
  sendRefusalWords,
  statusWords,
  toolWords,
  workWords,
} from "@repo/client/thread-entries";
import type { ThreadBlock } from "@repo/client/thread-entries";
import { useLibrary, useThreadEvents, useThreads } from "@/lib/library-hooks";
import { firstParam, NEW_THREAD } from "@/lib/routes";
import { screenStyle, SPACE, useTheme } from "@/lib/theme";
import { online } from "@/ui/needs-connection";
import { TextButton } from "@/ui/text-button";

// the screen a message leaves from: the item it was asked about, else the whole library
const contextOf = (fromItem: string | null): AgentViewContext | undefined =>
  viewContextOf({
    kind: null,
    openItem: fromItem,
    scope: { kind: "all" },
    selected: { count: 0, ids: [] },
  });

const Block = ({ block, live }: { block: ThreadBlock; live: boolean }) => {
  if (block.kind === "draft") {
    return (
      <Text selectable className="text-16 text-foreground leading-[22px]">
        {block.text}
      </Text>
    );
  }
  if (block.kind === "work") {
    return (
      <View className="gap-1 rounded-lg border border-border px-3 py-2">
        {live ? null : (
          <Text className="text-13 font-semibold text-muted-foreground">
            {workWords(block.uses.length)}
          </Text>
        )}
        {block.notes.map((note) => (
          <Text key={note.eventId} className="text-13 text-muted-foreground">
            {note.text}
          </Text>
        ))}
        {block.uses.map((use) => (
          <Text
            key={use.toolUseId}
            className={`text-13 ${use.kind === "failed" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {`${toolWords(use.name)}${use.kind === "running" ? "…" : ""}`}
            {use.kind === "failed" ? `: ${use.message}` : ""}
          </Text>
        ))}
      </View>
    );
  }
  const { event } = block.entry;
  switch (event.type) {
    case "user.message": {
      return (
        <Text
          selectable
          className="self-end rounded-lg bg-muted px-3 py-2 text-16 text-foreground leading-[22px]"
        >
          {event.text}
        </Text>
      );
    }
    case "agent.message": {
      return (
        <Text selectable className="text-16 text-foreground leading-[22px]">
          {event.text}
        </Text>
      );
    }
    case "turn.ended": {
      const words = endingWords(event.reason);
      return words === "" ? null : <Text className="text-13 text-muted-foreground">{words}</Text>;
    }
    // a run of work draws as a block of its own
    case "agent.progress":
    case "agent.tool_use":
    case "agent.tool_result": {
      return null;
    }
    // no default
  }
};

const Conversation = ({ threadId }: { threadId: string }) => {
  const { queries } = useLibrary();
  const followed = useThreadEvents(threadId);
  const { blocks, underWay } = conversationOf(followed?.rows ?? [], followed?.draft ?? "");
  const cancel = useMutation(queries.library.agent.cancel.mutationOptions());
  const state = statusWords(underWay ? "running" : "idle");
  const failure = cancel.error;
  return (
    <View className="gap-3">
      {blocks.map((block, index) => (
        <Block key={block.key} block={block} live={underWay && index === blocks.length - 1} />
      ))}
      <View className="flex-row flex-wrap items-center gap-4">
        {state === "" ? null : <Text className="text-13 text-muted-foreground">{state}</Text>}
        {underWay ? (
          <TextButton
            fontSize={14}
            label="Stop"
            onPress={() => {
              if (online()) {
                cancel.mutate({ threadId });
              }
            }}
          />
        ) : null}
        {failure === null ? null : (
          <Text className="text-13 text-destructive">{callRefusalWords(failure)}</Text>
        )}
      </View>
    </View>
  );
};

const Composer = ({
  fromItem,
  onThread,
  threadId,
}: {
  fromItem: string | null;
  onThread: (threadId: string) => void;
  threadId: string | null;
}) => {
  const { queries } = useLibrary();
  const [text, setText] = useState("");
  const send = useMutation(
    queries.library.agent.send.mutationOptions({
      onSuccess: (answer) => {
        setText("");
        onThread(answer.threadId);
      },
    }),
  );
  const submit = (): void => {
    const input = sendInput({ text, threadId, viewContext: contextOf(fromItem) });
    if (input !== null && !send.isPending && online()) {
      send.mutate(input);
    }
  };
  // the last send's refusal in the person's words, the allowance's naming when it fills again
  // from when that send went
  const refused = send.error === null ? null : sendRefusalWords(send.error, send.submittedAt);
  return (
    <View className="gap-1 border-t border-border px-4 pt-2 pb-3">
      {refused === null ? null : <Text className="text-13 text-muted-foreground">{refused}</Text>}
      <View className="flex-row items-end gap-3">
        <TextInput
          accessibilityLabel="Message the agent"
          className="grow basis-0 rounded-lg border border-input bg-card px-3 pt-2 pb-2 text-16 text-foreground placeholder:text-muted-foreground"
          placeholder={composerPlaceholder(threadId)}
          multiline
          value={text}
          editable={!send.isPending}
          onChangeText={setText}
        />
        <Pressable
          accessibilityRole="button"
          disabled={send.isPending}
          hitSlop={SPACE.sm}
          onPress={submit}
        >
          <Text className="pb-2 text-16 font-semibold text-foreground">Send</Text>
        </Pressable>
      </View>
    </View>
  );
};

const ConversationScreen = () => {
  const theme = useTheme();
  const headerHeight = useHeaderHeight();
  const params = useLocalSearchParams<{ thread: string; item?: string }>();
  const asked = firstParam(params.thread);
  const threadId = asked === null || asked === NEW_THREAD ? null : asked;
  const fromItem = firstParam(params.item);
  const title = useThreads()?.find((row) => row.id === threadId)?.title ?? "New conversation";
  return (
    <SafeAreaView style={screenStyle(theme)} edges={["left", "right"]}>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView
        className="grow basis-0"
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
      >
        <ScrollView
          className="grow basis-0"
          contentContainerClassName="px-4 pt-3 pb-6"
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
        >
          {threadId === null ? (
            <Text className="pt-6 text-center text-16 text-muted-foreground">
              {fromItem === null ? EMPTY_WORDS : "Ask the agent about this item."}
            </Text>
          ) : (
            <Conversation threadId={threadId} />
          )}
        </ScrollView>
        <Composer
          fromItem={fromItem}
          threadId={threadId}
          onThread={(next) => {
            router.setParams({ thread: next });
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default ConversationScreen;
