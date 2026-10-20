import { Alert, Text, View } from "react-native";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import {
  discardUnsent,
  dismissSyncNotice,
  retryUnsent,
  saveUnsentAsNew,
  useOutboxStatus,
} from "@/lib/app-runtime";
import { TextButton } from "@/ui/text-button";
import { outboxNotices, PARKED_ACTION_LABELS } from "./outbox-notices";
import type { OutboxNotice, ParkedAction } from "./outbox-notices";

// a notice's card, the same for each kind
const FRAME = "gap-2 rounded-lg border border-border bg-card p-3";

// a line height stays a style value: react-native-css 3.0.7 resolves a line-height class to nothing
const MESSAGE_LINE = { lineHeight: 20 } as const;

type ParkedNotice = Extract<OutboxNotice, { kind: "parked" }>;

// discarding is the one action that can lose the user's words, so it asks
const confirmDiscard = ({ discard, seq }: ParkedNotice): void => {
  Alert.alert("Discard this change?", discard, [
    { style: "cancel", text: "Cancel" },
    {
      onPress: () => {
        void discardUnsent(seq);
      },
      style: "destructive",
      text: "Discard",
    },
  ]);
};

const runParked = async (
  action: ParkedAction,
  notice: ParkedNotice,
  onOpen: (path: string) => void,
): Promise<void> => {
  const { seq } = notice;
  switch (action) {
    case "retry": {
      await retryUnsent(seq);
      return;
    }
    case "save-as-new": {
      const kept = await saveUnsentAsNew(seq);
      if (kept !== null && isDocPath(kept)) {
        onOpen(kept);
      }
      return;
    }
    case "discard": {
      confirmDiscard(notice);
    }
    // no default
  }
};

const Notice = ({ notice, onOpen }: { notice: OutboxNotice; onOpen: (path: string) => void }) => {
  if (notice.kind === "parked") {
    return (
      <View className={FRAME}>
        <Text className="text-14 font-semibold text-card-foreground">{notice.title}</Text>
        <Text className="text-14 text-muted-foreground" style={MESSAGE_LINE}>
          {notice.reason}
        </Text>
        <View className="flex-row flex-wrap gap-4">
          {notice.actions.map((action) => (
            <TextButton
              key={action}
              fontSize={14}
              label={PARKED_ACTION_LABELS[action]}
              onPress={() => {
                void runParked(action, notice, onOpen);
              }}
            />
          ))}
        </View>
      </View>
    );
  }
  return (
    <View className={FRAME}>
      <Text className="text-14 text-card-foreground" style={MESSAGE_LINE}>
        {notice.message}
      </Text>
      <View className="flex-row flex-wrap gap-4">
        <TextButton
          fontSize={14}
          label="Open"
          onPress={() => {
            onOpen(notice.open);
          }}
        />
        <TextButton
          fontSize={14}
          label="Dismiss"
          onPress={() => {
            dismissSyncNotice(notice.id);
          }}
        />
      </View>
    </View>
  );
};

// the phone's unsent edits that need the user, above the notes list and the open note; the
// caller's classes place it
export const OutboxBanner = ({
  className = "",
  onOpen,
}: {
  className?: string;
  onOpen: (path: string) => void;
}) => {
  const notices = outboxNotices(useOutboxStatus());
  if (notices.length === 0) {
    return null;
  }
  return (
    <View className={`gap-2 pb-2 ${className}`}>
      {notices.map((notice) => (
        <Notice key={notice.key} notice={notice} onOpen={onOpen} />
      ))}
    </View>
  );
};
