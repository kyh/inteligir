import { useMutation } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useHeaderHeight } from "expo-router/react-navigation";
import { SafeAreaView } from "react-native-safe-area-context";
import { composerPlaceholder, sendInput, viewContextOf } from "@repo/client/agent-send";
import {
  callRefusalWords,
  conversationOf,
  EMPTY_WORDS,
  endingWords,
  sendRefusalWords,
  statusWords,
} from "@repo/client/thread-entries";
import type { ThreadBlock } from "@repo/client/thread-entries";
import { useLibrary, useThreadEvents, useThreads } from "@/runtime/library-hooks";
import { firstParam, NEW_THREAD } from "@/lib/routes";
import { screenStyle, SPACE, useTheme } from "@/lib/theme";
import { useFollowEnd } from "@/ui/follow-end";
import { online } from "@/ui/needs-connection";
import { TextButton } from "@/ui/text-button";

const contextOf = (fromItem: string | null) =>
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
          <Text className="text-13 font-semibold text-muted-foreground">{block.doneWords}</Text>
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
            {`${use.label}${use.kind === "running" ? "…" : ""}`}
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

    case "agent.progress":
    case "agent.tool_use":
    case "agent.tool_result": {
      return null;
    }

    default: {
      throw new Error(`unexpected ${String(event satisfies never)}`);
    }
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
  onSent,
  threadId,
}: {
  fromItem: string | null;
  onSent: (threadId: string) => void;
  threadId: string | null;
}) => {
  const { queries } = useLibrary();
  const [text, setText] = useState("");

  const send = useMutation(
    queries.library.agent.send.mutationOptions({
      onSuccess: (answer) => {
        setText("");
        onSent(answer.threadId);
      },
    }),
  );

  const submit = () => {
    const input = sendInput({ text, threadId, viewContext: contextOf(fromItem) });

    if (input !== null && !send.isPending && online()) {
      send.mutate(input);
    }
  };

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
  const end = useFollowEnd();

  return (
    <SafeAreaView style={screenStyle(theme)} edges={["left", "right"]}>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView
        className="grow basis-0"
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
      >
        <ScrollView
          {...end.props}
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
          onSent={(next) => {
            router.setParams({ thread: next });
            end.follow();
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default ConversationScreen;
