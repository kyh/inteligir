import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import {
  discardUnsent,
  dismissSyncNotice,
  retryUnsent,
  saveUnsentAsNew,
  useOutboxStatus,
} from "@/lib/app-runtime";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";
import { outboxNotices, PARKED_ACTION_LABELS } from "./outbox-notices";
import type { OutboxNotice, ParkedAction } from "./outbox-notices";

const styles = StyleSheet.create({
  action: { fontSize: 14, fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.lg },
  banner: { gap: SPACE.sm, paddingBottom: SPACE.sm },
  message: { fontSize: 14, lineHeight: 20 },
  notice: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
  },
  pressed: { opacity: 0.7 },
  title: { fontSize: 14, fontWeight: "600" },
});

// discarding is the one action that loses the user's words, so it asks
const confirmDiscard = (seq: number): void => {
  Alert.alert("Discard this change?", "It has not reached your vault, and discarding deletes it.", [
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
  seq: number,
  onOpen: (path: string) => void,
): Promise<void> => {
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
      confirmDiscard(seq);
    }
    // no default
  }
};

const ActionButton = ({ label, onPress }: { label: string; onPress: () => void }) => {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={SPACE.sm}
      style={({ pressed }) => pressed && styles.pressed}
      onPress={onPress}
    >
      <Text style={[styles.action, { color: theme.foreground }]}>{label}</Text>
    </Pressable>
  );
};

const Notice = ({ notice, onOpen }: { notice: OutboxNotice; onOpen: (path: string) => void }) => {
  const theme = useTheme();
  const frame = [styles.notice, { backgroundColor: theme.card, borderColor: theme.border }];
  if (notice.kind === "parked") {
    return (
      <View style={frame}>
        <Text style={[styles.title, { color: theme.cardForeground }]}>{notice.title}</Text>
        <Text style={[styles.message, { color: theme.mutedForeground }]}>{notice.reason}</Text>
        <View style={styles.actions}>
          {notice.actions.map((action) => (
            <ActionButton
              key={action}
              label={PARKED_ACTION_LABELS[action]}
              onPress={() => {
                void runParked(action, notice.seq, onOpen);
              }}
            />
          ))}
        </View>
      </View>
    );
  }
  return (
    <View style={frame}>
      <Text style={[styles.message, { color: theme.cardForeground }]}>{notice.message}</Text>
      <View style={styles.actions}>
        <ActionButton
          label="Open"
          onPress={() => {
            onOpen(notice.open);
          }}
        />
        <ActionButton
          label="Dismiss"
          onPress={() => {
            dismissSyncNotice(notice.id);
          }}
        />
      </View>
    </View>
  );
};

// the phone's unsent edits that need the user, above the notes list and the open note
export const OutboxBanner = ({
  onOpen,
  style,
}: {
  onOpen: (path: string) => void;
  style?: StyleProp<ViewStyle>;
}) => {
  const notices = outboxNotices(useOutboxStatus());
  if (notices.length === 0) {
    return null;
  }
  return (
    <View style={[styles.banner, style]}>
      {notices.map((notice) => (
        <Notice key={notice.key} notice={notice} onOpen={onOpen} />
      ))}
    </View>
  );
};
