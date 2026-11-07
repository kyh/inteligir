// The open item's highlights over the editor, read from the replica and kept current by its
// change feed: a card per highlight, its stored quote above its note and replies, with a field
// that adds its note or a reply and a Delete that takes it and its replies.

import { useState } from "react";
import { annotationSourceLabel } from "@repo/notes/annotations/store-schema";
import type { AnnotationEntry } from "@repo/notes/annotations/store-schema";
import type { AnnotationThread } from "@repo/notes/annotations/annotation-threads";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { messageOf } from "@/lib/error-message";
import { useAnnotations, useItem } from "@/lib/library-hooks";
import { SPACE } from "@/lib/theme";
import { threadsOf } from "./annotation-edits";
import type { AnnotationEdits } from "./annotation-edits";

const entryMeta = (entry: AnnotationEntry): string =>
  `${annotationSourceLabel(entry.source)} · ${new Date(entry.createdAt * 1000).toLocaleDateString()}`;

const NOT_QUEUED = "The change could not be kept on this iPhone.";

const ThreadCard = ({ edits, thread }: { edits: AnnotationEdits; thread: AnnotationThread }) => {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // a bare highlight's first words are its note; after that the field answers it
  const bare = thread.root.text === "";

  const run = async (change: () => Promise<boolean>): Promise<boolean> => {
    setBusy(true);
    let message: string | null = null;
    try {
      if (!(await change())) {
        message = NOT_QUEUED;
      }
    } catch (error) {
      message = messageOf(error);
    }
    setBusy(false);
    if (message !== null) {
      Alert.alert("Couldn't change this annotation", message);
      return false;
    }
    return true;
  };

  const sendReply = (): void => {
    const text = draft.trim();
    if (text === "" || busy) {
      return;
    }
    void (async () => {
      const sent = await run(async () =>
        bare ? await edits.note(thread.id, text) : await edits.reply(thread.id, text),
      );
      if (sent) {
        setDraft("");
      }
    })();
  };

  const confirmRemove = (): void => {
    Alert.alert(
      "Delete this annotation?",
      thread.replies.length === 0
        ? "The highlight and its note go from this item on every device."
        : "The highlight, its note and its replies go from this item on every device.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            void run(async () => await edits.remove(thread.id));
          },
          style: "destructive",
          text: "Delete",
        },
      ],
    );
  };

  return (
    <View className="gap-1 rounded-lg border border-border bg-card p-3">
      <Text className="text-12 text-muted-foreground">
        {entryMeta(thread.root)}
        {thread.anchored ? "" : " · Not placed in the text"}
      </Text>
      {thread.root.quote === undefined ? null : (
        <Text className="border-l-2 border-border pl-3 text-15 text-muted-foreground leading-[21px]">
          {thread.root.quote}
        </Text>
      )}
      {thread.root.text === "" ? null : (
        <Text className="text-15 text-foreground leading-[21px]">{thread.root.text}</Text>
      )}
      {thread.replies.map((reply) => (
        <View key={reply.id} className="mt-1 gap-1 border-l-2 border-border pl-3">
          <Text className="text-12 text-muted-foreground">{entryMeta(reply.entry)}</Text>
          <Text className="text-15 text-foreground leading-[21px]">{reply.entry.text}</Text>
        </View>
      ))}
      <View className="mt-2 flex-row items-center gap-2">
        <TextInput
          accessibilityLabel={bare ? "Add a note to this highlight" : "Reply to this annotation"}
          className="grow basis-0 rounded-lg border border-input bg-background px-3 py-2 text-16 text-foreground placeholder:text-muted-foreground"
          placeholder={bare ? "Add a note…" : "Reply…"}
          value={draft}
          editable={!busy}
          returnKeyType="send"
          onChangeText={setDraft}
          onSubmitEditing={sendReply}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          hitSlop={SPACE.sm}
          onPress={confirmRemove}
        >
          <Text
            className={`px-2 text-15 font-semibold ${busy ? "text-muted-foreground" : "text-destructive"}`}
          >
            Delete
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

const AnnotationsSection = ({
  edits,
  threads,
}: {
  edits: AnnotationEdits;
  threads: readonly AnnotationThread[];
}) => (
  <View className="gap-2 pt-6">
    <Text className="text-12 font-semibold tracking-[0.5px] uppercase text-muted-foreground">
      Annotations
    </Text>
    {threads.map((thread) => (
      <ThreadCard key={thread.id} edits={edits} thread={thread} />
    ))}
  </View>
);

// a marker the page was tapped on narrows the sheet to its threads; one it no longer holds shows all
const threadsFor = (
  threads: readonly AnnotationThread[],
  ids: readonly string[] | null,
): readonly AnnotationThread[] => {
  if (ids === null) {
    return threads;
  }
  const named = threads.filter(
    (thread) => ids.includes(thread.id) || thread.replies.some((reply) => ids.includes(reply.id)),
  );
  return named.length > 0 ? named : threads;
};

const sheetStatus = (threads: readonly AnnotationThread[] | null): string | null => {
  if (threads === null) {
    return "Loading…";
  }
  return threads.length === 0 ? "No highlights yet." : null;
};

// the item's threads as the replica reads them now; null until both reads answer
const useThreads = (itemId: string): readonly AnnotationThread[] | null => {
  const store = useAnnotations(itemId);
  const item = useItem(itemId);
  if (store === undefined || item === undefined) {
    return null;
  }
  return item === null ? [] : threadsOf(store, item);
};

// the open item's annotations over the editor: `ids` names the marker the page was tapped on, and
// null is every annotation (the menu's Annotations). A highlight is made on a selection in the
// item, and its card shows the passage's stored quote above its note.
export const AnnotationsSheet = ({
  edits,
  ids,
  itemId,
  onClose,
  visible,
}: {
  edits: AnnotationEdits;
  ids: readonly string[] | null;
  itemId: string;
  onClose: () => void;
  visible: boolean;
}) => {
  const threads = useThreads(itemId);
  const status = sheetStatus(threads);
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="grow basis-0 bg-background">
        <View className="flex-row items-center justify-end px-4 pt-4">
          <Pressable accessibilityRole="button" hitSlop={SPACE.md} onPress={onClose}>
            <Text className="text-16 font-semibold text-foreground">Done</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerClassName="px-4 pb-12"
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
        >
          {status === null && threads !== null ? (
            <AnnotationsSection edits={edits} threads={threadsFor(threads, ids)} />
          ) : (
            <Text className="pt-6 text-center text-15 text-muted-foreground">{status}</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
};
