import { Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
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
import { firstParam } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import type { ThreadDisplayItem } from "@/sync/thread-projection";
import { TextButton } from "@/ui/text-button";
import { DISPATCH_MAX_CHARS } from "@repo/contract/cloud/dispatch/dispatch-schema";
import { quoteSelection } from "@repo/domain/quote-selection";
import { docStem } from "@repo/notes/knowledge/doc-file";

// a value, not a class: react-native-css 3.0.7 resolves a line-height class to nothing
const AGENT_TEXT = { lineHeight: 24 } as const;

const USER_BUBBLE_CLASS = "max-w-[85%] rounded-2xl rounded-br-lg bg-primary px-4 py-2.5";

const CAPTION_CLASS = "shrink text-12";

type ThreadRow =
  | { kind: "item"; key: string; item: ThreadDisplayItem }
  | { kind: "working"; key: string }
  | { kind: "approval"; key: string; approval: ApprovalView }
  | { kind: "pending"; key: string; dispatch: TurnDispatch };

const Item = ({ item }: { item: ThreadDisplayItem }): ReactElement => {
  switch (item.kind) {
    case "user": {
      return (
        <View className="flex-row justify-end">
          <View className={USER_BUBBLE_CLASS}>
            <Text className="text-16 text-primary-foreground">{item.text}</Text>
          </View>
        </View>
      );
    }
    case "agent": {
      return (
        <Text className="text-16 text-foreground" style={AGENT_TEXT}>
          {item.text}
        </Text>
      );
    }
    case "reasoning": {
      return (
        <Text className="text-13 italic text-muted-foreground" numberOfLines={4}>
          {item.text}
        </Text>
      );
    }
    case "tool": {
      return (
        <Text
          className={`text-12 ${item.failed ? "text-destructive" : "text-muted-foreground"}`}
          numberOfLines={1}
        >
          {item.failed ? `${item.label} — failed` : item.label}
        </Text>
      );
    }
    case "notice": {
      return (
        <View className="rounded-lg border border-destructive px-3 py-2">
          <Text className="text-center text-15 text-destructive">{item.text}</Text>
        </View>
      );
    }
    // no default
  }
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
  const { phase } = dispatch;
  const refused = phase.kind === "refused";
  const cancellable = noMacHasIt(phase);
  return (
    <View className="gap-1">
      <View className="flex-row justify-end">
        <View className={`${USER_BUBBLE_CLASS} opacity-60`}>
          <Text selectable className="text-16 text-primary-foreground">
            {dispatch.text}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center justify-end gap-3">
        <Text
          className={`${CAPTION_CLASS} ${refused ? "text-destructive" : "text-muted-foreground"}`}
        >
          {dispatchCaption(phase, desktops)}
        </Text>
        {cancellable ? (
          <TextButton
            fontSize={13}
            label="Cancel"
            onPress={() => {
              void cancel(dispatch.id);
            }}
          />
        ) : null}
        {refused ? (
          <TextButton
            fontSize={13}
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
    <View className="flex-row items-center gap-2">
      <ActivityIndicator size="small" color={theme.mutedForeground} />
      <Text className={`${CAPTION_CLASS} text-muted-foreground`}>{WORKING_CAPTION}</Text>
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
  const { answer } = approval;
  if (answer !== null) {
    const refused = answer.phase.kind === "refused";
    return (
      <View className="flex-row items-center justify-end gap-3">
        <Text
          className={`${CAPTION_CLASS} ${refused ? "text-destructive" : "text-muted-foreground"}`}
        >
          {`${DECISION_LABELS[answer.decision]} · ${dispatchCaption(answer.phase, desktops)}`}
        </Text>
        {refused ? (
          <TextButton
            fontSize={13}
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
      <Text className={`${CAPTION_CLASS} text-muted-foreground`}>Answered on another device</Text>
    );
  }
  return (
    <View className="flex-row flex-wrap gap-2">
      {approval.decisions.map((decision) => (
        <Pressable
          key={decision}
          accessibilityRole="button"
          className={`rounded-lg border px-3 py-2 active:opacity-70 ${decision === "deny" ? "border-border" : "border-primary bg-primary"}`}
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
            className={`text-13 font-semibold ${decision === "deny" ? "text-foreground" : "text-primary-foreground"}`}
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
}) => (
  <View className="gap-2 rounded-lg border border-border bg-card p-3">
    <Text className="text-13 font-semibold text-card-foreground">The agent asks to</Text>
    <Text
      selectable
      className={`text-card-foreground ${approval.code ? "font-mono text-13" : "text-16"}`}
    >
      {approval.summary}
    </Text>
    {approval.reason === null || approval.reason === "" ? null : (
      <Text className={`${CAPTION_CLASS} text-muted-foreground`}>{approval.reason}</Text>
    )}
    <ApprovalAnswer approval={approval} desktops={desktops} />
  </View>
);

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
    <View className="gap-1 border-t border-t-border px-4 py-2">
      {error === null ? null : <Text className={`${CAPTION_CLASS} text-destructive`}>{error}</Text>}
      <View className="flex-row items-end gap-2">
        <TextInput
          className="max-h-[140px] grow basis-0 rounded-lg border border-input bg-card px-3 pt-2 pb-2 text-16 text-foreground"
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
          className="rounded-lg bg-primary px-4 py-2.5 active:opacity-70 disabled:opacity-50"
          onPress={() => {
            void send();
          }}
        >
          <Text className="text-13 font-semibold text-primary-foreground">Send</Text>
        </Pressable>
      </View>
    </View>
  );
};

// a separator, not the container's gap: the list's windowing spacers are its siblings and would
// take a gap each.
const Separator = () => <View className="h-3" />;

const quotedSeed = (selection: string | null): string =>
  selection === null ? "" : quoteSelection(selection).slice(0, DISPATCH_MAX_CHARS);

// A synced thread — the Mac agent's work, mirrored — with what this phone has asked of it and not
// yet seen in the log. A `note` param makes an empty thread one about that note: its first message
// carries the note as the thread's origin, and the bytes the note screen showed as the revision;
// a `quote` is the selection it was asked over, which the composer starts with.
const ThreadScreen = () => {
  const theme = useTheme();
  // a value, not a class: className draws nothing on a SafeAreaView
  const screen = { backgroundColor: theme.background, flex: 1 };
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
    <SafeAreaView style={screen} edges={["left", "right", "bottom"]}>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView
        className="grow basis-0"
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
      >
        {emptyLine === null ? (
          <FlatList
            ref={list}
            className="grow basis-0"
            contentContainerClassName="p-4"
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
          <View className="grow basis-0 items-center justify-center px-6">
            <Text className="text-center text-15 text-muted-foreground">{emptyLine}</Text>
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
